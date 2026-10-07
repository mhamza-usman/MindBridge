#!/bin/bash
# Generate replay JSONL files from NVIDIA r2b 2023 dataset
# Usage: ./tools/generate_replay.sh /path/to/r2bdataset2023_v3/r2b_datacenter

set -e

BAG_PATH=${1:-"./r2bdataset2023_v3/r2b_datacenter"}
OUTPUT_DIR="public/replay"

mkdir -p "$OUTPUT_DIR"

echo "Generating replay files from $BAG_PATH..."

# Nominal
python3 tools/bag_to_jsonl.py "$BAG_PATH" \
  --out "$OUTPUT_DIR/r2b_nominal.jsonl" --inject none

# Stale camera
python3 tools/bag_to_jsonl.py "$BAG_PATH" \
  --out "$OUTPUT_DIR/r2b_stale.jsonl" \
  --inject stale --stale-start 12.0 --stale-duration 8.0

# Camera vs LiDAR glare conflict
python3 tools/bag_to_jsonl.py "$BAG_PATH" \
  --out "$OUTPUT_DIR/r2b_conflict.jsonl" \
  --inject glare --glare-start 10.0 --glare-duration 6.0

# Evidence missing
python3 tools/bag_to_jsonl.py "$BAG_PATH" \
  --out "$OUTPUT_DIR/r2b_unknown.jsonl" \
  --inject unknown --unknown-start 8.0

echo "Done. Files generated in $OUTPUT_DIR"
