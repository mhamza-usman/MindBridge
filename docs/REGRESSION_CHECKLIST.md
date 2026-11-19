# Regression Checklist

*This checklist must be signed off before any merge to `main`.*

## 1. Routes
- [ ] `/live`: Loads without crashing. Connects to telemetry stream.
- [ ] `/fixed`: Loads correctly (if applicable).
- [ ] `/dynamic`: Loads correctly (if applicable).
- [ ] `/legal`: Loads correctly (if applicable).

## 2. Interactive Elements (Live Feed)
- [ ] **Pause/Resume Feed Button**: Clicking the button pauses the telemetry fetching. Clicking again resumes it.
- [ ] **Speed Controls (0.5x, 1x, 2x)**: Clicking different speed buttons updates the polling interval (active button highlights).
- [ ] **Split Pane Resizer**: The separator between the sidebar and the main AG-UI canvas can be dragged to resize panes.

## 3. State Transitions & Agent Render
- [ ] **Initial Render**: The AG-UI surface is successfully created (loading spinner disappears once connected).
- [ ] **Data Model Updates**: The dashboard elements inside the AG-UI canvas update smoothly as telemetry changes.
- [ ] **NeSyConf Modes**:
  - Transition to `autonomous` applies correct color (`#0d6b4f`) and labels.
  - Transition to `monitoring` applies correct color (`#1d4ed8`) and labels.
  - Transition to `advisory` applies correct color (`#b45309`) and labels.
  - Transition to `intervention` applies correct color (`#b91c1c`) and labels.
  - Transition to `emergency` applies correct color (`#7f1d1d`) and labels.
- [ ] **Telemetry Gauges**: Perception, Plan Certainty, Task Success, and System Uncertainty gauges fill relative to their percentages, changing color correctly (green >= 75%, amber >= 50%, red < 50%).

## 4. Test Suite Execution (Baseline Status)
- [ ] `pnpm test:widgets`: Passes.
- [ ] `pnpm test:schemas`: Note: Currently fails on `main` out of the box due to missing `pytest` module in the `uv` environment.

*(Screenshots to be added manually during QA if layout discrepancies arise)*
