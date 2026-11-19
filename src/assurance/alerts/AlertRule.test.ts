import assert from 'node:assert';
import { ALERT_RULES, checkAlerts, missingFields } from './AlertRule';
import { EvidenceSnapshot, EvidenceItem } from '../domain/types';

function snap(items: Record<string, string | null>): EvidenceSnapshot {
  const out: Record<string, EvidenceItem> = {};
  for (const [k, v] of Object.entries(items)) {
    if (v !== null) {
      out[k] = { id: k, label: k, value: v, status: 'ok', source: 'replay', t: 0 };
    }
  }
  return { t: 0, source: 'replay', items: out };
}

const FULL: Record<string, string | null> = {
  camera_age_ms: '50',
  lidar_age_ms: '50',
  sensors_agree: 'true',
  perception_pct: '90',
  uncertainty_pct: '10'
};

function runTests() {
  console.log('Running AlertRule tests...');

  // Every rule must declare the fields it needs.
  for (const rule of ALERT_RULES) {
    assert.ok(rule.fields.length > 0, `${rule.id} must declare required fields`);
  }

  // No fallbacks: a rule's check must return false (not throw, not pass) on empty evidence.
  const empty = snap({});
  for (const rule of ALERT_RULES) {
    assert.strictEqual(rule.check(empty), false, `${rule.id}.check must not fire on empty evidence`);
    const missing = missingFields(rule, empty);
    assert.deepStrictEqual(missing.sort(), [...rule.fields].sort(), `${rule.id} should report all fields missing`);
  }

  // Null/empty values count as missing.
  for (const field of Object.keys(FULL)) {
    const s = snap({ ...FULL, [field]: null });
    for (const rule of ALERT_RULES) {
      if (rule.fields.includes(field)) {
        assert.ok(missingFields(rule, s).includes(field), `${rule.id} should flag missing ${field}`);
      }
    }
  }

  // checkAlerts raises an UNKNOWN-evidence alert naming the missing field — never silent.
  const partial = snap({ camera_age_ms: '50', lidar_age_ms: '50' }); // sensors_agree, perception, uncertainty absent
  const alerts = checkAlerts(partial, []);
  const unknownAlerts = alerts.filter((a) => a.kind === 'unknown_evidence');
  assert.ok(unknownAlerts.length >= 3, 'expected unknown-evidence alerts for absent fields');
  const names = unknownAlerts.flatMap((a) => a.missingFields ?? []);
  assert.ok(names.includes('sensors_agree'), 'unknown alert must name sensors_agree');
  assert.ok(names.includes('perception_pct'), 'unknown alert must name perception_pct');
  assert.ok(names.includes('uncertainty_pct'), 'unknown alert must name uncertainty_pct');
  assert.ok(unknownAlerts.every((a) => a.severity === 'info'), 'unknown-evidence alerts are informational');

  // No violation alerts when all fields present and healthy.
  const healthy = checkAlerts(snap(FULL), []);
  assert.strictEqual(healthy.filter((a) => a.kind === 'violation').length, 0, 'healthy evidence must not violate');

  // Violations still fire with real values.
  const stale = checkAlerts(snap({ ...FULL, camera_age_ms: '500' }), []);
  const camAlert = stale.find((a) => a.ruleId === 'camera_stale');
  assert.ok(camAlert && camAlert.kind === 'violation', 'stale camera must raise violation');

  // Dead calibration_valid rule is gone.
  assert.ok(!ALERT_RULES.some((r) => r.id === 'calibration_valid'), 'calibration_valid rule must be removed');
  assert.ok(!ALERT_RULES.some((r) => r.id === 'calibration_invalid'), 'calibration_invalid rule must be removed');

  // Dedupe: same missing field does not re-alert within the window.
  const again = checkAlerts(partial, alerts);
  assert.strictEqual(again.filter((a) => a.kind === 'unknown_evidence').length, 0, 'dedupe within 10s window');

  console.log('All AlertRule tests passed!');
}

runTests();
