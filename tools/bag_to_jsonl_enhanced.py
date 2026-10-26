#!/usr/bin/env python3
"""
Enhanced converter using proper ROS2 message deserialization.
Extracts REAL camera images and LiDAR point clouds from bags.

Dependencies:
    pip install rosbags numpy pillow

Usage:
    python3 tools/bag_to_jsonl_enhanced.py /path/to/sequence --out public/replay/r2b_telemetry.jsonl
"""

import argparse
import json
import os
import sys
import base64
import numpy as np
from pathlib import Path
from rosbags.highlevel import AnyReader
from rosbags.typesys import Stores, get_typestore
from PIL import Image as PILImage
import io

# Topic candidates
CAMERA_TOPIC_CANDIDATES  = [
    "hawk_0_left_rgb_image",
    "/hawk_0_left_rgb_image",
    "/camera/image_raw",
    "/rgb/image_raw",
]
LIDAR_TOPIC_CANDIDATES   = [
    "pandar_xt_32_0_lidar",
    "/pandar_xt_32_0_lidar",
    "/hesai/pandar_points",
]
IMU_TOPIC_CANDIDATES     = ["d455_1_imu", "/d455_1_imu", "/vectornav/IMU"]

SAMPLE_STEP_S = 0.1
MAX_IMAGE_SIZE = 240


def pick_topic(candidates: list, present: set) -> str | None:
    return next((t for t in candidates if t in present), None)


def collect_sensor_data(bag_path: str):
    """Collect all sensor data with timestamps using proper deserialization."""
    bagpath = Path(bag_path)

    # Try different ROS2 typestores
    typestore = None
    for store_name in [Stores.ROS2_HUMBLE, Stores.ROS2_IRON, Stores.ROS2_JAZZY]:
        try:
            typestore = get_typestore(store_name)
            print(f"Using typestore: {store_name}")
            break
        except Exception as e:
            print(f"Failed with {store_name}: {e}")

    if not typestore:
        raise Exception("Could not get typestore")

    cam_data = []
    lidar_data = []
    imu_data = []

    with AnyReader([bagpath], default_typestore=typestore) as reader:
        present = {c.topic for c in reader.connections}
        cam_topic = pick_topic(CAMERA_TOPIC_CANDIDATES, present)
        lidar_topic = pick_topic(LIDAR_TOPIC_CANDIDATES, present)
        imu_topic = pick_topic(IMU_TOPIC_CANDIDATES, present)

        if not cam_topic:
            print("ERROR: Camera topic not found")
            sys.exit(1)

        print(f"Camera topic: {cam_topic}")
        print(f"LiDAR topic: {lidar_topic}")
        print(f"IMU topic: {imu_topic}")

        # Camera
        if cam_topic:
            connections = [c for c in reader.connections if c.topic == cam_topic]
            for connection, timestamp, rawdata in reader.messages(connections=connections):
                msg = reader.deserialize(rawdata, connection.msgtype)
                t = timestamp / 1_000_000_000.0

                # Downsample image
                try:
                    img_array = np.frombuffer(msg.data, dtype=np.uint8).reshape((msg.height, msg.width, 3))
                    h, w = img_array.shape[:2]
                    scale = MAX_IMAGE_SIZE / max(h, w)
                    new_h, new_w = int(h * scale), int(w * scale)
                    img_resized = np.array(PILImage.fromarray(img_array).resize((new_w, new_h)))

                    buffered = io.BytesIO()
                    PILImage.fromarray(img_resized).save(buffered, format="JPEG", quality=65)
                    img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

                    cam_data.append((t, {
                        'image_base64': img_base64,
                        'width': new_w,
                        'height': new_h,
                        'has_image': True,
                        'original_width': msg.width,
                        'original_height': msg.height
                    }))
                except Exception as e:
                    print(f"Warning: Could not process image at t={t}: {e}")
                    cam_data.append((t, {
                        'image_base64': None,
                        'width': 0,
                        'height': 0,
                        'has_image': False
                    }))

        # LiDAR
        if lidar_topic:
            connections = [c for c in reader.connections if c.topic == lidar_topic]
            for connection, timestamp, rawdata in reader.messages(connections=connections):
                msg = reader.deserialize(rawdata, connection.msgtype)
                t = timestamp / 1_000_000_000.0

                try:
                    # PointCloud2 has fields: x, y, z, intensity, etc.
                    # data is bytes, need to parse based on point_step
                    point_step = msg.point_step
                    num_points = len(msg.data) // point_step

                    points = []
                    for i in range(min(100, num_points)):  # Limit to 100 points
                        offset = i * point_step
                        if offset + 12 <= len(msg.data):
                            x = np.frombuffer(msg.data[offset:offset+4], dtype=np.float32)[0]
                            y = np.frombuffer(msg.data[offset+4:offset+8], dtype=np.float32)[0]
                            z = np.frombuffer(msg.data[offset+8:offset+12], dtype=np.float32)[0]

                            if -50 < x < 50 and -50 < y < 50 and -50 < z < 50:
                                points.append({
                                    'x': round(float(x), 2),
                                    'y': round(float(y), 2),
                                    'z': round(float(z), 2)
                                })

                    lidar_data.append((t, {
                        'points': points,
                        'num_points': len(points),
                        'has_lidar': len(points) > 0,
                        'point_count': num_points
                    }))
                except Exception as e:
                    print(f"Warning: Could not process LiDAR at t={t}: {e}")
                    lidar_data.append((t, {
                        'points': [],
                        'num_points': 0,
                        'has_lidar': False
                    }))

        # IMU
        if imu_topic:
            connections = [c for c in reader.connections if c.topic == imu_topic]
            for connection, timestamp, rawdata in reader.messages(connections=connections):
                msg = reader.deserialize(rawdata, connection.msgtype)
                t = timestamp / 1_000_000_000.0

                try:
                    accel_mag = (msg.linear_acceleration.x**2 + msg.linear_acceleration.y**2 + msg.linear_acceleration.z**2)**0.5
                    gyro_mag = (msg.angular_velocity.x**2 + msg.angular_velocity.y**2 + msg.angular_velocity.z**2)**0.5

                    imu_data.append((t, {
                        'accel_x': round(float(msg.linear_acceleration.x), 3),
                        'accel_y': round(float(msg.linear_acceleration.y), 3),
                        'accel_z': round(float(msg.linear_acceleration.z), 3),
                        'accel_mag': round(float(accel_mag), 3),
                        'gyro_x': round(float(msg.angular_velocity.x), 3),
                        'gyro_y': round(float(msg.angular_velocity.y), 3),
                        'gyro_z': round(float(msg.angular_velocity.z), 3),
                        'gyro_mag': round(float(gyro_mag), 3),
                        'has_imu': True
                    }))
                except Exception as e:
                    print(f"Warning: Could not process IMU at t={t}: {e}")
                    imu_data.append((t, {
                        'accel_x': 0, 'accel_y': 0, 'accel_z': 0, 'accel_mag': 0,
                        'gyro_x': 0, 'gyro_y': 0, 'gyro_z': 0, 'gyro_mag': 0,
                        'has_imu': False
                    }))

        # Compute duration
        all_times = [t for t, _ in cam_data]
        if all_times:
            t_start = min(all_times)
            t_end = max(all_times)
            duration = t_end - t_start

            # Make times relative
            cam_data = [(t - t_start, m) for t, m in cam_data]
            lidar_data = [(t - t_start, m) for t, m in lidar_data]
            imu_data = [(t - t_start, m) for t, m in imu_data]
        else:
            duration = 0.0

    return cam_data, lidar_data, imu_data, duration


def get_latest_data(data_list, query_t):
    """Get most recent data at or before query time."""
    if not data_list:
        return {}
    latest = None
    latest_t = -1
    for t, metrics in data_list:
        if t <= query_t and t > latest_t:
            latest_t = t
            latest = metrics
    return latest if latest else {}


def generate(bag_path: str, args):
    cam_data, lidar_data, imu_data, duration = collect_sensor_data(bag_path)

    print(f"Collected {len(cam_data)} camera frames, {len(lidar_data)} LiDAR scans, {len(imu_data)} IMU readings")
    print(f"Duration: {duration:.1f}s")

    # Count successful extractions
    cam_success = sum(1 for _, m in cam_data if m.get('has_image'))
    lidar_success = sum(1 for _, m in lidar_data if m.get('has_lidar'))
    imu_success = sum(1 for _, m in imu_data if m.get('has_imu'))

    print(f"Successfully extracted: {cam_success} images, {lidar_success} LiDAR scans, {imu_success} IMU readings")

    events = []
    t = 0.0

    while t <= duration:
        # Get latest sensor data
        cam_metrics = get_latest_data(cam_data, t)
        lidar_metrics = get_latest_data(lidar_data, t)
        imu_metrics = get_latest_data(imu_data, t)

        # Compute sensor ages
        cam_ts = [dt for dt, _ in cam_data]
        lidar_ts = [dt for dt, _ in lidar_data]

        cam_age = 9999.0 if not cam_ts else (t - max([ts for ts in cam_ts if ts <= t], default=t)) * 1000
        lidar_age = 9999.0 if not lidar_ts else (t - max([ts for ts in lidar_ts if ts <= t], default=t)) * 1000

        # Only include image data every 10 frames (1 second) to save bandwidth
        include_image = int(t * 10) % 10 == 0

        event = {
            't': round(t, 2),
            'source': 'r2b_live_telemetry',
            'cam_age_ms': round(cam_age, 1),
            'lidar_age_ms': round(lidar_age, 1),
            'camera': cam_metrics if include_image else None,
            'lidar': lidar_metrics,
            'imu': imu_metrics,
            'cam_rate': round(len([ts for ts in cam_ts if t-1 <= ts <= t]), 1),
            'lidar_rate': round(len([ts for ts in lidar_ts if t-1 <= ts <= t]), 1),
        }

        events.append(event)
        t = round(t + SAMPLE_STEP_S, 3)

    return events


def main():
    p = argparse.ArgumentParser()
    p.add_argument("bag_path", help="Path to r2b sequence")
    p.add_argument("--out", default="public/replay/r2b_telemetry.jsonl")
    p.add_argument("--loop-to", type=float, default=0.0, help="Loop to N seconds")
    args = p.parse_args()

    os.makedirs(Path(args.out).parent, exist_ok=True)
    print(f"Processing {args.bag_path}...")

    rows = generate(args.bag_path, args)

    # Loop if requested
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

    with open(args.out, 'w') as f:
        for row in rows:
            f.write(json.dumps(row) + '\n')

    print(f"Wrote {len(rows)} events to {args.out}")
    print(f"Duration: {rows[-1]['t']:.1f}s")


if __name__ == "__main__":
    main()
