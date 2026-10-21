#!/usr/bin/env python3
"""
Convert an NVIDIA r2b ROS2 .db3 bag to MindBridge JSONL replay format.

Dependencies (no ROS2 needed):
    pip install rosbags numpy

Usage:
    # Check topics first:
    python3 tools/bag_to_jsonl.py /path/to/sequence --list-topics

    # Nominal (no fault):
    python3 tools/bag_to_jsonl.py /path/to/sequence --out public/replay/r2b_nominal.jsonl

    # Stale camera fault:
    python3 tools/bag_to_jsonl.py /path/to/sequence --out public/replay/r2b_stale.jsonl \
        --inject stale --stale-start 12.0 --stale-duration 8.0

    # Camera vs LiDAR glare conflict:
    python3 tools/bag_to_jsonl.py /path/to/sequence --out public/replay/r2b_conflict.jsonl \
        --inject glare --glare-start 10.0 --glare-duration 6.0

    # Evidence missing:
    python3 tools/bag_to_jsonl.py /path/to/sequence --out public/replay/r2b_unknown.jsonl \
        --inject unknown --unknown-start 8.0
"""

import argparse
import json
import os
import sys
from pathlib import Path
from rosbags.rosbag2 import Reader

# ---------------------------------------------------------------
# UPDATE these after running --list-topics on the actual bag.
# These are the expected names for r2b_datacenter in r2bdataset2023.
# The script will print actual names and exit if none match.
# ---------------------------------------------------------------
CAMERA_TOPIC_CANDIDATES  = [
    "hawk_0_left_rgb_image",
    "/hawk_0_left_rgb_image",
    "/camera/image_raw",
    "/rgb/image_raw",
    "/left/image_raw",
]
LIDAR_TOPIC_CANDIDATES   = [
    "pandar_xt_32_0_lidar",
    "/pandar_xt_32_0_lidar",
    "/hesai/pandar_points",
    "/lidar/points",
    "/velodyne_points",
    "/scan",
    "/points",
]
TF_TOPIC_CANDIDATES      = ["/tf", "/tf_static"]
IMU_TOPIC_CANDIDATES     = ["d455_1_imu", "/d455_1_imu", "/vectornav/IMU", "/imu/data", "/imu"]
ODOM_TOPIC_CANDIDATES    = ["/odom", "/wheel_odom", "/odometry/filtered"]

LIMIT_CAMERA_MS  = 200.0
LIMIT_LIDAR_MS   = 200.0
LIMIT_TF_MS      = 500.0
SAMPLE_STEP_S    = 0.1   # one JSONL line per 100 ms


def ns_to_s(ns: int) -> float:
    return ns / 1_000_000_000.0


def pick_topic(candidates: list, present: set) -> str | None:
    return next((t for t in candidates if t in present), None)


def collect_timestamps(bag_path: str) -> tuple[dict, float, float]:
    topic_ts: dict[str, list[float]] = {}
    with Reader(bag_path) as r:
        present = {c.topic for c in r.connections}
        cam   = pick_topic(CAMERA_TOPIC_CANDIDATES,  present)
        lidar = pick_topic(LIDAR_TOPIC_CANDIDATES,   present)
        tf    = pick_topic(TF_TOPIC_CANDIDATES,       present)
        imu   = pick_topic(IMU_TOPIC_CANDIDATES,      present)
        odom  = pick_topic(ODOM_TOPIC_CANDIDATES,     present)

        wanted = [t for t in [cam, lidar, tf, imu, odom] if t]
        for topic in wanted:
            topic_ts[topic] = []

        conn_map = {c.topic: c for c in r.connections}
        for conn, ts, _ in r.messages(connections=[conn_map[t] for t in wanted]):
            topic_ts[conn.topic].append(ns_to_s(ts))

        t_start = min(min(v) for v in topic_ts.values() if v)
        t_end   = max(max(v) for v in topic_ts.values() if v)

    # Make relative
    rel: dict[str, list[float]] = {}
    for topic, ts in topic_ts.items():
        rel[topic] = sorted(t - t_start for t in ts)

    return rel, cam, lidar, tf, t_end - t_start


def age_at(ts_list: list[float], query: float) -> float:
    """Age in ms of the most recent message at or before query."""
    if not ts_list:
        return 9999.0
    idx = None
    for t in ts_list:
        if t <= query:
            idx = t
        else:
            break
    return (query - idx) * 1000.0 if idx is not None else 9999.0


def rate_at(ts_list: list[float], query: float, window: float = 2.0) -> float:
    return sum(1 for t in ts_list if query - window <= t <= query) / window


def derive_state(cam_age: float, lidar_age: float,
                 sensors_agree: bool, history_violated: bool) -> str:
    if cam_age > 1500 or lidar_age > 1500:
        return "Unknown"
    violated = cam_age > LIMIT_CAMERA_MS or lidar_age > LIMIT_LIDAR_MS or not sensors_agree
    if violated:
        return "Supervised" if history_violated else "Degraded"
    return "Autonomous"


def generate(bag_path: str, args) -> list[dict]:
    ts_map, cam_topic, lidar_topic, tf_topic, duration = collect_timestamps(bag_path)

    if not cam_topic or not lidar_topic:
        print("ERROR: Required topics not found. Run with --list-topics to see what is available.")
        sys.exit(1)

    cam_ts   = ts_map.get(cam_topic,   [])
    lidar_ts = ts_map.get(lidar_topic, [])
    tf_ts    = ts_map.get(tf_topic,    []) if tf_topic else []

    inject        = args.inject
    stale_start   = args.stale_start
    stale_end     = stale_start + args.stale_duration
    glare_start   = args.glare_start
    glare_end     = glare_start + args.glare_duration
    unknown_start = args.unknown_start

    events: list[dict] = []
    t = 0.0

    while t <= duration:
        cam_age   = age_at(cam_ts,   t)
        lidar_age = age_at(lidar_ts, t)
        tf_age    = age_at(tf_ts,    t) if tf_ts else 45.0
        cam_rate  = rate_at(cam_ts,  t)

        glare_detected = False
        sensors_agree  = True
        conflict_at_m  = None
        saturated_px   = 0.0

        # ---- INJECT: stale camera ----
        if inject == "stale" and stale_start <= t <= stale_end:
            progress  = (t - stale_start) / args.stale_duration
            cam_age   = 450.0 + progress * 150.0
            cam_rate  = 6.0

        # ---- INJECT: camera vs LiDAR glare conflict ----
        elif inject == "glare" and glare_start <= t <= glare_end:
            saturated_px   = 8.4
            glare_detected = True
            sensors_agree  = False
            conflict_at_m  = 3.2
            cam_age        = min(cam_age, 90.0)
            lidar_age      = min(lidar_age, 70.0)

        # ---- INJECT: evidence missing ----
        elif inject == "unknown" and t >= unknown_start:
            cam_age   = 1900.0
            lidar_age = 9999.0

        # State: check if violation has persisted over last 20 frames (~2 s)
        history_violated = any(
            e.get("cam_violated") or e.get("lidar_violated")
            for e in events[-20:]
        )

        cam_violated   = cam_age   > LIMIT_CAMERA_MS
        lidar_violated = lidar_age > LIMIT_LIDAR_MS
        state = derive_state(cam_age, lidar_age, sensors_agree, history_violated)

        base_conf = max(0.0, 92.0 - cam_age * 0.08 - lidar_age * 0.05)

        events.append({
            "t"                 : round(t, 2),
            "source"            : "replay_r2b_2023",
            "cam_age_ms"        : round(cam_age,   1),
            "lidar_age_ms"      : round(lidar_age, 1),
            "tf_age_ms"         : round(tf_age,    1),
            "cam_rate_hz"       : round(cam_rate,  1),
            "saturated_px_pct"  : round(saturated_px, 2),
            "glare_detected"    : glare_detected,
            "sensors_agree"     : sensors_agree,
            "conflict_at_m"     : conflict_at_m,
            "battery_pct"       : 78.0,
            "calibration_valid" : True,
            "perception_pct"    : round(min(100.0, base_conf), 1),
            "uncertainty_pct"   : round(max(0.0, 100.0 - base_conf), 1),
            "state"             : state,
            # internal - used for escalation logic, not rendered
            "cam_violated"      : cam_violated,
            "lidar_violated"    : lidar_violated,
        })

        t = round(t + SAMPLE_STEP_S, 3)

    return events


def list_topics(bag_path: str) -> None:
    with Reader(bag_path) as r:
        t0 = r.start_time
        t1 = r.end_time
        print(f"Duration : {(t1 - t0) / 1e9:.1f} s")
        print(f"Messages : {sum(c.msgcount for c in r.connections)}")
        print("\nTopics (sorted by message count):")
        for c in sorted(r.connections, key=lambda x: -x.msgcount):
            print(f"  {c.msgcount:6d}  {c.topic:<60s}  {c.msgtype}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("bag_path", help="Path to the r2b sequence folder")
    p.add_argument("--list-topics", action="store_true")
    p.add_argument("--out",              default="public/replay/r2b_nominal.jsonl")
    p.add_argument("--inject",           choices=["none","stale","glare","unknown"], default="none")
    p.add_argument("--stale-start",      type=float, default=12.0)
    p.add_argument("--stale-duration",   type=float, default=8.0)
    p.add_argument("--glare-start",      type=float, default=10.0)
    p.add_argument("--glare-duration",   type=float, default=6.0)
    p.add_argument("--unknown-start",    type=float, default=8.0)
    p.add_argument("--loop-to", type=float, default=0.0,
                   help="Loop output until this many seconds. 0 = no loop.")
    args = p.parse_args()

    if args.list_topics:
        list_topics(args.bag_path)
        return

    os.makedirs(Path(args.out).parent, exist_ok=True)
    print(f"Bag   : {args.bag_path}")
    print(f"Inject: {args.inject}")

    rows = generate(args.bag_path, args)

    if args.loop_to > 0 and rows:
        original = rows[:]
        orig_dur = original[-1]['t']
        offset = round(orig_dur + 0.1, 3)
        while rows[-1]['t'] < args.loop_to:
            for row in original:
                new_row = dict(row)
                new_row['t'] = round(row['t'] + offset, 2)
                rows.append(new_row)
                if rows[-1]['t'] >= args.loop_to:
                    break
            offset = round(offset + orig_dur + 0.1, 3)
        rows = [r for r in rows if r['t'] <= args.loop_to]

    with open(args.out, "w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["state"]] = counts.get(r["state"], 0) + 1

    print(f"Wrote  : {len(rows)} events -> {args.out}")
    print(f"Duration: {rows[-1]['t']:.1f} s")
    for state, n in counts.items():
        print(f"  {state}: {n} frames  ({n * SAMPLE_STEP_S:.1f} s)")


if __name__ == "__main__":
    main()
