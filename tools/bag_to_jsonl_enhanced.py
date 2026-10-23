#!/usr/bin/env python3
"""
Enhanced converter for live telemetry visualization.
Implements manual binary parsing for ROS2 message types.

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
import struct
import numpy as np
from pathlib import Path
from rosbags.rosbag2 import Reader
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


def ns_to_s(ns: int) -> float:
    return ns / 1_000_000_000.0


def pick_topic(candidates: list, present: set) -> str | None:
    return next((t for t in candidates if t in present), None)


def parse_sensor_msgs_image(data: bytes) -> dict:
    """
    Manual parsing of sensor_msgs/msg/Image.
    Format: [header] [height][width][encoding][step][data...]
    Header varies, so we try to find the image data heuristically.
    """
    try:
        # sensor_msgs/Image structure:
        # std_msgs/Header (timestamp, frame_id)
        # uint32 height
        # uint32 width
        # string encoding
        # uint32 step
        # uint8[] data

        # Try to find the image data by looking for valid image dimensions
        # This is heuristic - in production use proper ROS2 deserialization

        # Skip header (first ~20-40 bytes typically)
        min_header = 20
        max_header = 100

        # Look for reasonable image dimensions (between 100 and 2000)
        for offset in range(min_header, max_header, 4):
            if offset + 8 > len(data):
                continue
            try:
                height = struct.unpack('<I', data[offset:offset+4])[0]
                width = struct.unpack('<I', data[offset+4:offset+8])[0]

                if 100 < height < 2000 and 100 < width < 2000:
                    # Found plausible dimensions
                    step_offset = offset + 8
                    if step_offset + 4 > len(data):
                        continue
                    step = struct.unpack('<I', data[step_offset:step_offset+4])[0]

                    # Validate step
                    if step >= width * 3 and step < width * 10:
                        data_offset = step_offset + 4
                        expected_size = height * step

                        if data_offset + expected_size <= len(data):
                            img_data = data[data_offset:data_offset+expected_size]

                            # Downsample
                            try:
                                img_array = np.frombuffer(img_data, dtype=np.uint8).reshape((height, width, 3))

                                # Downsample to MAX_IMAGE_SIZE
                                h, w = img_array.shape[:2]
                                scale = MAX_IMAGE_SIZE / max(h, w)
                                new_h, new_w = int(h * scale), int(w * scale)
                                img_resized = np.array(PILImage.fromarray(img_array).resize((new_w, new_h)))

                                # Convert to JPEG
                                buffered = io.BytesIO()
                                PILImage.fromarray(img_resized).save(buffered, format="JPEG", quality=65)
                                img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

                                return {
                                    'image_base64': img_base64,
                                    'width': new_w,
                                    'height': new_h,
                                    'has_image': True,
                                    'original_width': width,
                                    'original_height': height
                                }
                            except Exception as e:
                                pass
            except:
                continue
    except Exception as e:
        pass

    return {
        'image_base64': None,
        'width': 0,
        'height': 0,
        'has_image': False
    }


def parse_sensor_msgs_pointcloud2(data: bytes) -> dict:
    """
    Manual parsing of sensor_msgs/msg/PointCloud2.
    Format: [header] [height][width][fields][is_bigendian][point_step][data...]
    """
    try:
        # sensor_msgs/PointCloud2 structure:
        # Skip header (variable length)
        # Find height and width

        # Search for reasonable dimensions
        min_offset = 20
        max_offset = 100

        for offset in range(min_offset, max_offset, 4):
            if offset + 8 > len(data):
                continue
            try:
                height = struct.unpack('<I', data[offset:offset+4])[0]
                width = struct.unpack('<I', data[offset+4:offset+8])[0]

                if 10 < height < 1000 and 10 < width < 1000:
                    # Found plausible dimensions
                    point_step_offset = offset + 8 + 4 + 8  # height + width + fields + bigendian
                    if point_step_offset + 4 > len(data):
                        continue
                    point_step = struct.unpack('<I', data[point_step_offset:point_step_offset+4])[0]

                    # Validate point step (typically 16-32 bytes for XYZI)
                    if 12 < point_step < 64:
                        # Find data offset (after header, which varies)
                        # Try to find start of actual point data
                        # Look for region with many points
                        data_start = point_step_offset + 4

                        if data_start + point_step * 100 <= len(data):
                            # Extract first 100 points
                            points = []
                            num_points = min(100, (len(data) - data_start) // point_step)

                            for i in range(num_points):
                                pt_offset = data_start + i * point_step
                                if pt_offset + 12 <= len(data):
                                    x = struct.unpack('<f', data[pt_offset:pt_offset+4])[0]
                                    y = struct.unpack('<f', data[pt_offset+4:pt_offset+8])[0]
                                    z = struct.unpack('<f', data[pt_offset+8:pt_offset+12])[0]

                                    # Filter to reasonable range
                                    if -50 < x < 50 and -50 < y < 50 and -50 < z < 50:
                                        points.append({
                                            'x': round(x, 2),
                                            'y': round(y, 2),
                                            'z': round(z, 2)
                                        })

                            return {
                                'points': points,
                                'num_points': len(points),
                                'has_lidar': len(points) > 0,
                                'point_count': num_points
                            }
            except:
                continue
    except Exception as e:
        pass

    return {
        'points': [],
        'num_points': 0,
        'has_lidar': False
    }


def parse_sensor_msgs_imu(data: bytes) -> dict:
    """
    Manual parsing of sensor_msgs/msg/Imu.
    Format: [header] [orientation][orientation_covariance][angular_velocity][angular_velocity_covariance][linear_acceleration][linear_acceleration_covariance]
    Each quaternion/vector is 3 floats (12 bytes each)
    """
    try:
        # sensor_msgs/Imu structure:
        # Skip header
        # orientation (4 floats = 16 bytes)
        # orientation_covariance (9 floats = 36 bytes)
        # angular_velocity (3 floats = 12 bytes)
        # angular_velocity_covariance (9 floats = 36 bytes)
        # linear_acceleration (3 floats = 12 bytes)
        # linear_acceleration_covariance (9 floats = 36 bytes)

        # Try to find acceleration data (usually near the end)
        # IMU message is typically ~120-150 bytes total

        # Search for the last 12 bytes that could be acceleration
        for start_pos in range(len(data) - 48, max(0, len(data) - 150), -4):
            try:
                # Try to decode last 12 bytes as 3 floats (acceleration)
                if start_pos + 12 <= len(data):
                    accel = [
                        struct.unpack('<f', data[start_pos:start_pos+4])[0],
                        struct.unpack('<f', data[start_pos+4:start_pos+8])[0],
                        struct.unpack('<f', data[start_pos+8:start_pos+12])[0]
                    ]

                    # Check if values are reasonable (acceleration should be around -10 to 10 m/s^2 including gravity)
                    if all(-20 < a < 20 for a in accel):
                        # Try to find angular velocity (should be before acceleration)
                        gyro_start = start_pos - 48  # skip covariance
                        if gyro_start >= 0 and gyro_start + 12 <= len(data):
                            gyro = [
                                struct.unpack('<f', data[gyro_start:gyro_start+4])[0],
                                struct.unpack('<f', data[gyro_start+4:gyro_start+8])[0],
                                struct.unpack('<f', data[gyro_start+8:gyro_start+12])[0]
                            ]

                            accel_mag = (accel[0]**2 + accel[1]**2 + accel[2]**2)**0.5
                            gyro_mag = (gyro[0]**2 + gyro[1]**2 + gyro[2]**2)**0.5

                            return {
                                'accel_x': round(accel[0], 3),
                                'accel_y': round(accel[1], 3),
                                'accel_z': round(accel[2], 3),
                                'accel_mag': round(accel_mag, 3),
                                'gyro_x': round(gyro[0], 3),
                                'gyro_y': round(gyro[1], 3),
                                'gyro_z': round(gyro[2], 3),
                                'gyro_mag': round(gyro_mag, 3),
                                'has_imu': True
                            }
            except:
                continue
    except Exception as e:
        pass

    return {
        'accel_x': 0, 'accel_y': 0, 'accel_z': 0, 'accel_mag': 0,
        'gyro_x': 0, 'gyro_y': 0, 'gyro_z': 0, 'gyro_mag': 0,
        'has_imu': False
    }


def collect_sensor_data(bag_path: str):
    """Collect all sensor data with timestamps."""
    with Reader(bag_path) as r:
        present = {c.topic for c in r.connections}
        cam_topic = pick_topic(CAMERA_TOPIC_CANDIDATES, present)
        lidar_topic = pick_topic(LIDAR_TOPIC_CANDIDATES, present)
        imu_topic = pick_topic(IMU_TOPIC_CANDIDATES, present)

        if not cam_topic:
            print("ERROR: Camera topic not found")
            sys.exit(1)

        cam_data = []
        lidar_data = []
        imu_data = []

        conn_map = {c.topic: c for c in r.connections}

        # Camera
        if cam_topic:
            for conn, ts, data in r.messages(connections=[conn_map[cam_topic]]):
                t = ns_to_s(ts)
                metrics = parse_sensor_msgs_image(data)
                cam_data.append((t, metrics))

        # LiDAR
        if lidar_topic:
            for conn, ts, data in r.messages(connections=[conn_map[lidar_topic]]):
                t = ns_to_s(ts)
                metrics = parse_sensor_msgs_pointcloud2(data)
                lidar_data.append((t, metrics))

        # IMU
        if imu_topic:
            for conn, ts, data in r.messages(connections=[conn_map[imu_topic]]):
                t = ns_to_s(ts)
                metrics = parse_sensor_msgs_imu(data)
                imu_data.append((t, metrics))

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
