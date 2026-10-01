# Replay JSONL Schema

The `ReplaySource` reads a JSONL export of a recorded ROS2 bag or MCAP file.
Each line is a JSON object representing one evidence snapshot in time.

## Format

```json
{
  "t": 1698765432100,
  "evidence": {
    "camera_age_ms": 80,
    "lidar_age_ms": 60,
    "tf_age_ms": 45,
    "localization_std_m": 0.032,
    "battery_reserve_pct": 78,
    "calibration_valid": true,
    "sensors_agree": true
  }
}
```

- `t`: Epoch timestamp in milliseconds.
- `evidence`: A flat key-value mapping of the sensor metrics and facts extracted from ROS2 topics. These keys must match the assumption IDs in the `warehouse_navigation` contract for the evaluator to process them.
