import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { replayLineToSnapshot } from './replay';
import { getDefaultContract } from '../contract/loader';
import { evaluateContract } from '../contract/evaluator';
import { AssuranceStateMachine } from '../domain/stateMachine';
import { FusionConfig } from '../fusion/config';
import { nesyModeFor, disagreeStreak } from '../baseline/real_data';

const DIR = path.resolve(__dirname, '../../../public/replay');

function loadJsonl(name: string): any[] {
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

function runTests() {
  console.log('Running ReplaySource mapping tests...');

  // emit mapping: a realistic JSONL line becomes evidence items
  const line = {
    t: 1.5, source: 'r2b_replay',
    cam_age_ms: 42, lidar_age_ms: 55, tf_age_ms: 61000,
    cam_rate_hz: 30, saturated_px_pct: 0, glare_detected: false,
    sensors_agree: true, perception_pct: 91.2, uncertainty_pct: 8.8
  };
  const snap = replayLineToSnapshot(line);
  assert.strictEqual(snap.t, 1.5);
  assert.strictEqual(snap.items['camera_age_ms'].value, '42');
  assert.strictEqual(snap.items['camera_age_ms'].status, 'ok');
  // computed fields must carry DERIVED formulas
  assert.ok(snap.items['perception_pct'].derived, 'perception_pct must be labelled DERIVED');
  assert.ok(snap.items['uncertainty_pct'].derived, 'uncertainty_pct must be labelled DERIVED');
  assert.ok(snap.items['tf_age_ms'].derived, 'tf_age_ms must be labelled DERIVED');
  // fields absent from the line must NOT appear as evidence
  assert.strictEqual(snap.items['battery_reserve_pct'], undefined, 'no battery fallback');
  assert.strictEqual(snap.items['localization_std_m'], undefined, 'no localization fallback');
  assert.strictEqual(snap.items['calibration_valid'], undefined, 'no calibration fallback');

  // null fields stay absent
  const sparse = replayLineToSnapshot({ t: 0.2, cam_age_ms: 10, lidar_age_ms: 12, tf_age_ms: null });
  assert.strictEqual(sparse.items['tf_age_ms'], undefined, 'null tf_age must not fabricate');

  console.log('ReplaySource mapping tests passed!');
}

function runNominalRegression() {
  console.log('Running nominal-replay regression (901 frames)...');
  const lines = loadJsonl('r2b_nominal.jsonl');
  if (lines.length === 0) {
    console.log('  (skipping: r2b_nominal.jsonl not generated)');
    return;
  }
  assert.strictEqual(lines.length, 901, 'nominal replay should have 901 frames');

  const contract = getDefaultContract();
  const sm = new AssuranceStateMachine();
  const snaps = lines.map(replayLineToSnapshot);
  const histogram: Record<string, number> = {};

  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    const checks = evaluateContract(contract, snap);
    const streak = disagreeStreak(snaps, i);
    const res = sm.tick(snap.t * 1000, checks, streak >= FusionConfig.persistenceFrames, nesyModeFor(snap), snap);
    histogram[res.state] = (histogram[res.state] ?? 0) + 1;
  }

  console.log('  state histogram:', histogram);
  assert.strictEqual(histogram['Autonomous'], 901, 'nominal replay must be Autonomous for all 901 frames');
  console.log('Nominal regression passed: 901/901 Autonomous');
}

runTests();
runNominalRegression();
