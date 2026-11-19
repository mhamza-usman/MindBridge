# Held-out validation: gate vs thresholds on unseen r2b segment

> Segment: frames 540-900 of the 901-frame recording (held out; tuning used frames 0-539).
> No monitor parameter, contract limit, or state-machine config was changed
> after tuning. Faults are **injected on real data**. The last three fault
> types (stuck IMU, frozen camera frame, clock jump) were never tuned on.
> Frames evaluated: 361 (replayed at 10 Hz).

## False positives on the held-out nominal segment

| Monitor | Frames flagged | Rate |
|---|---|---|
| Simple thresholds | 8/361 | 2.2% |
| Contract evaluator | 8/361 | 2.2% |
| Contract + NeSy-IV gate | 0/361 | 0.0% |

## Injected faults (held-out segment)

### camera-frame-drop (injected on real data)
- Injected frames (slice-relative): 61–239

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 6100 ms (frame 61) | threshold breach: camera_age_ms = 9999 | 0.3 |
| Contract evaluator | 6100 ms (frame 61) | contract camera_age_ms: 9999 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | 7100 ms (frame 71) | Degraded: Camera freshness: 9999 vs limit <= 200 | 1.0 |

### lidar-segment-corrupt (injected on real data)
- Injected frames (slice-relative): 161–339

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 16100 ms (frame 161) | threshold breach: lidar_age_ms = 9999 | 0.3 |
| Contract evaluator | 16100 ms (frame 161) | contract lidar_age_ms: 9999 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | 17100 ms (frame 171) | Degraded: LiDAR freshness: 9999 vs limit <= 200 | 1.0 |

### timestamp-delay (injected on real data)
- Injected frames (slice-relative): 120–259

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 16000 ms (frame 160) | threshold breach: camera_age_ms = 10299 | 0.3 |
| Contract evaluator | 12000 ms (frame 120) | contract camera_age_ms: 317.9 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | 13000 ms (frame 130) | Degraded: Camera freshness: 325.7 vs limit <= 200 | 1.0 |

### imu-stuck (injected on real data, untuned fault type)
- Injected frames (slice-relative): 100–179

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 10000 ms (frame 100) | threshold breach: imu_rate_hz = 0 | 0.3 |
| Contract evaluator | 11000 ms (frame 110) | contract camera_age_ms: 9999 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | not detected | — | 1.0 |

### frozen-camera-frame (injected on real data, untuned fault type)
- Injected frames (slice-relative): 200–279

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 20200 ms (frame 202) | threshold breach: camera_age_ms = 250 | 0.3 |
| Contract evaluator | 20200 ms (frame 202) | contract camera_age_ms: 250 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | 22100 ms (frame 221) | Degraded: Camera freshness: 2150 vs limit <= 200 | 1.0 |

### clock-jump (injected on real data, untuned fault type)
- Injected frames (slice-relative): 20–49

| Monitor | TTD | Reason at detection | Explanation quality |
|---|---|---|---|
| Simple thresholds | 2000 ms (frame 20) | threshold breach: camera_age_ms = 2517.9 | 0.3 |
| Contract evaluator | 2000 ms (frame 20) | contract camera_age_ms: 2517.9 vs limit <= 200 | 0.6 |
| Contract + NeSy-IV gate | 3000 ms (frame 30) | Degraded: Camera freshness: 2525.7 vs limit <= 200 | 1.0 |

## Observations

- **imu-stuck**: 1 monitor(s) attributed detection to the IMU field itself; 1 detected something else first (coincidental nominal dropout blips, not the injected fault); 1 missed entirely. The contract has no IMU assumption, so contract-based monitors cannot explain this fault — a real coverage gap.
- **frozen-camera-frame**: detection required the frozen frame age to ramp past 200 ms — TTD is later than an instantaneous outage, which is the physically correct behavior for this fault type.
- **clock-jump**: a 30-frame transient. Gate TTD 3000 ms vs thresholds — the confirmation window delays but does not prevent detection of transient faults.

## Honest assessment

- If the gate's false-positive advantage disappears on held-out data,
  it was overfit to the tuning segment and this report says so.
- The gate never claims faster detection: its confirmation window makes
  TTD equal or ~1 s slower than raw thresholds. What it adds is the
  assurance state, actual-vs-limit causal explanations, and evidence
  bundles that thresholds cannot produce.
- Untuned fault types probe coverage: a fault no monitor is designed to
  see (e.g. stuck IMU, which has no contract assumption) will be missed
  by the contract-based monitors even if raw thresholds flag the item.
