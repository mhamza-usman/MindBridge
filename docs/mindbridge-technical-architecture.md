# MindBridge: Technical Architecture (v2)

Updated 29 Sep 2026. Replaces v1.

---

## 0. What changed from v1, and why

v1 was written as if MindBridge did not exist yet. It does. It is live, so v2 extends it.

| Change | Reason |
|---|---|
| Starts from the existing live product (AG-UI, NeSyConf, five modes, Cloud Run) | v1 ignored all of it |
| Added Component 7: Sensor Fusion Conflict Detector | Operators want the system to narrow down the cause before handing over, especially camera and LiDAR disagreement from glare, dust, reflective floors, and temporary obstacles |
| All performance and speed numbers are now TARGETS, marked "not measured" | v1 stated 40% faster detection, 8 to 12 s human lag, 15 to 9 min diagnosis, 50 Hz loop as if measured. None were |
| Removed "root cause 92%" style outputs | Those percentages were invented. Causes are now ranked by evidence match, not probability |
| Conformal prediction described correctly | v1 mixed it with hand-set penalties (+15%, +50%) and a 30-day age check. Those are heuristics, and are labelled as such |
| "99.3% mission completion" removed from calibration data | It is an outcome, not calibration data. Do not use it publicly until documented |
| Read-only by default | v1 had the state machine "take remote control" and "safe stop" the robot. v2 only recommends |
| Removed "cannot guarantee" and "first product to explain why robots fail" | Guarantee language is a liability. Ferronyx already does root-cause analysis |
| Fusion diagnosis limited to camera and LiDAR, four causes | Prevents drifting into a generic AI debugging tool, which the research warned against |

---

## 1. What already exists (VERIFY against the repo)

- MindBridge web app on Google Cloud Run, repo `github.com/mhamza-usman/MindBridge`
- Generative robot operations UI on CopilotKit's AG-UI protocol
- NeSyConf: fused confidence across perception, plan certainty, task success, system uncertainty
- Five UI modes driven by NeSyConf: Autonomous, Monitoring, Advisory, Intervention, Emergency
- Transitions between autonomous operation and human-in-the-loop states

Rule for everything below: it is ADDED to this. Nothing above is removed, renamed, or rewired without Hamza's approval.

Previously planned next steps and where they went:

| Planned | Status in v2 |
|---|---|
| CASSANDRA as second telemetry source | Deferred. Only the plugin interface (`EvidenceSource`) is built now |
| Multi-robot fleet view | LIVE in the dashboard. 8-robot synthetic fleet, banner, rollout control, fleet event log, click-to-inspect per robot |
| Operator action layer (acknowledge, override, escalate) | Kept, as LOGGED decisions. It never commands the robot in v1 |
| NeSyConf-equivalent for CASSANDRA (audio only) | Open. Not on the critical path |
| Company name (Keel, Datum, Certum, Fulcrum) | Separate track. Checks pending, Keel first |

---

## 2. System overview

Two runtimes. The edge monitor is new. The web app is the existing product, extended.

```
ROBOT (ROS2)
  /camera  /lidar  /tf  /odom  /diagnostics  + perception detections
        |
        v
EDGE MONITOR (new, Python, read-only, runs on or next to the robot)
  1 Sensor intake
  2 Contract evaluator
  3 Uncertainty gate (NeSy-IV)
  4 Causal evidence mapper
  7 Sensor fusion conflict detector          <- new in v2
  5 Assurance state machine
  6 Incident recorder
        |
        |  evidence events (JSON over WebSocket, or replay file)
        v
MINDBRIDGE WEB APP (existing, extended)
  NeSyConf views (unchanged)  +  assurance layer (new, behind a flag)
  Operator UI: dock, floating panels, replay
        |
        v (optional)
CLOUD: hosted demo (replay and synthetic only), fleet analytics later
```

Local-first: the continue, degrade, supervise decision is computed on the edge monitor. The cloud never owns it. The Cloud Run deployment is a demo and review surface fed by replay and synthetic data until a live source is connected.

Evidence source adapters (all implement one interface):

| Source | Purpose | Status |
|---|---|---|
| SyntheticSource | Scripted fault scenarios for demos. Always labelled synthetic | Build first |
| ReplaySource | Reads a recorded ROS2 bag exported to JSONL | Build second |
| LiveSource | ROS2 monitor over WebSocket or rosbridge | Third |
| AcousticSource (CASSANDRA) | Sensor-health plugin | Later |

---

## 3. Components

### 1. Sensor intake

Input: ROS2 topics. Output: a timestamped cache with freshness per stream.

- Store receive time and message time per topic
- Freshness = now minus message time (use message time, not receive time, so network delay shows up)
- QoS check: compare publisher and subscriber policies (reliability, durability, deadline, liveliness). Flag mismatches
- Topic rate against expected rate

### 2. Contract evaluator

Input: sensor cache, mission contract (YAML). Output: per-assumption status and overall contract status.

```yaml
mission: warehouse_navigation
required_topics: [/scan, /camera/image_raw, /odom, /tf]
assumptions:
  camera_age_ms:      { max: 200 }
  lidar_age_ms:       { max: 200 }
  tf_age_ms:          { max: 500 }
  localization_std_m: { max: 0.05 }
  battery_reserve_pct:{ min: 20 }
  calibration_valid:  { equals: true }
  sensors_agree:      { equals: true }      # fed by component 7
  restricted_zones:   { none: true }
modes:
  normal: autonomous
  soft_violation: supervised
  hard_violation: pause_and_request_operator
```

All limits above are placeholders. Tune them from real data, per robot and environment.

### 3. Uncertainty gate (NeSy-IV)

NeSy-IV is the calibrated uncertainty engine inside MindBridge. It is not the product.

What it does: wraps a defined score in a conformal prediction set, and reports whether that set is still valid.

What it must show with every estimate:
- Coverage target (for example 90%)
- Calibration set version and age
- Environment class the calibration covers
- Drift status
- Valid or invalid, and what happens when invalid

Honest limits:
- Conformal guarantees assume exchangeable data. Robot data is sequential and shifts between sites. Coverage can be wrong after a change. Test with blocked time splits and leave-one-robot-out
- The hand-set penalties in v1 (+15% low light, +50% both stale) are heuristics. They stay as clearly named fallback rules until calibration data replaces them
- "Calibration age under 30 days" is a placeholder validity rule, not drift detection

When the estimate is invalid the gate outputs UNKNOWN. It does not fake a number.

### 4. Causal evidence mapper

Builds the chain shown to the operator: sensor evidence, perception effect, navigation effect, mission effect. Every link must cite the evidence event that supports it. No link without evidence.

Example chain: camera topic rate drops → camera frames stale → perception uncertainty widens → planner works from old data → mission contract violated → recommend operator review.

The chain is built by deterministic rules. A language model may rephrase it for the operator. It must not decide it.

### 5. Assurance state machine

Five states, plus recommendations. Read-only.

| State | Meaning | Recommendation shown |
|---|---|---|
| Autonomous | All required evidence valid, contract satisfied | Continue |
| Degraded | Inside a warning band, or one soft violation | Slow down, watch closely |
| Supervised | Soft violation persists, or sensors disagree | Request operator review |
| Unknown | Evidence stale, missing, or calibration invalid | Request operator review, do not proceed on autopilot |
| Blocked | Hard constraint violated | Pause mission |

Rules:
- Precedence when several apply: Blocked, Unknown, Supervised, Degraded, Autonomous
- Escalation: Degraded moves to Supervised if the violation persists past a set time (default 20 s, tune it)
- Recovery: evidence must stay valid for a hold time (default 10 s) before stepping down one level. This prevents flicker
- Operator actions (acknowledge, escalate, log decision) are recorded. They do not send commands to the robot
- The emergency stop stays with the robot's own certified safety system. MindBridge sits above it

Relationship to the existing NeSyConf modes:

- Do NOT rewire NeSyConf mode logic
- The NeSyConf mode is one input. It sets a minimum floor for the assurance state
- Proposed default floors (verify against how each mode is defined in the repo):

| NeSyConf mode | Assurance floor |
|---|---|
| Autonomous | none |
| Monitoring | none (informational) |
| Advisory | Degraded |
| Intervention | Supervised |
| Emergency | Blocked |

The final assurance state is the most restrictive of: contract result, evidence validity, fusion conflict result, NeSyConf floor. The UI shows both the assurance state and the NeSyConf mode side by side.

### 6. Incident recorder and replayer

Every state change and its evidence is stored so the incident can be replayed and audited.

Incident bundle (JSON):

```json
{
  "incident_id": "inc_20260929_143217",
  "mission": "warehouse_aisle_b_pickup",
  "started_at": "2026-09-29T14:32:10.123Z",
  "ended_at": "2026-09-29T14:32:54.100Z",
  "contract_version": "warehouse_navigation@1",
  "model": { "nesy_iv": "v0.x", "calibration_set": "cal_2026_09_17", "coverage_target": 0.90 },
  "known": ["camera age 90 ms", "lidar age 70 ms"],
  "unknown": ["object at 3.2 m, camera and lidar disagree"],
  "violated": ["sensors_agree"],
  "events": [
    { "t": "2026-09-29T14:32:12.100Z", "type": "fusion_conflict", "data": {} },
    { "t": "2026-09-29T14:32:13.000Z", "type": "state_transition", "data": { "from": "Autonomous", "to": "Degraded" } },
    { "t": "2026-09-29T14:32:52.645Z", "type": "operator_action", "data": { "action": "decision_logged", "operator": "op_42" } }
  ],
  "recommendation": "Request operator review",
  "operator_outcome": "Slowed robot, confirmed glare",
  "decision_correct": true,
  "source": "synthetic | replay | live"
}
```

Stored locally (SQLite plus JSON export). This record is the long-term data asset: what was known, what was not, which contract broke, what was recommended, what the operator did, and whether it was right.

### 7. Sensor fusion conflict detector (NEW)

Purpose: when sensors disagree, say which sensors disagree, where, and which cause fits the evidence best, so the operator does not start from zero.

Scope guard: camera and LiDAR only. Four causes. Ranked, not asserted. It may answer "Unresolved". Do not add sensors or causes until this works on real incidents.

Inputs:
- Camera detections from the robot's own perception stack (MindBridge reads them, it does not run perception)
- LiDAR obstacle clusters or scan
- Extrinsics camera to LiDAR (from TF) and calibration date
- Camera image statistics: exposure histogram, saturated pixel fraction, sharpness (variance of Laplacian), per region
- LiDAR return intensity statistics
- Map metadata: floor zones tagged polished or reflective
- Timestamps, IMU or bump events

Pipeline:

1. Time alignment. If camera and LiDAR message times differ by more than the skew limit (default 20 ms), skip comparison and report a sync fault instead
2. Spatial association. Put camera detections and LiDAR clusters in one frame (robot base or map). Match objects within a distance gate (default 0.5 m)
3. Agreement class per object: both see it, camera only, LiDAR only, neither
4. Persistence filter. A conflict must last N frames (default 5) before it counts
5. Score the four causes with evidence checks (below)
6. Rank. If the top score is under 0.6, or the gap to second place is under 0.2, output Unresolved
7. Emit a diagnosis report and feed `sensors_agree` into the contract

Causes and checks (all thresholds are placeholders to tune):

| Cause | Checks |
|---|---|
| Glare on reflective floor (camera false positive) | Saturated pixels above limit in the object region; bright specular patch overlaps object; map marks floor as polished; LiDAR returns clean; object absent in earlier frames |
| Lens dust or partial blockage | Image sharpness below baseline; LiDAR intensity has not dropped; blur trend over minutes |
| Camera to LiDAR calibration drift | Calibration older than limit; same offset seen on several objects; recent bump or vibration event |
| Real object the LiDAR missed (glass, thin edge, below scan plane) | Object present in several earlier frames; shape matches a known item; object height below LiDAR plane |

Scoring in v1 is simply checks met divided by checks total, shown as "3 of 5 checks". It is NOT shown as a percentage or probability. Turn it into a calibrated probability only after there are enough labelled incidents (aim for at least 30), and then wrap it with conformal prediction and report coverage.

Output:

```json
{
  "conflict": { "where_m": [3.2, 1.5], "camera": "object", "lidar": "clear", "frames": 7 },
  "ranked_causes": [
    { "cause": "glare_polished_floor", "checks_met": 4, "checks_total": 5, "evidence": ["..."] },
    { "cause": "real_object_lidar_missed", "checks_met": 1, "checks_total": 3, "evidence": ["..."] }
  ],
  "status": "ranked | unresolved | sync_fault",
  "suggested_checks": ["Capture a second frame at lower exposure", "Slow to 0.3 m/s in the polished zone", "Run one LiDAR-only pass"],
  "cannot_tell": "Whether an object is physically present."
}
```

Suggested checks are advice to the operator. They are not robot commands. The wording must never say the robot is safe or unsafe.

Test it with fault injection before trusting it: raise camera exposure to fake glare, blur the image to fake dust, offset the extrinsics, place a glass or thin object. Record whether the right cause ranks first.

Evidence strength: this component comes from one Reddit comment and earlier conversations. That is a strong hint, not proof. Confirm in operator interviews that narrowing the cause is what they would pay for.

---

## 4. Dashboard

Reference prototype: `mindbridge-dashboard.html` (synthetic data, scenario switcher in the top bar).

Design direction (confirmed by Hamza): bright background, macOS-like, sleek and minimal, floating panels, a dock.

| Element | Spec |
|---|---|
| Background | Soft bright gradient wall in pale blue, peach, lavender |
| Panels | Frosted white glass, blur, 20 px radius, soft shadow, thin hairline outline |
| Top bar | Thin translucent menu bar: product, robot and mission, scenario picker, data source badge, state chip |
| Dock | Floating pill at bottom centre: Live, Sensor fusion, LiDAR map, Camera view, Sensor plots, Data input, Contract, Replay, Fleet. Icons lift on hover, dot marks active view |
| Type | System stack (SF on Apple devices), sentence case |
| Motion | Only in response to the operator (dock hover, scrubber, play). None on load. Respects reduced-motion |

Non-negotiable rules:
- State is never colour alone. Every state has colour, icon, and word
- Unknown looks different from Autonomous: dashed outline, hollow icon, grey
- A source badge is always visible (Synthetic, Replay, Live). Scripted values are never presented as live
- Recommendations use plain verbs: "Request operator review", never "the robot is unsafe"

Views:
1. Live: assurance state and why, floor map, evidence list, NeSyConf metrics and the five existing modes
2. Sensor fusion: camera and LiDAR side by side, ranked causes with check chips, what to check next, what MindBridge cannot tell
3. Contract: each assumption, limit, current value, status
4. Replay: scrubber, play, event log with state at each moment
5. Sources: what is connected and what is not

---

## 5. Deployment

Targets, none measured yet:

| Item | Target |
|---|---|
| Edge monitor loop | Under 50 ms per cycle on the robot's own compute |
| Sensor to state change | Under 100 ms |
| Footprint | Small enough to run beside the navigation stack. Measure real RAM and CPU |
| Network | Core function works with no internet |

Stack:

| Layer | Choice |
|---|---|
| Edge monitor | Python, ROS2 (Humble or Iron), dataclasses, YAML contracts |
| Storage | SQLite plus JSON export |
| Web app | Existing stack (CopilotKit AG-UI). Confirm framework in the repo before adding to it |
| Transport | WebSocket, JSON evidence events |
| Packaging | Docker for the edge monitor and the local web app |

Integrate, do not replace: ROS2 and rosbag or MCAP first, then Foxglove (assurance events as timeline markers), existing diagnostics, Nav2.

---

## 6. Metrics: targets and status

| Metric | Target | Status |
|---|---|---|
| Time to detect a stale or missing sensor | Under 2 s | Not measured |
| Time to detect vs existing monitoring | Faster, size to be set after baseline | Baseline not measured |
| Time to diagnose | At least 30% lower than current manual process | Baseline not measured |
| False intervention rate | Set after baseline, the lower the better | Not measured |
| Missed failures | Track, target set after baseline | Not measured |
| Fusion diagnosis: right cause ranked first | Set after first 20 labelled incidents | Not measured |
| Unresolved rate on fusion conflicts | Track. Saying Unresolved is acceptable, wrong confidence is not | Not measured |

Compare every run against four things: normal ROS2 tools, existing diagnostics, a simple threshold monitor, and the NeSy-IV gate. If the gate does not beat simple thresholds, say so and narrow the product.

Go/no-go after the first pilot (from the research): at least 30% faster detection or recovery, fewer mission-aborting incidents, fewer false interventions, operators understand every transition, integration in days, at least two teams name the same missing capability unprompted.

---

## 7. Fleet view (Component 8)

Builds on the single-robot foundation. Do not start until Phase 4 (one robot, incident replay) is working.

### What it shows

- Fleet summary banner: overall health percentage, per-state robot count, rollout status, alert if any robot is Supervised or worse
- Robot card grid: one card per robot showing assurance state, mission, camera age, LiDAR age, NeSyConf %, firmware version, last event. Clicking a card switches the Live view to that robot's scenario
- Rollout control panel: firmware deployment status, which robots updated, how many degraded after the update, Halt and Resume buttons
- Fleet event log: timestamped events from all robots, most recent first

### Rules

- Precedence when one robot degrades during a rollout: flag the anomaly in the fleet banner and the event log immediately. Automatic halt is not implemented. The operator halts. MindBridge does not send any command to any robot
- Alert threshold: any robot in Supervised, Unknown, or Blocked triggers the fleet banner. Degraded does not, but it appears in the event log
- Rollout halt is logged as an operator action with a timestamp. It does not touch the robots
- Fleet health percentage is Autonomous robots divided by total. Show it in colour: green above 75%, amber below

### Cascading failure prevention (the Austin scenario)

The Austin grocery fleet incident (38 robots grounded in 90 seconds, $102k damage from a DDS mismatch) is the reference case for why the fleet view exists. The specific gap was: nobody had a system that could flag anomalies on the first updated robots and halt the rollout before the rest were updated.

MindBridge addresses this by surfacing per-robot assurance states during a rollout and logging a fleet-level anomaly flag when a recently-updated robot degrades. The operator can then halt. This is a workflow improvement, not an automated safety system.

### Evidence sources per robot

Each robot in the fleet connects its own edge monitor instance to the fleet aggregator. The aggregator holds:
- Latest assurance state per robot
- Latest evidence snapshot per robot
- Event stream (state transitions, fusion results, operator actions)
- Firmware version per robot

The aggregator does not need the full event history of every robot. It holds the last N events (default 50 per robot) and streams new ones to the UI over WebSocket.

### Fleet data schema (addition to the incident bundle)

```json
{
  "fleet_id": "fleet_warehouse_01",
  "robots": [
    {
      "robot_id": "RB-04",
      "state": "Supervised",
      "fw_version": "v2.4.1",
      "last_state_change": "2026-09-29T14:32:13Z",
      "evidence": { "camera_age_ms": 90, "lidar_age_ms": 70, "nesy_pct": 66 },
      "last_event": "Camera/LiDAR conflict at 3.2 m"
    }
  ],
  "rollout": {
    "from_version": "v2.4.0",
    "to_version": "v2.4.1",
    "started_at": "2026-09-29T14:30:00Z",
    "updated": ["RB-01","RB-02","RB-03","RB-04","RB-05","RB-07"],
    "pending": ["RB-06","RB-08"],
    "halted": false,
    "anomaly_flagged": true,
    "flag_reason": "RB-04 degraded 13 s after update"
  }
}
```

## 8. Build plan

Order matters. Staleness slice first. Fusion second. Fleet is now live on synthetic data.

### Branch strategy

Three branches. `main` is the only branch that deploys. Nothing merges to `main` until it passes the regression checklist.

```
main                  (production, protected - never commit directly)
  |
  +-- feat/assurance-layer    (single-robot work: contract, states, fusion, replay)
        |
        +-- feat/fleet-view   (fleet aggregator, rollout control - branches from feat/assurance-layer, NOT from main)
```

Rules:
- `feat/assurance-layer` branches from `main` at Phase 0. All single-robot phases (1 to 6) commit here
- `feat/fleet-view` branches from `feat/assurance-layer` at Phase 7. It inherits the full single-robot pipeline
- `feat/fleet-view` never branches from `main`. If it did, it would lose the single-robot assurance foundation
- Merging order: `feat/assurance-layer` to `main` first, then `feat/fleet-view` to `feat/assurance-layer`, then to `main`
- No direct commits to `main` at any point. PRs only, with the regression checklist signed off
- Full instructions for the Antigravity agent are in `antigravity-build-brief.md`, section 2

### Phase table

| Phase | Branch | Work | Status |
|---|---|---|---|
| 0 | `feat/assurance-layer` from `main` | Audit, snapshot, ARCHITECTURE_SNAPSHOT.md, REGRESSION_CHECKLIST.md | Do first |
| 1 | `feat/assurance-layer` | Domain types, contract loader, evaluator, state machine, unit tests | - |
| 2 | `feat/assurance-layer` | SyntheticSource, then ReplaySource | - |
| 3 | `feat/assurance-layer` | Assurance UI shell behind `ASSURANCE_LAYER` flag | - |
| 4 | `feat/assurance-layer` | Incident recorder, replay view | - |
| 5 | `feat/assurance-layer` | Component 7: fusion detector, four fault-injection tests | - |
| 6 | `feat/assurance-layer` | Baseline comparison harness | - |
| 6.5 | Merge `feat/assurance-layer` to `main` | Regression checklist signed off. Deploy to Cloud Run staging | - |
| 7 | `feat/fleet-view` from `feat/assurance-layer` | Component 8: fleet aggregator, fleet UI, rollout halt flow | Prototype live in dashboard |
| 8 | `feat/fleet-view` | Operator interviews with full prototype, real fleet data if available | - |
| 8.5 | Merge `feat/fleet-view` to `main` | Regression checklist signed off. Second Cloud Run deploy | - |

Approximate effort: 6 to 8 weeks part-time.

---

## 8. Open risks

- Fusion detection needs object detections and extrinsics from the robot's stack. If a target robot does not expose them, the fusion feature has nothing to read
- One failure chain at a time. The staleness chain and the fusion chain are two chains. Ship the first before the second, and stop if interviews do not confirm the second
- Calibration drift and temporal correlation can make coverage numbers look better than reality
- False alarms: a system that says stop too often gets switched off
- Liability: keep read-only, keep the certified stop separate, avoid safety claims
- Direct competitors (Ferronyx, Foxglove) are moving fast. The moat is the autonomy contract, the incident evidence, and validated degraded-mode policies, not the interface
