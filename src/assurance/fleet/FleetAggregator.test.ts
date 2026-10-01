import assert from 'node:assert';
import { InMemoryFleetAggregator, RolloutInfo } from './FleetAggregator';
import { EvidenceSnapshot } from '../domain/types';

function makeEvidence(t: number): EvidenceSnapshot {
  return { t, items: {}, source: 'synthetic' };
}

const baseRollout: RolloutInfo = {
  from_version: 'v1.2.0',
  to_version: 'v1.3.0',
  updated: ['RB-01', 'RB-02'],
  pending: ['RB-03', 'RB-04', 'RB-05'],
  halted: false,
  anomaly_flagged: false,
  flag_reason: null,
};

function runTests() {
  console.log('Running FleetAggregator tests...');

  // 1. Initial snapshot has correct health (all Unknown → 0 autonomous)
  const agg = new InMemoryFleetAggregator('fleet-test', baseRollout);
  ['RB-01','RB-02','RB-03','RB-04','RB-05'].forEach(id =>
    agg.registerRobot(id, id, id === 'RB-01' || id === 'RB-02' ? 'v1.3.0' : 'v1.2.0')
  );
  let snap = agg.getSnapshot();
  assert.strictEqual(snap.healthPct, 0, 'No autonomous robots yet');
  assert.strictEqual(snap.robots.length, 5);

  // 2. Updating 2 robots to Autonomous raises health to 40%
  agg.updateRobotState('RB-01', 'Autonomous', makeEvidence(Date.now()), 'v1.3.0');
  agg.updateRobotState('RB-02', 'Autonomous', makeEvidence(Date.now()), 'v1.3.0');
  snap = agg.getSnapshot();
  assert.strictEqual(snap.healthPct, 40);

  // 3. Rollout anomaly: updated robot degrades within 60s
  const now = Date.now();
  // Mark RB-01 as recently updated by setting lastUpdated to just now
  agg.updateRobotState('RB-01', 'Autonomous', makeEvidence(now - 10_000), 'v1.3.0');
  // Now degrade — within 60s window
  agg.updateRobotState('RB-01', 'Degraded', makeEvidence(now), 'v1.3.0');
  snap = agg.getSnapshot();
  assert.strictEqual(snap.rollout.anomaly_flagged, true, 'Should flag rollout anomaly');
  assert.ok(snap.events.some(e => e.type === 'rollout_anomaly'), 'Fleet event emitted');

  // 4. Halt rollout logs event, sets halted flag
  agg.logOperatorAction('Halt rollout');
  snap = agg.getSnapshot();
  assert.strictEqual(snap.rollout.halted, true);
  assert.ok(snap.events.some(e => e.type === 'halt_logged'), 'Halt logged');

  // 5. Resume rollout logs event, clears halted flag
  agg.logOperatorAction('Resume rollout');
  snap = agg.getSnapshot();
  assert.strictEqual(snap.rollout.halted, false);
  assert.ok(snap.events.some(e => e.type === 'resume_logged'), 'Resume logged');

  // 6. Subscribe receives snapshot immediately and on update
  let received = 0;
  const unsub = agg.subscribe(() => received++);
  assert.strictEqual(received, 1, 'Immediate emit on subscribe');
  agg.updateRobotState('RB-03', 'Autonomous', makeEvidence(Date.now()), 'v1.2.0');
  assert.strictEqual(received, 2, 'Callback fired on update');
  unsub();
  agg.updateRobotState('RB-04', 'Autonomous', makeEvidence(Date.now()), 'v1.2.0');
  assert.strictEqual(received, 2, 'No call after unsubscribe');

  // 7. Health % is Autonomous / total
  snap = agg.getSnapshot();
  const autoCount = snap.robots.filter(r => r.state === 'Autonomous').length;
  assert.strictEqual(snap.healthPct, Math.round(autoCount / snap.robots.length * 100));

  console.log('All FleetAggregator tests passed!');
}

runTests();
