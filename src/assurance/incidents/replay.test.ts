import assert from 'node:assert';
import { IncidentRecorder } from './recorder';
import { IncidentBundle } from './types';
import { incidentSteps, replayStates, isIncidentBundle } from './replay';
import { EvidenceSnapshot, EvidenceItem } from '../domain/types';

function ev(t: number, camAge: number | null): EvidenceSnapshot {
  const items: Record<string, EvidenceItem> = {};
  if (camAge !== null) {
    items['camera_age_ms'] = { id: 'camera_age_ms', label: 'Camera freshness', value: String(camAge), unit: 'ms', status: camAge > 200 ? 'bad' : 'ok', source: 'replay', t };
  }
  return { t, source: 'replay', items };
}

/**
 * Round-trip: record transitions with evidence -> export JSON -> import ->
 * replay -> the state sequence and held evidence must match what was recorded.
 * The replay uses only the bundle's own contents (no live/replay source).
 */
function runTests() {
  console.log('Running incident replay round-trip tests...');

  const rec = new IncidentRecorder();
  rec.start('warehouse_navigation', 'v1', 'replay');

  // Simulate a recorded incident: Autonomous -> Degraded -> Autonomous.
  const seq: Array<[string, number | null]> = [
    ['Autonomous', 40],
    ['Degraded', 350],
    ['Autonomous', 45]
  ];
  seq.forEach(([state, camAge], i) => {
    rec.recordState(
      state as any,
      [`camera_age_ms: ${camAge ?? 'missing'} vs limit 200`],
      'Continue with caution',
      ['camera_age_ms'],
      camAge === null ? ['lidar_age_ms'] : [],
      camAge !== null && camAge > 200 ? ['camera_age_ms'] : [],
      ev(i * 10, camAge)
    );
  });
  rec.recordOperatorAction('Acknowledged', 'op_test');
  const bundle = rec.getBundle() as IncidentBundle;
  assert.ok(bundle, 'bundle should exist after recording');

  // Export -> import (JSON round-trip, exactly what the file loader does).
  const exported = JSON.stringify(bundle, null, 2);
  const imported = JSON.parse(exported);
  assert.ok(isIncidentBundle(imported), 'exported bundle must validate on import');

  // Replay from the imported bundle alone.
  const steps = incidentSteps(imported);
  assert.ok(steps.length >= 4, 'expected transition steps + operator action');

  // Same state sequence as recorded.
  const states = replayStates(imported);
  assert.deepStrictEqual(states, ['Autonomous', 'Degraded', 'Autonomous'], 'replayed state sequence must match recording');

  // Evidence snapshots are carried inside the bundle — replay shows them.
  const degradedStep = steps.find((s) => s.raw.type === 'state_transition' && (s.raw.data as any).to === 'Degraded');
  assert.ok(degradedStep?.evidence, 'Degraded transition must carry its EvidenceSnapshot');
  assert.strictEqual(degradedStep!.evidence!.items['camera_age_ms'].value, '350');
  assert.strictEqual(degradedStep!.evidence!.items['camera_age_ms'].status, 'bad');

  // Null evidence is preserved: record a transition with a missing field.
  const rec2 = new IncidentRecorder();
  rec2.start('m', 'v1', 'replay');
  rec2.recordState('Unknown' as any, ['camera_age_ms missing'], 'Halt recommendation', [], ['camera_age_ms'], ['camera_age_ms'], ev(0, null));
  const b2 = JSON.parse(JSON.stringify(rec2.getBundle())) as IncidentBundle;
  const s2 = incidentSteps(b2);
  const st = s2.find((s) => s.raw.type === 'state_transition' && (s.raw.data as any).to === 'Unknown');
  assert.ok(st, 'transition step exists');
  assert.strictEqual(st!.evidence!.items['camera_age_ms'], undefined, 'missing field stays absent, not fabricated');
  assert.deepStrictEqual(replayStates(b2), ['Unknown']);

  // Operator action replays with its payload.
  const opStep = steps.find((s) => s.type === 'operator_action');
  assert.strictEqual(opStep?.action, 'Acknowledged');
  assert.strictEqual(opStep?.operator, 'op_test');

  // isIncidentBundle rejects junk.
  assert.strictEqual(isIncidentBundle({ foo: 1 }), false);
  assert.strictEqual(isIncidentBundle(null), false);

  console.log('All incident replay round-trip tests passed!');
}

runTests();
