#!/usr/bin/env python3
import json
import sys

def main():
    if len(sys.argv) < 3:
        print("Usage: export_bag.py <input.mcap/bag> <output.jsonl>")
        sys.exit(1)
        
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    
    print(f"Stub: Would read {input_file} and extract /scan, /camera/image_raw freshness")
    print(f"Stub: Exporting to {output_file}")
    
    with open(output_file, 'w') as f:
        f.write(json.dumps({
            "t": 1000,
            "evidence": {
                "camera_age_ms": 80,
                "lidar_age_ms": 60,
                "tf_age_ms": 45,
                "localization_std_m": 0.032,
                "battery_reserve_pct": 78,
                "calibration_valid": True,
                "sensors_agree": True
            }
        }) + '\n')
        
if __name__ == "__main__":
    main()
