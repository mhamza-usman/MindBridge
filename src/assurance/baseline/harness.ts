/**
 * Phase 6: Baseline comparison harness.
 *
 * Runs the same synthetic fault set through three monitors:
 *   1. Simple thresholds
 *   2. Contract evaluator
 *   3. Contract evaluator + NeSy-IV floor gate
 *
 * Records time-to-detect, false alarms, and missed faults per monitor.
 * Output is a table written to docs/results/.
 */

import { getDefaultContract } from '../contract/loader';
import { evaluateContract } from '../contract/evaluator';
import { AssuranceStateMachine } from '../domain/stateMachine';
import { EvidenceSnapshot, EvidenceItem, Validity, NeSyMode } from '../domain/types';

// ---------------------------------------------------------------------------
// Fault scenarios (scripted, clearly labelled synthetic)
// ---------------------------------------------------------------------------

function makeEvidence(items: Record<string, Partial<EvidenceItem> & { value: string }>, t: number): EvidenceSnapshot {
  const full: Record<string, EvidenceItem> = {};
  for (const [id, partial] of Object.entries(items)) {
    full[id] = {
      id,
      label: id,
      value: partial.value,
      unit: partial.unit,
      status: partial.status ?? 'ok',
      source: 'synthetic',
      t,
    };
  }
  return { t, items: full, source: 'synthetic' };
}

interface FaultScenario {
  name: string;
  frames: EvidenceSnapshot[]; // 20 frames, one per 100 ms simulated
  trueDetectFrameIdx: number; // frame at which fault is actually injected
  nesyMode: NeSyMode;
  isFault: boolean;          // false = nominal (expected: no alarm)
}

function buildScenarios(): FaultScenario[] {
  // All keys must match defaultContractDef assumption IDs exactly.
  // camera_age_ms / lidar_age_ms / tf_age_ms: numeric ms values (no unit suffix)
  // battery_reserve_pct: numeric %, min 20
  // calibration_valid / sensors_agree: string 'true' (equals: true check parses 'true' -> boolean)
  const nominalItems = {
    camera_age_ms:       { value: '90',    status: 'ok' as Validity },
    lidar_age_ms:        { value: '70',    status: 'ok' as Validity },
    tf_age_ms:           { value: '120',   status: 'ok' as Validity },
    localization_std_m:  { value: '0.02',  status: 'ok' as Validity },
    battery_reserve_pct: { value: '72',    status: 'ok' as Validity },
    calibration_valid:   { value: 'true',  status: 'ok' as Validity },
    sensors_agree:       { value: 'true',  status: 'ok' as Validity },
  };

  // Scenario A: nominal run, no fault
  const scenarioA: FaultScenario = {
    name: 'Nominal run (no fault)',
    isFault: false,
    trueDetectFrameIdx: -1,
    nesyMode: 'Autonomous',
    frames: Array.from({ length: 20 }, (_, i) => makeEvidence(nominalItems, i * 100)),
  };

  // Scenario B: camera goes stale at frame 5
  const scenarioB_frames = Array.from({ length: 20 }, (_, i) => {
    if (i >= 5) {
      return makeEvidence({
        ...nominalItems,
        camera_age_ms: { value: '450', status: 'bad' as Validity },  // exceeds max 200
      }, i * 100);
    }
    return makeEvidence(nominalItems, i * 100);
  });
  const scenarioB: FaultScenario = {
    name: 'Camera stale at frame 5',
    isFault: true,
    trueDetectFrameIdx: 5,
    nesyMode: 'Autonomous',
    frames: scenarioB_frames,
  };

  // Scenario C: sensor conflict at frame 8
  const scenarioC_frames = Array.from({ length: 20 }, (_, i) => {
    if (i >= 8) {
      return makeEvidence({
        ...nominalItems,
        sensors_agree: { value: 'false', status: 'bad' as Validity }, // equals: true check fails
      }, i * 100);
    }
    return makeEvidence(nominalItems, i * 100);
  });
  const scenarioC: FaultScenario = {
    name: 'Camera/LiDAR conflict at frame 8',
    isFault: true,
    trueDetectFrameIdx: 8,
    nesyMode: 'Autonomous',
    frames: scenarioC_frames,
  };

  // Scenario D: evidence missing at frame 3, NeSyConf goes to Emergency at frame 5
  const scenarioD_frames = Array.from({ length: 20 }, (_, i) => {
    if (i >= 3) {
      return makeEvidence({
        ...nominalItems,
        camera_age_ms: { value: 'no data', status: 'unk' as Validity },
        lidar_age_ms:  { value: 'no data', status: 'unk' as Validity },
      }, i * 100);
    }
    return makeEvidence(nominalItems, i * 100);
  });
  const scenarioD: FaultScenario = {
    name: 'Evidence missing at frame 3',
    isFault: true,
    trueDetectFrameIdx: 3,
    nesyMode: 'Emergency',
    frames: scenarioD_frames,
  };

  return [scenarioA, scenarioB, scenarioC, scenarioD];
}

// ---------------------------------------------------------------------------
// Monitor 1: simple thresholds (no contract, no NeSy-IV)
// ---------------------------------------------------------------------------

function simpleThresholdDetect(frames: EvidenceSnapshot[]): number {
  // Detects fault when any item has status !== 'ok'
  for (let i = 0; i < frames.length; i++) {
    const items = Object.values(frames[i].items);
    if (items.some(it => it.status !== 'ok')) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Monitor 2: contract evaluator
// ---------------------------------------------------------------------------

function contractDetect(frames: EvidenceSnapshot[]): number {
  const contract = getDefaultContract();
  for (let i = 0; i < frames.length; i++) {
    const checks = evaluateContract(contract, frames[i]);
    const violated = Object.values(checks).some(v => v === 'bad' || v === 'unk');
    if (violated) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Monitor 3: contract + NeSy-IV gate (state machine)
// ---------------------------------------------------------------------------

function contractPlusGateDetect(frames: EvidenceSnapshot[], nesyMode: NeSyMode): number {
  const contract = getDefaultContract();
  const sm = new AssuranceStateMachine();
  for (let i = 0; i < frames.length; i++) {
    const checks = evaluateContract(contract, frames[i]);
    const hasConflict = Object.values(frames[i].items).some(
      it => it.id === 'sensors_agree' && it.status === 'bad',
    );
    const result = sm.tick(frames[i].t, checks, hasConflict, nesyMode);
    if (result.state !== 'Autonomous') return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Harness runner
// ---------------------------------------------------------------------------

export interface MonitorResult {
  monitor: string;
  ttdFrames: number | null;   // time-to-detect in frames (null = not detected)
  ttdMs: number | null;       // time-to-detect in ms
  falseAlarm: boolean;
  missed: boolean;
}

export interface ScenarioResult {
  scenario: string;
  isFault: boolean;
  trueDetectMs: number;
  monitors: MonitorResult[];
}

export function runHarness(): ScenarioResult[] {
  const scenarios = buildScenarios();
  const results: ScenarioResult[] = [];

  for (const s of scenarios) {
    const trueMs = s.trueDetectFrameIdx >= 0 ? s.trueDetectFrameIdx * 100 : -1;
    const monitorResults: MonitorResult[] = [];

    const monitors: Array<{ name: string; detectFn: (frames: EvidenceSnapshot[]) => number }> = [
      { name: 'Simple thresholds',              detectFn: (f) => simpleThresholdDetect(f) },
      { name: 'Contract evaluator',             detectFn: (f) => contractDetect(f) },
      { name: 'Contract + NeSy-IV gate',        detectFn: (f) => contractPlusGateDetect(f, s.nesyMode) },
    ];

    for (const m of monitors) {
      const detectedIdx = m.detectFn(s.frames);
      const ttdFrames   = detectedIdx >= 0 ? detectedIdx : null;
      const ttdMs       = ttdFrames !== null ? ttdFrames * 100 : null;

      // False alarm: no fault but monitor fired
      const falseAlarm = !s.isFault && detectedIdx >= 0;
      // Missed: fault exists but monitor didn't fire
      const missed = s.isFault && detectedIdx < 0;

      monitorResults.push({ monitor: m.name, ttdFrames, ttdMs, falseAlarm, missed });
    }

    results.push({ scenario: s.name, isFault: s.isFault, trueDetectMs: trueMs, monitors: monitorResults });
  }

  return results;
}

export function formatResultsTable(results: ScenarioResult[]): string {
  const lines: string[] = [
    '# Phase 6: Baseline comparison results',
    '',
    '> Source: synthetic scripted scenarios. All values labelled Synthetic.',
    '> No real ROS2 data has been used yet.',
    '',
  ];

  for (const r of results) {
    lines.push(`## Scenario: ${r.scenario}`);
    lines.push(`- Is fault: ${r.isFault}`);
    lines.push(`- True detect frame: ${r.trueDetectMs >= 0 ? r.trueDetectMs + ' ms' : 'N/A (nominal)'}`);
    lines.push('');
    lines.push('| Monitor | TTD (ms) | False alarm | Missed |');
    lines.push('|---|---|---|---|');
    for (const m of r.monitors) {
      const ttd = m.ttdMs !== null ? `${m.ttdMs} ms` : '—';
      const fa  = m.falseAlarm ? '⚠ YES' : 'No';
      const mis = m.missed     ? '⚠ YES' : 'No';
      lines.push(`| ${m.monitor} | ${ttd} | ${fa} | ${mis} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('> Honest note: if the gate does not outperform thresholds on real data, this table will say so.');

  return lines.join('\n');
}
