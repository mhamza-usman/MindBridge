# MindBridge Audit

## STEP 0: AUDIT FINDINGS

### 1. Constraints from AGENTS.md and other .md files

**Prime Directive (AGENTS.md):**
- Do NOT delete, rename, or move any existing file, component, route, hook, style, test, or config
- Do NOT change the shape of existing props, API responses, event names, or AG-UI messages
- New behavior goes in NEW files and NEW modules. Touch existing files only to mount new modules with small edits
- Everything new sits behind feature flags (default OFF)
- With flags OFF, the app must look and behave exactly as before
- Pure logic must be pure functions with unit tests
- Never label synthetic or replayed data as live. Source badge always visible: Synthetic, Replay, or Live
- Read-only product. Never sends commands to robots
- One commit per logical change
- After each phase: `git diff --stat --diff-filter=D` must show no deleted files

**Branch Strategy:**
- Currently on `feat/fleet-view` (Phase 7+ work)
- All Phase 7+ fleet work commits here
- Fleet branch must never branch from `main` directly (it branches from `feat/assurance-layer`)
- Fleet aggregator is read-only, never writes to robots
- "Halt rollout" action is an operator log entry only

**HARD RULE from brief:**
- Use only the original dataset. No synthetic, mock, random, placeholder, or generated telemetry anywhere
- If dataset lacks something, show "Not in dataset" state. Never fill it
- Dataset is replayed by timestamp-driven replay engine labeled REPLAY with dataset name and playback clock
- Anything derived is labeled DERIVED with its source

**UI Design System (AGENTS.md section 6):**
- Bright, light theme. Background: soft gradient wall in pale blue, peach, and lavender over #f4f7fc
- macOS-like, sleek, minimal
- Panels float: frosted white glass (rgba(255,255,255,.74), backdrop blur 26 px, saturate 170%), 20 px radius, soft shadow, 1 px hairline outline
- Thin translucent menu bar at the top
- Floating dock at bottom centre
- Type: system stack, mono for values
- Ink #1d1d1f, secondary #5f6470, accent #0a66ff
- State colours: Autonomous #1e8e4e, Degraded #a15c00, Supervised #c2410c, Unknown #5b6472, Blocked #c4162a
- State is never colour alone. Each state has colour, an icon, and its word
- Motion only in reply to the operator. No entrance animations
- Copy is plain and specific. No "guarantee", "safe", "unsafe"

### 2. Repo Map, UI Framework, State Flow, Telemetry Flow

**Framework:**
- Next.js 16.1.6 (App Router), React 19.2.4
- TailwindCSS v4
- CopilotKit AG-UI protocol (@copilotkit/react-core v1.57.4, @copilotkit/a2ui-renderer v1.57.4)
- Python backend with FastAPI, LangGraph

**Folder Map:**
- `/src/app`: Next.js routes (frontend)
- `/src/assurance`: Assurance layer domain, sources, fusion, incidents, fleet, UI
- `/src/components`: React components
- `/agent`: Python backend
- `/docs`: Documentation
- `/tools`: Utility scripts (bag conversion)
- `/public/replay`: JSONL replay files

**Key Files:**
- `src/assurance/ui/AssuranceShell.tsx` - Main UI shell with source switching
- `src/assurance/sources/replay.ts` - ReplaySource for JSONL replay
- `src/assurance/sources/synthetic.ts` - SyntheticSource for demo scenarios
- `src/assurance/fleet/FleetAggregator.ts` - Fleet state aggregation
- `src/assurance/fleet/syntheticFleet.ts` - Synthetic fleet data generator
- `src/assurance/telemetry/` - Telemetry dashboard components
- `tools/bag_to_jsonl.py` - Basic converter (timing data only)
- `tools/bag_to_jsonl_enhanced.py` - Enhanced converter (with sensor data extraction)
- `public/replay/*.jsonl` - Replay data files

**State Flow:**
1. EvidenceSource (SyntheticSource or ReplaySource) provides EvidenceSnapshot
2. ContractEvaluator checks assumptions against evidence
3. StateMachine computes AssuranceState based on violations, escalation, hold times
4. NeSyConf floor mapping can override state
5. UI renders state, evidence, and recommendations

**Telemetry Flow to UI:**
1. JSONL files in `public/replay/` contain replay data
2. SSE API routes (`/api/replay/[scenario]/route.ts`) stream JSONL lines
3. ReplaySource connects via EventSource, receives lines
4. ReplaySource converts raw fields to EvidenceSnapshot format
5. ReplaySource emits snapshot to listeners
6. UI components update via subscription

**Current Replay Files:**
- `r2b_nominal.jsonl` - 901 lines (90 seconds)
- `r2b_stale.jsonl` - 901 lines (stale camera fault injection)
- `r2b_conflict.jsonl` - 901 lines (glare conflict fault injection)
- `r2b_unknown.jsonl` - 901 lines (evidence missing fault injection)
- `r2b_telemetry.jsonl` - 901 lines (enhanced with camera, LiDAR, IMU data)

### 3. Dataset Inventory

**Dataset:** NVIDIA r2b 2023
**Location:** `/Users/admin/r2bdataset2023_v3/`
**Active sequence:** `r2b_datacenter` (warehouse-like environment)
**Other sequences:** r2b_cafe, r2b_hallway, r2b_hideaway, r2b_hope, r2b_lounge, r2b_mezzanine, r2b_storage

**r2b_datacenter details:**
- Duration: 5.0 seconds (looped to 90 seconds for replay)
- Total messages: 1981
- Compression: zstd
- Storage: sqlite3 (.db3)

**Topics and Message Counts:**
1. `hawk_0_left_rgb_image` - 150 messages (left RGB camera)
2. `hawk_0_right_rgb_image` - 150 messages (right RGB camera)
3. `hawk_0_left_rgb_camera_info` - 150 messages (left camera info)
4. `hawk_0_right_rgb_camera_info` - 150 messages (right camera info)
5. `d455_1_rgb_image` - 147 messages (D455 RGB camera)
6. `d455_1_depth_image` - 148 messages (D455 depth camera)
7. `d455_1_left_ir_image` - 148 messages (D455 left IR)
8. `d455_1_right_ir_image` - 148 messages (D455 right IR)
9. `d455_1_rgb_camera_info` - 148 messages (D455 RGB camera info)
10. `d455_1_depth_camera_info` - 148 messages (D455 depth camera info)
11. `d455_1_left_ir_camera_info` - 147 messages (D455 left IR camera info)
12. `d455_1_right_ir_camera_info` - 148 messages (D455 right IR camera info)
13. `d455_1_imu` - 148 messages (IMU)
14. `pandar_xt_32_0_lidar` - 50 messages (LiDAR point cloud)
15. `/tf_static` - 1 message (static transforms)

**Robots in dataset:**
- **DOES NOT EXIST** - The dataset contains sensor data from a single robot configuration (hawk_0 and d455_1 cameras, pandar_xt_32_0 LiDAR). There is NO multi-robot data, NO robot IDs, NO robot-level organization in the bag.

**Cameras per robot:**
- hawk_0: left_rgb, right_rgb (2 cameras)
- d455_1: rgb, depth, left_ir, right_ir (4 cameras)
- **Total: 6 cameras** in the dataset

**LiDAR:**
- pandar_xt_32_0: 1 LiDAR sensor (50 messages)

**IMU:**
- d455_1_imu: 1 IMU sensor (148 messages)

**Pose:**
- **DOES NOT EXIST** - No pose topic (no /odom, no /amcl_pose, no robot pose data in the bag)
- **DOES NOT EXIST** - No navigation path or goal data

**Battery:**
- **DOES NOT EXIST** - No battery topic in the bag

**Topic Rates (approximate from message counts / duration):**
- hawk_0 cameras: ~30 Hz (150 messages / 5s)
- d455_1 cameras: ~29-30 Hz (147-148 messages / 5s)
- d455_1 IMU: ~29.6 Hz (148 messages / 5s)
- pandar_xt_32_0 LiDAR: ~10 Hz (50 messages / 5s)

**Real Anomalies or Failures in Dataset:**
- **NONE DETECTED** - The r2b_datacenter bag appears to be a nominal recording. All sensor data is present and continuous. There are no natural faults (stale sensors, dropped frames, calibration errors) in the raw bag data.

- Fault injections are artificial (injected by the converter script):
  - `--inject stale`: Camera stale after X seconds
  - `--inject glare`: Camera/LiDAR conflict after X seconds
  - `--inject unknown`: Evidence missing after X seconds

### 4. What is Currently Mocked/Synthetic

**Files with mock/fake/placeholder/random/synthetic references:**

1. **`src/assurance/sources/synthetic.ts`** - ENTIRE FILE is synthetic
   - Generates scripted scenarios (nominal, stale, conflict, unknown)
   - All values are synthetic (randomized within ranges)
   - **MUST BE REPLACED** with dataset-driven replay only

2. **`src/assurance/fleet/syntheticFleet.ts`** - ENTIRE FILE is synthetic
   - Generates synthetic fleet of 8 robots
   - Creates fake robot IDs (RB-01 to RB-08)
   - Creates fake firmware versions
   - Creates fake rollout state
   - **MUST BE REPLACED** - dataset has no multi-robot data, should show "Not in dataset"

3. **`src/app/api/fleet/stream/route.ts`** - Uses synthetic fleet
   - Returns data from `createSyntheticFleet()`
   - **MUST BE REPLACED** - no real fleet data in dataset

4. **`src/assurance/ui/AssuranceShell.tsx`** - References synthetic
   - Imports SyntheticSource
   - Has synthetic scenario dropdown (now hidden behind feature flag)
   - Has fallback to SyntheticSource in source factory
   - **MUST BE REPLACED** - remove synthetic source, use only replay

5. **`src/assurance/ui/DatasetImporter.tsx`** - Has placeholder
   - Alert says "Coming soon" for dataset import
   - **MUST BE REPLACED** - implement actual GitHub/Kaggle fetching

6. **`src/assurance/fusion/detector.test.ts`** - Has synthetic test data
   - Uses synthetic fault injection for testing
   - **OK for tests** - unit tests can use synthetic data to verify logic

7. **`src/assurance/baseline/harness.ts`** - Has synthetic test data
   - Uses synthetic scenarios for baseline comparison
   - **OK for tests** - unit tests can use synthetic data

8. **`src/assurance/incidents/recorder.ts`** - References synthetic
   - Comment mentions synthetic scenarios
   - **OK** - recorder is data-agnostic, can record any source

**What is NOT mocked (real data from dataset):**
- `src/assurance/sources/replay.ts` - Reads real JSONL from bag
- `tools/bag_to_jsonl.py` - Extracts real timing data from bag
- `tools/bag_to_jsonl_enhanced.py` - Extracts real camera, LiDAR, IMU from bag
- `public/replay/*.jsonl` - All contain real extracted data from r2b_datacenter
- `src/assurance/telemetry/` components - Render real data from telemetry JSONL

**Summary of "Not in dataset" gaps:**
- Multi-robot data (dataset has single robot)
- Robot IDs (dataset has no robot identifiers)
- Pose/odometry (dataset has no pose topic)
- Battery data (dataset has no battery topic)
- Navigation paths/goals (dataset has no nav data)
- Map/layout (dataset has no map file)
- Real faults (dataset is nominal, faults are injected)
- Firmware versions (dataset has no version info)
- Rollout state (dataset has no rollout info)

**Action Required:**
- Remove or replace all non-test synthetic references
- Show "Not in dataset" for features requiring data that doesn't exist
- Fleet view must show "Not in dataset" (single robot in dataset)
- Floor map must be DERIVED from pose (pose doesn't exist) or show "Not in dataset"
- Battery must show "Not in dataset"
