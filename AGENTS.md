# MindBridge: Build Brief for the Antigravity Agent

## 0. Prime directive

**This repo is a working, deployed product. ADD to it. Do NOT wipe, rewrite, or replace what exists.**

- Do not delete any file, component, route, hook, style, test, or config
- Do not rename or move existing files or exports
- Do not change the shape of existing props, API responses, event names, or AG-UI messages
- Do not remove or "clean up" code you do not understand. Ask
- Do not upgrade major dependencies or change the Cloud Run deployment config
- New behaviour goes in NEW files and NEW modules. Touch existing files only to mount a new module, and keep each such edit small
- Everything new sits behind feature flags. With the flags off, the app must look and behave exactly as before

If a task seems to require breaking any rule above, STOP and ask.

## 1. What MindBridge is

MindBridge is a live robot operations UI built on CopilotKit's AG-UI protocol, deployed on Google Cloud Run. It shows NeSyConf (neural-symbolic confidence) metrics: perception, plan certainty, task success, system uncertainty. The UI moves between five modes driven by NeSyConf: Autonomous, Monitoring, Advisory, Intervention, Emergency. It supports human-in-the-loop transitions.

We are turning it into a **runtime assurance layer for ROS2 mobile robots**. It answers one question: *can this robot safely continue its current mission, and what evidence supports that?*

New capabilities being added:
1. Autonomy contract per mission (assumptions checked against evidence)
2. Assurance states: Autonomous, Degraded, Supervised, Unknown, Blocked
3. Evidence from synthetic scenarios and replayed ROS2 data (live ROS2 later)
4. Causal evidence chain
5. Sensor fusion conflict detector: when camera and LiDAR disagree, rank likely causes
6. Incident recording and replay
7. Operator action log (acknowledge, escalate, log decision)
8. A new UI shell: bright, macOS-like, floating panels, a dock with LiDAR map, camera view, sensor plots, data input, and fleet views
9. Fleet view: per-robot assurance states for all robots, fleet health score, rollout anomaly flagging, Halt rollout button (logged only, never commands a robot)

Read-only product. It recommends. It never sends commands to a robot. No UI text may claim the robot is "safe", "unsafe", or "guaranteed".

NeSy-IV (conformal prediction uncertainty) is an engine inside MindBridge. CASSANDRA (acoustic agent) is a future plugin: build only the interface for it. AG-UI and CopilotKit stay as they are. They are an implementation detail, not something to redesign.

## 2. Branch strategy (read this before touching any file)

Three branches. `main` is the only branch that ever deploys. Nothing merges to `main` without passing the regression checklist.

```
main                        <- production, protected. NEVER commit here directly.
  |
  +-- feat/assurance-layer  <- all single-robot work (Phases 0-6)
        |
        +-- feat/fleet-view <- fleet work only (Phase 7+). Branches from feat/assurance-layer, NOT from main.
```

**Exact commands to run at the start. Run them in this order. Do not skip any.**

```bash
# 1. Make sure you are on main and it is clean
git checkout main
git pull origin main
git status          # must show "nothing to commit, working tree clean"

# 2. Tag the production baseline before touching anything
git tag baseline-pre-assurance
git push origin baseline-pre-assurance

# 3. Create the single-robot feature branch from main
git checkout -b feat/assurance-layer
git push -u origin feat/assurance-layer

# 4. You are now on feat/assurance-layer. All Phases 1-6 commit here.
#    Do NOT switch back to main or merge to main until Phase 6 is done.
```

**When Phase 6 is complete and the regression checklist passes:**

```bash
# Merge single-robot work to main
git checkout main
git merge --no-ff feat/assurance-layer -m "feat: assurance layer (Phases 1-6)"
git push origin main

# Tag the merge
git tag v1.0-assurance
git push origin v1.0-assurance
```

**Then, and only then, create the fleet branch:**

```bash
# Branch fleet from feat/assurance-layer (which is now also in main)
git checkout feat/assurance-layer
git checkout -b feat/fleet-view
git push -u origin feat/fleet-view

# All Phase 7+ fleet work commits here.
```

**When Phase 7+ is done and the fleet regression checklist passes:**

```bash
# Merge fleet into assurance-layer first, then to main
git checkout feat/assurance-layer
git merge --no-ff feat/fleet-view -m "feat: fleet view (Phase 7)"
git checkout main
git merge --no-ff feat/assurance-layer -m "feat: fleet view merged to main"
git push origin main
git tag v1.1-fleet
git push origin v1.1-fleet
```

**Why `feat/fleet-view` must never branch from `main` directly:**

If fleet branches from `main`, it misses the entire assurance layer (contract evaluator, state machine, NeSy-IV gate, fusion detector). The fleet view depends on per-robot AssuranceState. Without the single-robot pipeline under it, the fleet view has nothing to aggregate.

---

## 3. Step 0: audit before you change any code

Do this immediately after creating `feat/assurance-layer`. Stop for review before Phase 1.

1. You are on `feat/assurance-layer`, branched from `main`. Confirm: `git branch` shows `* feat/assurance-layer`
2. Install and run the app. Run existing tests and lint. Record what passes and what fails BEFORE any of your changes
3. Write `docs/ARCHITECTURE_SNAPSHOT.md` covering: framework and versions, folder map, routes and pages, AG-UI agent and tool wiring, where NeSyConf values are computed and stored, where the five modes are decided, state management, styling approach, env vars (names only, not secrets), build and deploy setup
4. Write `docs/REGRESSION_CHECKLIST.md`: every route, every interactive element, every state transition you can trigger in the current app, with expected outcome. Include screenshots if possible. This is what gets checked before any merge to `main`
5. Report back: what you found, what looks risky to change, proposed mount points for the new modules

Do not proceed to Phase 1 until Hamza approves the snapshot.

## 4. Rules for all phases

- You are always working on `feat/assurance-layer` (Phases 1-6) or `feat/fleet-view` (Phase 7+). Never on `main`
- Follow the repo's existing language, lint config, and file naming. Match the style you find
- New code lives in new folders. Suggested: `src/assurance/` containing `domain/`, `contract/`, `sources/`, `fusion/`, `incidents/`, `ui/fleet/`
- Feature flags (default OFF in all environments): `ASSURANCE_LAYER` for assurance logic, `UI_V2` for the new shell, `FLEET_VIEW` for the fleet tab. Read from env with a query string override for demos (`?ui=v2&fleet=1`)
- With all flags OFF, the app must look and behave exactly as it does today. Check this against the regression checklist after every phase
- Pure logic (contract evaluator, state machine, fusion scorer) must be pure functions with unit tests
- A language model may rephrase a causal explanation for display. It never decides a state or picks a cause
- Never label synthetic or replayed data as live. Source badge always visible: Synthetic, Replay, or Live
- No invented numbers. Scripted demo values sit in named scenario files
- After each phase: run `git diff --stat --diff-filter=D` against the previous commit. No deleted files unless Hamza approved it. Include that output in your phase report
- One commit per logical change. Keep commits small and the message descriptive

## 5. Phases

### Phase 1: domain model and pure logic

Add types (adapt to the repo's language):

```ts
type AssuranceState = 'Autonomous' | 'Degraded' | 'Supervised' | 'Unknown' | 'Blocked';
type Validity = 'ok' | 'warn' | 'bad' | 'unk';

interface EvidenceItem { id: string; label: string; value: string; unit?: string; status: Validity; source: 'synthetic'|'replay'|'live'; t: number }
interface Assumption  { id: string; label: string; limit: string; check: (e: EvidenceSnapshot) => Validity }
interface Contract    { mission: string; version: string; assumptions: Assumption[] }
interface AssuranceResult {
  state: AssuranceState; recommendation: string; why: string[];
  violated: string[]; known: string[]; unknown: string[];
  nesyMode?: 'Autonomous'|'Monitoring'|'Advisory'|'Intervention'|'Emergency';
}
```

Build:
- Contract loader (YAML or JSON) with a default `warehouse_navigation` contract. See the architecture doc section 3 for the fields. All limits are placeholders and configurable
- Evaluator: evidence in, per-assumption status out
- State machine with these rules:
  - Precedence: Blocked, Unknown, Supervised, Degraded, Autonomous
  - Unknown when required evidence is stale, missing, or calibration is invalid
  - Degraded moves to Supervised if the violation lasts past the escalation time (default 20 s)
  - Step down one level only after evidence stays valid for the hold time (default 10 s)
  - Final state is the most restrictive of: contract result, evidence validity, fusion result, NeSyConf floor
- NeSyConf floor mapping (a proposal, verify against how the modes are defined in this repo, and make it a config): Autonomous none, Monitoring none, Advisory Degraded, Intervention Supervised, Emergency Blocked
- Read the existing NeSyConf mode. Do NOT change how it is computed

Acceptance: unit tests for every precedence and recovery rule. Existing tests unchanged and still passing.

### Phase 2: evidence sources

Define one interface:

```ts
interface EvidenceSource { id: string; kind: 'synthetic'|'replay'|'live'|'acoustic'; start(): void; stop(): void; onSnapshot(cb: (s: EvidenceSnapshot) => void): void }
```

Build:
1. `SyntheticSource`: four scripted scenarios, matching the reference prototype: nominal, stale camera, camera and LiDAR conflict, evidence missing. Label every value synthetic
2. `ReplaySource`: reads a JSONL export of a recorded ROS2 bag (define the schema in `docs/`). Add a small Python script under `tools/` to export MCAP or rosbag to that JSONL. Do not put ROS2 dependencies into the web app
3. Stub `LiveSource` and `AcousticSource` that throw "not implemented". CASSANDRA gets no logic now

Acceptance: switching source changes the badge and the data. No other screen changes.

### Phase 3: assurance UI shell (behind `UI_V2`)

Build a new shell. Keep the old UI reachable and unchanged (for example at the current route, with the new shell at a new route or behind the flag). Do NOT delete or restyle the existing components.

Views (dock items): Live, Sensor fusion, Contract, Replay, Sources, Fleet (disabled, tooltip "later").
- Live: assurance state chip, recommendation, why list, floor map, evidence list, NeSyConf metrics, the five existing modes with the current one marked
- Contract: table of assumptions, limits, current value, status
- Sources: connected and not connected sources

The visual reference is `docs/mindbridge-dashboard.html`. Open it, and extract its tokens and layout. Match it. Design system in section 5.

Operator actions (Acknowledge, Escalate, Log my decision, Save incident) write to a local log only. Show the confirmation text "Logged only, robot not touched". Never call anything that acts on a robot.

Acceptance: with `UI_V2` off, the app is identical to baseline (compare against the regression checklist). With it on, all views render for all four scenarios.

### Phase 4: incident recorder and replay

- Record state transitions, evidence, and operator actions into an incident bundle (schema in the architecture doc, section 3, component 6)
- Store locally (IndexedDB or a small local API, whichever fits the repo). No cloud storage
- Replay view: play, pause, scrub, event log showing state at each moment
- Export a bundle as JSON

### Phase 5: sensor fusion conflict detector

Spec is in the architecture doc, section 3, component 7. Summary:
- Scope: camera and LiDAR only, four causes: glare on reflective floor, lens dust or blockage, calibration drift, real object the LiDAR missed
- Time-align first. If skew is over the limit, report a sync fault
- Associate detections spatially, classify agreement, filter for persistence (default 5 frames)
- Score each cause by checks met over checks total. Show "3 of 5 checks". NEVER show a percentage or a probability
- Rank. If top score is under 0.6, or the gap to second is under 0.2, return Unresolved
- Output a diagnosis report: conflict location, ranked causes with the evidence for each, suggested checks, and what it cannot tell
- Feed the result into the `sensors_agree` assumption
- Fusion view: camera and LiDAR side by side, ranked causes with check chips, what to check next, what MindBridge cannot tell
- All thresholds are configurable placeholders. Put them in one config file

Tests: pure-function unit tests, and four fault-injection cases (fake glare by raising exposure, fake dust by blurring, offset the extrinsics, thin or glass object). For each, assert which cause should rank first. If a case is ambiguous, assert Unresolved.

### Phase 6: baseline comparison harness

Run the same fault set through three monitors and record time to detect, false alarms, and missed faults:
1. Simple thresholds
2. Contract evaluator
3. Contract evaluator plus NeSy-IV gate

Output a table to `docs/results/`. Report honestly if the gate does not beat thresholds.

**Before Phase 7: merge `feat/assurance-layer` to `main` as described in section 2. Deploy to Cloud Run staging. Confirm regression checklist passes. Then:**

```bash
git checkout feat/assurance-layer
git checkout -b feat/fleet-view
git push -u origin feat/fleet-view
```

### Phase 7: fleet view (branch: `feat/fleet-view`)

The prototype is already visible in the dashboard. This phase wires it to real data and makes it production-safe.

Components to build:

1. Fleet aggregator interface (`src/assurance/fleet/FleetAggregator.ts`): holds latest AssuranceState per robot, latest evidence snapshot per robot, last 50 events per robot, firmware version per robot. WebSocket stream to the UI. The aggregator does not store full event history

2. Fleet data schema: implement the schema from the architecture doc (section 7). `fleet_id`, `robots[]`, `rollout` object with `from_version`, `to_version`, `updated[]`, `pending[]`, `halted`, `anomaly_flagged`, `flag_reason`

3. Fleet event log: timestamped events across all robots, most recent first. Fleet-level anomaly events are distinct from per-robot events

4. Rollout anomaly detection rule: if a robot's state degrades within 60 seconds of receiving a firmware update, write a fleet-level anomaly event and set `anomaly_flagged: true`. The UI surfaces it. No automatic halt

5. Fleet UI (extend `src/assurance/ui/fleet/`): the prototype HTML is the visual reference. The component must:
   - Read from the fleet aggregator, not a hardcoded ROBOTS array
   - Robot card click routes to that robot's Live view using its real evidence, not a scenario mapping
   - Halt and Resume buttons write to the operator action log, same as acknowledge and escalate. They do not contact any robot
   - Fleet health percentage: Autonomous count / total. Green above 75%, amber below. Never red-only; always colour + text
   - Firmware version badge per card: highlight if the robot's version differs from the rollout target

6. Fleet flag: `FLEET_VIEW` env variable, default OFF. With it OFF the fleet dock item shows disabled (no change to anything else). With it ON, the item is active and drawFleet() runs

Rules specific to this phase:
- The fleet aggregator is read-only. It aggregates from per-robot edge monitors. It never writes to robots
- Any robot in Supervised, Unknown, or Blocked shows in the fleet banner. Degraded appears in the event log but not the banner alert
- The "Halt rollout" action is an operator log entry. Wording in the UI: "Halt logged at [time]. No robot was commanded"
- Check: `git diff --stat --diff-filter=D` must show no deleted files from `feat/assurance-layer`. All prior functionality intact

Acceptance: run the synthetic fleet scenario (8 robots, rollout in progress, 3 robots degraded). Banner shows correct health percentage and alert. Clicking RB-04 opens its Live view with conflict scenario data. Halt logs an entry. Resume logs an entry.

## 6. Design system for the new shell

Use the reference prototype as the source of truth. Summary:

- Bright, light theme. Background: soft gradient wall in pale blue, peach, and lavender over `#f4f7fc`
- macOS-like, sleek, minimal
- Panels float: frosted white glass (`rgba(255,255,255,.74)`, backdrop blur 26 px, saturate 170%), 20 px radius, soft shadow, 1 px hairline outline
- Thin translucent menu bar at the top: product name, robot and mission, scenario picker (synthetic mode only), source badge, state chip
- Floating dock at bottom centre: rounded pill, glass, 52 px icon buttons, hover lift and scale, dot under the active item, tooltips, Fleet disabled
- Type: system stack (`-apple-system, "SF Pro Text", "Helvetica Neue", Inter, system-ui`), mono for values (`ui-monospace, "SF Mono"`). Sentence case labels. No all-caps eyebrow labels
- Ink `#1d1d1f`, secondary `#5f6470`, accent `#0a66ff`
- State colours: Autonomous `#1e8e4e`, Degraded `#a15c00`, Supervised `#c2410c`, Unknown `#5b6472`, Blocked `#c4162a`
- **State is never colour alone.** Each state has colour, an icon, and its word
- **Unknown looks different**: dashed outline, hollow icon, grey
- Motion only in reply to the operator (dock hover, scrub, play). No entrance animations. Respect `prefers-reduced-motion`
- Keyboard focus rings visible. Text contrast AA on the glass panels. Layout works down to a narrow laptop width
- Copy is plain and specific: "Request operator review", "Camera freshness is 450 ms, limit is 200 ms". No "guarantee", "safe", "unsafe"

Check every state colour against its panel background for contrast before you ship.

## 7. Ask me before you

- Delete, rename, or move anything
- Change any existing API, prop, event, or AG-UI message shape
- Add a dependency (list it and why). Major upgrades need approval
- Touch deployment config, Dockerfiles, or env handling
- Decide the NeSyConf floor mapping is wrong, or change how NeSyConf modes are computed
- Add anything that sends data off the device, or that could act on a robot

## 8. Out of scope for now

- Fleet view
- CASSANDRA logic (interface only)
- Live ROS2 connection
- Any actuation, or any command path to a robot
- Cloud analytics, auth, billing
- Redesign of the existing NeSyConf views
- A generic chat or "ask about your robot" feature

## 9. Reporting format after each phase

1. What you added (files)
2. Existing files you modified, with a one-line reason each
3. Output of `git diff --stat --diff-filter=D` (must be empty)
4. Test results, before and after
5. Regression checklist status
6. Anything you were unsure about, and what you assumed

## 10. First prompt to give the agent

> Read AGENTS.md fully, including section 2 (branch strategy) and section 3 (audit). Then do section 3 only: run the exact git commands in section 2 to create the tag and feat/assurance-layer branch, install and run the app, run tests, then write docs/ARCHITECTURE_SNAPSHOT.md and docs/REGRESSION_CHECKLIST.md. Do not modify any existing source file. Stop and report when done. Show me the output of `git branch`, `git log --oneline -5`, and `git diff --stat --diff-filter=D`.

For Phase 7 (fleet), the first prompt on that branch is:

> You are on feat/fleet-view, branched from feat/assurance-layer. Read AGENTS.md section 5 Phase 7 in full. Do not modify any file from feat/assurance-layer. The fleet prototype in the dashboard HTML is the visual reference. Build the FleetAggregator interface first, then the data schema, then wire the fleet UI component to it. Stop after FleetAggregator and report before continuing.
