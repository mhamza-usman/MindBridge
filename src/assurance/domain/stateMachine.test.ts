import assert from 'node:assert';
import { AssuranceStateMachine } from './stateMachine';

function runTests() {
  console.log('Running stateMachine tests...');

  // Test 1: Precedence (Unknown > Degraded)
  const sm1 = new AssuranceStateMachine();
  let res = sm1.tick(0, { 'camera': 'unk', 'lidar': 'bad' }, false, 'Autonomous');
  assert.strictEqual(res.state, 'Unknown', 'Unknown should take precedence over Degraded');

  // Test 2: Precedence (Blocked floor > Unknown)
  const sm2 = new AssuranceStateMachine();
  res = sm2.tick(0, { 'camera': 'unk' }, false, 'Emergency');
  assert.strictEqual(res.state, 'Blocked', 'Emergency floor (Blocked) should take precedence over Unknown');

  // Test 3: Escalation (Degraded -> Supervised)
  const sm3 = new AssuranceStateMachine({ escalationTimeMs: 20000, holdTimeMs: 10000 });
  res = sm3.tick(0, { 'lidar': 'bad' }, false, 'Autonomous');
  assert.strictEqual(res.state, 'Degraded');
  res = sm3.tick(10000, { 'lidar': 'bad' }, false, 'Autonomous');
  assert.strictEqual(res.state, 'Degraded');
  res = sm3.tick(20000, { 'lidar': 'bad' }, false, 'Autonomous');
  assert.strictEqual(res.state, 'Supervised', 'Should escalate to Supervised after 20s');

  // Test 4: Recovery (Supervised -> Degraded -> Autonomous)
  const sm4 = new AssuranceStateMachine({ escalationTimeMs: 20000, holdTimeMs: 10000 });
  sm4.tick(0, {}, true, 'Autonomous'); // fusion conflict = Supervised
  assert.strictEqual(sm4.getState(), 'Supervised');
  res = sm4.tick(1000, {}, false, 'Autonomous');
  assert.strictEqual(res.state, 'Supervised', 'Should hold Supervised during recovery');
  res = sm4.tick(11000, {}, false, 'Autonomous');
  assert.strictEqual(res.state, 'Degraded', 'Should step down ONE level to Degraded after hold time');
  res = sm4.tick(12000, {}, false, 'Autonomous');
  assert.strictEqual(res.state, 'Degraded', 'Should hold Degraded during recovery');
  res = sm4.tick(21000, {}, false, 'Autonomous');
  assert.strictEqual(res.state, 'Autonomous', 'Should step down ONE level to Autonomous after hold time');

  console.log('All stateMachine tests passed!');
}

runTests();
