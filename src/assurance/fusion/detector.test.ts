import assert from 'node:assert';
import { evaluateFusion, FusionInput } from './detector';
import { buildFusionInput } from './inputBuilder';
import { replayLineToSnapshot } from '../sources/replay';
import * as fs from 'node:fs';
import * as path from 'node:path';

function createBaseInput(): FusionInput {
  return {
    syncSkewMs: 10,
    sensorsDisagree: true,
    persistenceCount: 5,
    exposureSaturated: false,
    brightPatchOverlaps: false,
    floorIsPolished: false,
    objectAbsentEarlier: false,
    imageSharpnessLow: false,
    lidarIntensityDropped: false,
    blurIncreasing: false,
    calibrationOld: false,
    sameOffsetOtherObjects: false,
    recentBump: false,
    objectPresentEarlier: false,
    shapeMatchesKnown: false,
    heightBelowLidar: false
  };
}

function runTests() {
  console.log('Running fusion detector tests...');

  // 1. Fake glare (raise exposure)
  const glareInput = createBaseInput();
  glareInput.exposureSaturated = true;
  glareInput.brightPatchOverlaps = true;
  glareInput.floorIsPolished = true;
  glareInput.objectAbsentEarlier = true;
  let res = evaluateFusion(glareInput);
  assert.strictEqual(res.unresolved, false);
  assert.strictEqual(res.rankedCauses[0].name, 'Glare on polished floor (camera false positive)');

  // 2. Fake dust (blur)
  const dustInput = createBaseInput();
  dustInput.imageSharpnessLow = true;
  dustInput.blurIncreasing = true;
  res = evaluateFusion(dustInput);
  assert.strictEqual(res.unresolved, false);
  assert.strictEqual(res.rankedCauses[0].name, 'Lens dust or partial blockage');

  // 3. Offset extrinsics
  const calibInput = createBaseInput();
  calibInput.calibrationOld = true;
  calibInput.sameOffsetOtherObjects = true;
  calibInput.recentBump = true;
  res = evaluateFusion(calibInput);
  assert.strictEqual(res.unresolved, false);
  assert.strictEqual(res.rankedCauses[0].name, 'Camera to LiDAR calibration drift');

  // 4. Thin/glass object
  const realInput = createBaseInput();
  realInput.objectPresentEarlier = true;
  realInput.heightBelowLidar = true;
  res = evaluateFusion(realInput);
  assert.strictEqual(res.unresolved, false);
  assert.strictEqual(res.rankedCauses[0].name, 'Real object the LiDAR missed (glass, thin edge)');

  // 5. Ambiguous (Gap < 0.2)
  const ambiguousInput = createBaseInput();
  ambiguousInput.exposureSaturated = true;
  ambiguousInput.brightPatchOverlaps = true;
  ambiguousInput.floorIsPolished = true; // glare 3/5 = 0.6
  ambiguousInput.imageSharpnessLow = true;
  ambiguousInput.blurIncreasing = true; // dust 2/3 = 0.667. Gap = 0.067
  res = evaluateFusion(ambiguousInput);
  assert.strictEqual(res.unresolved, true, 'Should be unresolved due to low gap (<0.2)');

  // 6. Sync fault
  const syncInput = createBaseInput();
  syncInput.syncSkewMs = 100;
  res = evaluateFusion(syncInput);
  assert.strictEqual(res.syncFault, true);

  // 7. Unmeasured sync skew (null) must NOT be a sync fault
  const noSkew = createBaseInput();
  noSkew.syncSkewMs = null;
  res = evaluateFusion(noSkew);
  assert.strictEqual(res.syncFault, false, 'Unmeasured skew must not fault');

  // 8. No disagreement -> empty report
  const agree = createBaseInput();
  agree.sensorsDisagree = false;
  res = evaluateFusion(agree);
  assert.strictEqual(res.rankedCauses.length, 0);
  assert.strictEqual(res.unresolved, false);

  console.log('All fusion detector tests passed!');
}

function runRealDataTests() {
  console.log('Running fusion detector real-data tests...');
  const file = path.resolve(__dirname, '../../../public/replay/r2b_telemetry.jsonl');
  if (!fs.existsSync(file)) {
    console.log('  (skipping: r2b_telemetry.jsonl not generated)');
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  assert.ok(lines.length > 100, 'telemetry file should have many frames');

  // Real measured fields must be present and numeric
  let sawSharpness = false;
  let sawIntensity = false;
  let sawSixCameras = false;
  for (const l of lines) {
    const cams = l.cameras || {};
    const keys = Object.keys(cams);
    if (keys.length >= 6) sawSixCameras = true;
    for (const k of keys) {
      const c = cams[k];
      if (c && c.has_image && typeof c.sharpness === 'number' && c.sharpness > 0) sawSharpness = true;
    }
    if (l.lidar && typeof l.lidar.mean_intensity === 'number') sawIntensity = true;
  }
  assert.ok(sawSharpness, 'converter should emit real sharpness values');
  assert.ok(sawSixCameras, 'converter should emit all six camera topics');
  console.log(`  intensity measured: ${sawIntensity}`);

  // Nominal replay frames must not produce a conflict report
  const nominalFile = path.resolve(__dirname, '../../../public/replay/r2b_nominal.jsonl');
  if (fs.existsSync(nominalFile)) {
    const nominal = fs.readFileSync(nominalFile, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    for (const line of nominal) {
      const snap = replayLineToSnapshot(line);
      const input = buildFusionInput(snap, 0);
      const report = evaluateFusion(input);
      assert.strictEqual(report.syncFault, false);
      assert.strictEqual(report.rankedCauses.length, 0, 'nominal data must not raise fusion causes');
    }
    console.log(`  nominal: ${nominal.length} frames, no fusion conflicts`);
  }

  // Conflict-scenario frames carry the injected disagreement signal
  const conflictFile = path.resolve(__dirname, '../../../public/replay/r2b_conflict.jsonl');
  if (fs.existsSync(conflictFile)) {
    const conflict = fs.readFileSync(conflictFile, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const injected = conflict.filter(l => l.sensors_agree === false);
    assert.ok(injected.length > 0, 'conflict scenario should contain injected disagreement');
    let streak = 0;
    let sawReport = false;
    for (const line of conflict) {
      const snap = replayLineToSnapshot(line);
      streak = line.sensors_agree === false ? streak + 1 : 0;
      const input = buildFusionInput(snap, streak);
      const report = evaluateFusion(input);
      if (report.rankedCauses.length > 0) {
        sawReport = true;
        // With mostly-unmeasurable inputs the honest outcome is unresolved or low scores
        assert.ok(report.unmeasured.length > 0, 'report should list unmeasured checks');
        assert.strictEqual(report.conflictLocation, null, 'no location without object data');
      }
    }
    assert.ok(sawReport, 'sustained injected disagreement should produce a fusion report');
    console.log(`  conflict: ${injected.length} injected frames -> fusion report produced`);
  }

  console.log('All fusion detector real-data tests passed!');
}

runTests();
runRealDataTests();
