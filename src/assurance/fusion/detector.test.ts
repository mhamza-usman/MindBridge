import assert from 'node:assert';
import { evaluateFusion, FusionInput } from './detector';

function createBaseInput(): FusionInput {
  return {
    syncSkewMs: 10,
    persistenceCount: 5,
    cameraSeesObject: true,
    lidarSeesObject: false,
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
  calibInput.recentBump = true;
  calibInput.sameOffsetOtherObjects = true;
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
  ambiguousInput.imageSharpnessLow = true;
  ambiguousInput.blurIncreasing = true; // Dust score 2/3 = 0.66, Glare score 3/5 = 0.6. Gap = 0.06
  res = evaluateFusion(ambiguousInput);
  assert.strictEqual(res.unresolved, true, 'Should be unresolved due to low gap (<0.2)');

  // 6. Sync fault
  const syncInput = createBaseInput();
  syncInput.syncSkewMs = 100;
  res = evaluateFusion(syncInput);
  assert.strictEqual(res.syncFault, true);

  console.log('All fusion detector tests passed!');
}

runTests();
