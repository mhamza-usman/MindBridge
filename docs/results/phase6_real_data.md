# Phase 6 (real data): baseline comparison on NVIDIA r2b

> All faults below are **injected on real data** — modifications applied to
> converter output from the actual r2b_datacenter bag. The bag itself
> contains no natural faults.
> Frames evaluated: 901 (replayed at 10 Hz).

## False positives on the nominal run (no injected fault)

| Monitor | Frames flagged | Rate |
|---|---|---|
| Simple thresholds | 19/901 | 2.1% |
| Contract evaluator | 19/901 | 2.1% |
| Contract + NeSy-IV gate | 0/901 | 0.0% |

## Injected faults

### camera-frame-drop (injected on real data)
- Injected frames: 301–499

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 30100 ms (frame 301) | threshold breach: camera_age_ms = 9999 | 0.3 |
| Contract evaluator | 30100 ms (frame 301) | contract camera_age_ms: 9999 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | 31100 ms (frame 311) | Degraded: Camera freshness: 9999 vs limit <= 200 | 1.0 |

### lidar-segment-corrupt (injected on real data)
- Injected frames: 401–599

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 40100 ms (frame 401) | threshold breach: lidar_age_ms = 9999 | 0.3 |
| Contract evaluator | 40100 ms (frame 401) | contract lidar_age_ms: 9999 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | 41100 ms (frame 411) | Degraded: LiDAR freshness: 9999 vs limit <= 200 | 1.0 |

### timestamp-delay (injected on real data)
- Injected frames: 200–399

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 20000 ms (frame 200) | threshold breach: camera_age_ms = 10299 | 0.3 |
| Contract evaluator | 20000 ms (frame 200) | contract camera_age_ms: 10299 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | 21100 ms (frame 211) | Degraded: Camera freshness: 327.4 vs limit <= 200 | 1.0 |

## Honest assessment

- The dataset's periodic single-frame sensor dropouts (every ~5 s) are real
  bag gaps. Simple thresholds and the raw contract evaluator flag them as
  violations; the assurance gate's confirmation window filters them, which is
  why its false-positive rate on nominal data is lower.
- On sustained injected faults all three monitors detect; the gate adds the
  assurance state, a causal why-chain with actual-vs-limit values, and an
  evidence bundle — things thresholds cannot produce.
- Where the gate does NOT win: raw time-to-detect is equal or slightly slower
  (confirmation window trades ~1 s for dropout immunity). Its value is
  explanation and evidence, not speed.
