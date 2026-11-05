#!/usr/bin/env python3
"""
Extract camera intrinsics and LiDAR->camera extrinsics from an r2b ROS2 bag
and write public/replay/r2b_calibration.json for the FusionView overlay.

No ROS2 installation needed (uses rosbags + typestore).

Usage:
    pip install rosbags numpy
    python3 tools/extract_calibration.py /path/to/r2b_sequence \
        --out public/replay/r2b_calibration.json
"""

import argparse
import json
import os
from pathlib import Path

from rosbags.highlevel import AnyReader
from rosbags.typesys import Stores, get_typestore

# CameraInfo topics -> short camera key used by the telemetry JSONL
CAMERA_INFO_CANDIDATES = {
    "hawk_0_left_rgb_camera_info":  "hawk_0_left_rgb_image",
    "hawk_0_right_rgb_camera_info": "hawk_0_right_rgb_image",
    "d455_1_rgb_camera_info":       "d455_1_rgb_image",
    "d455_1_depth_camera_info":     "d455_1_depth_image",
}
TF_STATIC_TOPIC = "/tf_static"


def get_reader_typestore():
    for store_name in [Stores.ROS2_HUMBLE, Stores.ROS2_IRON, Stores.ROS2_JAZZY]:
        try:
            return get_typestore(store_name), store_name
        except Exception:
            continue
    raise RuntimeError("Could not get a ROS2 typestore")


def quat_to_rot_matrix(x, y, z, w):
    """Quaternion (x,y,z,w) -> 3x3 rotation matrix."""
    n = (x * x + y * y + z * z + w * w) ** 0.5 or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    return [
        [1 - 2 * (y * y + z * z),     2 * (x * y - z * w),     2 * (x * z + y * w)],
        [    2 * (x * y + z * w), 1 - 2 * (x * x + z * z),     2 * (y * z - x * w)],
        [    2 * (x * z - y * w),     2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def mat_vec(m, v):
    return [sum(m[i][k] * v[k] for k in range(3)) for i in range(3)]


def transform_point(t, p):
    """Apply {rotation 3x3, translation [x,y,z]} to point p."""
    r = mat_vec(t["rotation"], p)
    return [r[i] + t["translation"][i] for i in range(3)]


def invert_transform(t):
    """Invert a rigid transform."""
    r = t["rotation"]
    rt = [[r[j][i] for j in range(3)] for i in range(3)]
    tv = t["translation"]
    return {
        "rotation": rt,
        "translation": [-(sum(rt[i][k] * tv[k] for k in range(3))) for i in range(3)],
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("bag_path", help="Path to r2b sequence folder")
    p.add_argument("--out", default="public/replay/r2b_calibration.json")
    p.add_argument("--lidar-frame", default="PandarXT-32_0",
                   help="LiDAR frame id to use as transform root")
    args = p.parse_args()

    typestore, store_name = get_reader_typestore()
    print(f"Using typestore: {store_name}")

    bagpath = Path(args.bag_path)
    cameras = {}
    tf_static = []  # list of {frame_id, child_frame_id, transform}

    with AnyReader([bagpath], default_typestore=typestore) as reader:
        present = {c.topic for c in reader.connections}

        # --- CameraInfo ---
        for info_topic, image_key in CAMERA_INFO_CANDIDATES.items():
            if info_topic not in present:
                continue
            conns = [c for c in reader.connections if c.topic == info_topic]
            for connection, _ts, rawdata in reader.messages(connections=conns):
                msg = reader.deserialize(rawdata, connection.msgtype)
                k = list(msg.k) if hasattr(msg, "k") else []
                cameras[image_key] = {
                    "camera_info_topic": info_topic,
                    "frame_id": getattr(msg.header, "frame_id", ""),
                    "width": int(getattr(msg, "width", 0)),
                    "height": int(getattr(msg, "height", 0)),
                    # K is row-major 3x3: fx, 0, cx / 0, fy, cy / 0, 0, 1
                    "fx": float(k[0]) if len(k) > 0 else 0.0,
                    "fy": float(k[4]) if len(k) > 4 else 0.0,
                    "cx": float(k[2]) if len(k) > 2 else 0.0,
                    "cy": float(k[5]) if len(k) > 5 else 0.0,
                }
                break  # first CameraInfo is enough (static)

        # --- tf_static ---
        if TF_STATIC_TOPIC in present:
            conns = [c for c in reader.connections if c.topic == TF_STATIC_TOPIC]
            for connection, _ts, rawdata in reader.messages(connections=conns):
                msg = reader.deserialize(rawdata, connection.msgtype)
                for tr in getattr(msg, "transforms", []):
                    q = tr.transform.rotation
                    tf_static.append({
                        "frame_id": tr.header.frame_id,
                        "child_frame_id": tr.child_frame_id,
                        "transform": {
                            "rotation": quat_to_rot_matrix(q.x, q.y, q.z, q.w),
                            "translation": [
                                tr.transform.translation.x,
                                tr.transform.translation.y,
                                tr.transform.translation.z,
                            ],
                        },
                    })
                break  # single latched message

    # --- Compose lidar -> camera transforms via tf_static graph ---
    # Build adjacency frame -> child transform
    edges = {}
    for e in tf_static:
        edges.setdefault(e["frame_id"], {})[e["child_frame_id"]] = e["transform"]

    def find_path(src, dst):
        """BFS shortest path of transforms src -> dst.
        Returns list of (transform, invert_flag) applying src->dst."""
        from collections import deque
        q = deque([(src, [])])
        seen = {src}
        while q:
            node, path = q.popleft()
            if node == dst:
                return path
            # forward edges: node is parent
            for child, _t in edges.get(node, {}).items():
                if child not in seen:
                    seen.add(child)
                    q.append((child, path + [(node, child, False)]))
            # reverse edges: node is child of some parent
            for parent, children in edges.items():
                if node in children and parent not in seen:
                    seen.add(parent)
                    q.append((parent, path + [(parent, node, True)]))
        return None

    def compose(path):
        """Compose transforms along path into one transform src->dst."""
        if not path:
            return {"rotation": [[1,0,0],[0,1,0],[0,0,1]], "translation": [0,0,0]}
        # p_dst = T_n(...T_1(p_src)); each step may need inversion
        result = {"rotation": [[1,0,0],[0,1,0],[0,0,1]], "translation": [0,0,0]}
        for parent, child, invert in path:
            t = edges[parent][child]
            if invert:
                t = invert_transform(t)
            # result = t ∘ result  (apply result first, then t)
            new_rot = mat_mul(t["rotation"], result["rotation"])
            new_trans = [
                sum(t["rotation"][i][k] * result["translation"][k] for k in range(3)) + t["translation"][i]
                for i in range(3)
            ]
            result = {"rotation": new_rot, "translation": new_trans}
        return result

    lidar_frame = args.lidar_frame
    extrinsics = {}
    for cam_key, cam in cameras.items():
        cam_frame = cam.get("frame_id") or cam_key
        path = find_path(lidar_frame, cam_frame)
        if path is not None:
            extrinsics[cam_key] = {"direction": "lidar_to_camera", "transform": compose(path)}
        else:
            print(f"WARN: no tf path {lidar_frame} <-> {cam_frame}; skipping extrinsics")

    out = {
        "source": "r2b_datacenter",
        "lidar_frame": lidar_frame,
        "cameras": cameras,
        "extrinsics": extrinsics,
        "tf_static_edges": [
            {"frame_id": e["frame_id"], "child_frame_id": e["child_frame_id"]}
            for e in tf_static
        ],
    }

    os.makedirs(Path(args.out).parent, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)

    print(f"Wrote {args.out}")
    print(f"  cameras: {list(cameras.keys())}")
    print(f"  extrinsics: {list(extrinsics.keys())}")
    print(f"  tf edges: {out['tf_static_edges']}")


if __name__ == "__main__":
    main()
