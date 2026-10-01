import { InMemoryFleetAggregator, FleetSnapshot, RolloutInfo } from './FleetAggregator';
import { EvidenceSnapshot } from '../domain/types';

/**
 * Synthetic fleet scenario:
 * - 8 robots total
 * - Rollout v1.2 → v1.3 in progress (5 updated, 3 pending)
 * - RB-04 and RB-07 degraded shortly after firmware update (anomaly)
 * - RB-06 in Unknown state (evidence missing)
 */

function makeEvidence(t: number, items: Record<string, string> = {}): EvidenceSnapshot {
  const base: EvidenceSnapshot = {
    t,
    source: 'synthetic',
    items: {
      camera_age_ms:       { id: 'camera_age_ms',       label: 'Camera freshness', value: '90',    status: 'ok', source: 'synthetic', t },
      lidar_age_ms:        { id: 'lidar_age_ms',        label: 'LiDAR freshness',  value: '70',    status: 'ok', source: 'synthetic', t },
      sensors_agree:       { id: 'sensors_agree',       label: 'Sensors agree',    value: 'true',  status: 'ok', source: 'synthetic', t },
      battery_reserve_pct: { id: 'battery_reserve_pct', label: 'Battery',          value: '68',    status: 'ok', source: 'synthetic', t },
      calibration_valid:   { id: 'calibration_valid',   label: 'Calibration',      value: 'true',  status: 'ok', source: 'synthetic', t },
    },
  };
  for (const [k, v] of Object.entries(items)) {
    if (base.items[k]) base.items[k].value = v;
  }
  return base;
}

export function createSyntheticFleet(): InMemoryFleetAggregator {
  const rollout: RolloutInfo = {
    from_version: 'v1.2.1',
    to_version:   'v1.3.0',
    updated:  ['RB-01', 'RB-02', 'RB-03', 'RB-04', 'RB-07'],
    pending:  ['RB-05', 'RB-06', 'RB-08'],
    halted:   false,
    anomaly_flagged: false,
    flag_reason: null,
  };

  const agg = new InMemoryFleetAggregator('fleet-warehouse-A', rollout);

  const now = Date.now();

  // Register all 8 robots
  const robots = [
    { id: 'RB-01', name: 'Robot 01', fw: 'v1.3.0', state: 'Autonomous'  as const, updatedAt: now - 120_000 },
    { id: 'RB-02', name: 'Robot 02', fw: 'v1.3.0', state: 'Autonomous'  as const, updatedAt: now - 115_000 },
    { id: 'RB-03', name: 'Robot 03', fw: 'v1.3.0', state: 'Autonomous'  as const, updatedAt: now - 110_000 },
    { id: 'RB-04', name: 'Robot 04', fw: 'v1.3.0', state: 'Degraded'    as const, updatedAt: now - 35_000  }, // within 60s window
    { id: 'RB-05', name: 'Robot 05', fw: 'v1.2.1', state: 'Autonomous'  as const, updatedAt: now - 200_000 },
    { id: 'RB-06', name: 'Robot 06', fw: 'v1.2.1', state: 'Unknown'     as const, updatedAt: now - 90_000  },
    { id: 'RB-07', name: 'Robot 07', fw: 'v1.3.0', state: 'Supervised'  as const, updatedAt: now - 45_000  }, // within 60s window
    { id: 'RB-08', name: 'Robot 08', fw: 'v1.2.1', state: 'Autonomous'  as const, updatedAt: now - 300_000 },
  ];

  for (const r of robots) {
    agg.registerRobot(r.id, r.name, r.fw);
    // Set initial state (nominal first)
    agg.updateRobotState(r.id, 'Autonomous', makeEvidence(r.updatedAt), r.fw);
  }

  // Now apply degraded states for the robots that should degrade after firmware update
  // RB-04: degraded within 60s of update → should trigger anomaly
  agg.updateRobotState('RB-04', 'Degraded', makeEvidence(now, { camera_age_ms: '450' }), 'v1.3.0');

  // RB-07: supervised within 60s of update → should trigger anomaly
  agg.updateRobotState('RB-07', 'Supervised', makeEvidence(now, { sensors_agree: 'false' }), 'v1.3.0');

  // RB-06: unknown (evidence missing)
  agg.updateRobotState('RB-06', 'Unknown', makeEvidence(now, { camera_age_ms: 'no data' }), 'v1.2.1');

  return agg;
}
