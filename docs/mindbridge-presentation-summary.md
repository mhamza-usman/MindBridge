# MindBridge: Presentation Summary (v2)

Updated 29 Sep 2026. Use with `mindbridge-dashboard.html` and `mindbridge-technical-architecture.md`.

---

## 1. One-liner

> MindBridge checks whether a ROS2 robot can safely keep going on its current mission, tells the operator which sensors are failing and the most likely reason, and saves the evidence so the incident can be replayed.

Shorter: **"Is this robot still fit to run on its own, and why not?"**

Do not say: "AI reliability for physical AI", "AI copilot", "guarantees safety".

## 2. The problem

- Robots fail in ways that look like ordinary perception or navigation faults. A broken topic, stale transform, or QoS mismatch does not announce itself
- In warehouses, lighting, dust, reflective floors, and temporary obstacles push sensors out of sync. Camera says there is an object, LiDAR says clear
- Operators then spend time working out which sensor to trust and why. That diagnosis is the slow part
- Current tools show data (Foxglove) or explain failures after the fact (Ferronyx). Few connect the evidence to the question "may this robot continue?"

## 3. What exists today, and what is being added

Be straight about this in the room.

| Live today (built) | Being added (this plan) |
|---|---|
| Generative operations UI on CopilotKit AG-UI, deployed on Cloud Run | Autonomy contract per mission |
| NeSyConf confidence: perception, plan certainty, task success, system uncertainty | Evidence from real or replayed ROS2 data |
| Five modes: Autonomous, Monitoring, Advisory, Intervention, Emergency | Assurance states, including an honest "Unknown" |
| Human-in-the-loop transitions | Sensor fusion conflict detector (camera vs LiDAR) |
| Fleet view: 8-robot grid, health banner, rollout control, event log, click-to-inspect | Incident recording and replay |
| LiDAR polar scan, camera frame, sensor time-series plots, data input panel | Operator action log (acknowledge, escalate, log decision) |

Not now: CASSANDRA as a live source (plugin interface only). Fleet view is now live on synthetic data (8 robots, rollout control, event log).

## 4. The eight components

1. Sensor intake: freshness, rates, QoS checks per topic
2. Contract evaluator: mission assumptions checked against evidence
3. Uncertainty gate: NeSy-IV conformal prediction, with calibration age, coverage, and drift shown. Says Unknown when it cannot know
4. Causal evidence mapper: sensor, perception, navigation, mission, each link tied to evidence
5. Assurance state machine: Autonomous, Degraded, Supervised, Unknown, Blocked. Recommends only
6. Incident recorder and replayer: what was known, what was not, what was recommended, what the operator did
7. Sensor fusion conflict detector: finds where camera and LiDAR disagree, ranks likely causes (glare, dirty lens, calibration drift, LiDAR miss) by evidence match, or says Unresolved
8. Fleet view: per-robot state cards for all robots in a warehouse, fleet health score, event log, and rollout control. Flags anomalies during firmware or config deployments. Clicking a robot card switches the Live view to that robot. Halt rollout is logged, never commands a robot

## 5. Demo script (about 7 minutes)

Open the dashboard. The Synthetic demo data badge is always visible. Say it.

1. Nominal run (pick it in the Scenario menu). Everything green. Point at the NeSyConf metrics and the five existing modes: "this part is already live"
2. Stale camera. State moves to Supervised. Show the Why list and the contract table. Point out the evidence trail. "This is the deterministic core"
3. Camera and LiDAR conflict. Open the dock item Sensor fusion. Show camera and LiDAR side by side, then the ranked causes with check chips. Glare ranks first at 4 of 5 checks. Read the box "What MindBridge cannot tell"
4. Evidence missing. State is Unknown, dashed and hollow. "It will not guess"
5. Replay. Drag the scrubber through the conflict incident
6. Click Acknowledge or Log my decision. Read the message: logged only, robot not touched
7. Open the Fleet dock item. Point at the banner: 3 robots need attention, fleet health 62%. Show RB-04 card in the conflict state. Click it: the Live view switches to that robot. Come back to Fleet
8. Point at the Rollout panel. RB-03 and RB-04 degraded after the v2.4.1 update. Click Halt rollout. Read the log entry: decision logged, no robot touched. "This is the Austin incident scenario prevented"

Close on: "Read-only by design. The robot's own safety system keeps the emergency stop. MindBridge only flags and recommends."

## 6. How this differs from what exists

Say it as a difference of job, not a claim that others cannot do things.

| Tool | Its job | MindBridge's job |
|---|---|---|
| Foxglove | Inspect and analyse robot data | Decide whether the mission's assumptions still hold, and explain sensor disagreement |
| Ferronyx | Find and explain production failures | Say whether autonomy may continue right now, with evidence |
| Fleet platforms (Formant, InOrbit, Viam) | Dispatch, remote access, device management | Sit beside them as the assurance layer for one robot's mission |
| Safety PLCs, e-stops | Hard protective stop | Sit above them. MindBridge recommends, they act |

Integration first: ROS2, rosbag and MCAP, Foxglove timeline markers, Nav2, existing diagnostics.

## 7. Targets and proof plan

None of these are measured yet. Present them as targets.

| Target | How it will be measured |
|---|---|
| Detect stale or missing sensor data in under 2 s | Fault injection on replayed data |
| At least 30% less time to diagnose an incident vs today's process | Compare against a baseline from real operators |
| Fewer false interventions than simple thresholds | Same fault set, run through thresholds, contract, and contract plus NeSy-IV gate |
| Right cause ranked first for camera and LiDAR conflicts | Labelled incidents. Target set after the first 20 |
| Integration in days, not months | Time it with a design partner |

Do not quote "99.3%" publicly until the dataset, baseline, split, and distribution shift results are documented.

## 8. Talking points

- Uncertainty becomes a decision: continue, slow, review, pause. Not a gauge
- "Unknown" is a feature. A reliability product must separate "safe" from "we do not know"
- Ranked causes, not a single confident answer. Trust comes from showing the checks
- Local-first: the decision runs on or beside the robot, with no cloud dependency
- Every alert saves an evidence bundle. Over time that becomes the data asset

## 9. Questions to ask the audience

- What was the last robot incident, and how long did diagnosis take?
- What data was missing when you diagnosed it?
- When camera and LiDAR disagree, what do you check first?
- Which alerts do your operators ignore today?
- Would you install a local monitor on the robot? Who approves that?
- What would you pay to prevent one incident?

Ask for past pain and current spending, not "do you like it?"

## 10. Validation so far (from earlier chats, confirm before quoting)

- A researcher at RideScan reportedly said the deployment problems still exist
- A Reddit comment (r/IndustrialAutomation) reportedly named sensor fusion handovers as a major failure source and asked how far a system could narrow the cause before handing to an operator
- Treat both as leads. Get permission before naming anyone, and check the exact wording

Next validation: 15 to 25 conversations with people who run ROS2 robots outside the lab, and two design partners who share real incident data.

## 11. Internal notes (do not present)

- Company name: "MindBridge" is unavailable as a company name (MindBridge Analytics, Ottawa). Candidates: Keel (strongest), Datum, Certum, Fulcrum. Companies House, domain, and UK trademark checks pending
- Positioning freeze until 13 Oct 2026 (proposed): do not change the pitch while testing it
- IEEE RA-L review outcome for NeSy-IV still pending
- Scope discipline: one robot class (warehouse mobile robots), one failure chain at a time. Staleness first, fusion second

## 12. Next steps

1. Antigravity build following `antigravity-build-brief.md`, additive only, branching strategy in section 3
2. Get one recorded ROS2 bag with a sensor fault, or build the fault-injection replay
3. Book the first five operator conversations. Lead with the Austin incident scenario in the fleet view
4. Run the baseline comparison and record the numbers
5. For fleet validation: find one operator who has managed a firmware rollout across a robot fleet and ask what they check before rolling to the next batch
6. Decide: continue, narrow, or stop, against the go/no-go list in the architecture document
