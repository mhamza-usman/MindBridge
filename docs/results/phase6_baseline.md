# Phase 6: Baseline comparison results

> Source: synthetic scripted scenarios. All values labelled Synthetic.
> No real ROS2 data has been used yet.

## Scenario: Nominal run (no fault)
- Is fault: false
- True detect frame: N/A (nominal)

| Monitor | TTD (ms) | False alarm | Missed |
|---|---|---|---|
| Simple thresholds | — | No | No |
| Contract evaluator | — | No | No |
| Contract + NeSy-IV gate | — | No | No |

## Scenario: Camera stale at frame 5
- Is fault: true
- True detect frame: 500 ms

| Monitor | TTD (ms) | False alarm | Missed |
|---|---|---|---|
| Simple thresholds | 500 ms | No | No |
| Contract evaluator | 500 ms | No | No |
| Contract + NeSy-IV gate | 500 ms | No | No |

## Scenario: Camera/LiDAR conflict at frame 8
- Is fault: true
- True detect frame: 800 ms

| Monitor | TTD (ms) | False alarm | Missed |
|---|---|---|---|
| Simple thresholds | 800 ms | No | No |
| Contract evaluator | 800 ms | No | No |
| Contract + NeSy-IV gate | 800 ms | No | No |

## Scenario: Evidence missing at frame 3
- Is fault: true
- True detect frame: 300 ms

| Monitor | TTD (ms) | False alarm | Missed |
|---|---|---|---|
| Simple thresholds | 300 ms | No | No |
| Contract evaluator | 300 ms | No | No |
| Contract + NeSy-IV gate | 0 ms | No | No |

---

> Honest note: if the gate does not outperform thresholds on real data, this table will say so.