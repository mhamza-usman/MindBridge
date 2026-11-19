import { EvidenceSnapshot } from '../domain/types';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  threshold: string;
  severity: 'info' | 'warning' | 'critical';
  /** Evidence item ids this rule needs. Any missing/null field raises an UNKNOWN-evidence alert, never a silent pass. */
  fields: string[];
  check: (evidence: EvidenceSnapshot) => boolean;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  evidence: EvidenceSnapshot;
  recommendedAction: string;
  /** Set when the alert is about absent evidence rather than a violated threshold. */
  kind?: 'violation' | 'unknown_evidence';
  missingFields?: string[];
}

/** Maps an alert rule to the contract assumption it evidences (for click-through). */
export const ALERT_TO_ASSUMPTION: Record<string, string> = {
  camera_stale: 'camera_age_ms',
  lidar_stale: 'lidar_age_ms',
  sensors_disagree: 'sensors_agree'
  // perception_low / uncertainty_high have no contract row — they open Live view.
};

function num(e: EvidenceSnapshot, id: string): number | null {
  const v = e.items[id]?.value;
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function str(e: EvidenceSnapshot, id: string): string | null {
  const v = e.items[id]?.value;
  return v === undefined || v === null || v === '' ? null : v;
}

/** Fields a rule cannot evaluate because the evidence item is absent or empty. */
export function missingFields(rule: AlertRule, e: EvidenceSnapshot): string[] {
  return rule.fields.filter((f) => {
    const item = e.items[f];
    return !item || item.value === undefined || item.value === null || item.value === '';
  });
}

export const ALERT_RULES: AlertRule[] = [
  {
    id: 'camera_stale',
    name: 'Camera freshness',
    description: 'Camera messages are stale',
    threshold: 'cam_age_ms > 200ms',
    severity: 'warning',
    fields: ['camera_age_ms'],
    check: (e) => {
      const v = num(e, 'camera_age_ms');
      return v !== null && v > 200;
    }
  },
  {
    id: 'lidar_stale',
    name: 'LiDAR freshness',
    description: 'LiDAR messages are stale',
    threshold: 'lidar_age_ms > 200ms',
    severity: 'warning',
    fields: ['lidar_age_ms'],
    check: (e) => {
      const v = num(e, 'lidar_age_ms');
      return v !== null && v > 200;
    }
  },
  {
    id: 'sensors_disagree',
    name: 'Sensor agreement',
    description: 'Camera and LiDAR disagree',
    threshold: 'sensors_agree == false',
    severity: 'critical',
    fields: ['sensors_agree'],
    check: (e) => str(e, 'sensors_agree') === 'false'
  },
  {
    id: 'perception_low',
    name: 'Perception confidence',
    description: 'Perception confidence is low',
    threshold: 'perception_pct < 70%',
    severity: 'warning',
    fields: ['perception_pct'],
    check: (e) => {
      const v = num(e, 'perception_pct');
      return v !== null && v < 70;
    }
  },
  {
    id: 'uncertainty_high',
    name: 'System uncertainty',
    description: 'System uncertainty is high',
    threshold: 'uncertainty_pct > 30%',
    severity: 'warning',
    fields: ['uncertainty_pct'],
    check: (e) => {
      const v = num(e, 'uncertainty_pct');
      return v !== null && v > 30;
    }
  }
];

const DEDUPE_MS = 10000;

export function checkAlerts(evidence: EvidenceSnapshot, previousAlerts: Alert[]): Alert[] {
  const newAlerts: Alert[] = [];
  const now = Date.now();

  const recentlyRaised = (key: string) =>
    previousAlerts.some((a) => a.id.startsWith(key) && now - a.timestamp < DEDUPE_MS);

  for (const rule of ALERT_RULES) {
    const missing = missingFields(rule, evidence);
    if (missing.length > 0) {
      // Unknown evidence: name the missing field(s). Never a silent pass.
      const key = `unknown_evidence:${rule.id}`;
      if (!recentlyRaised(key)) {
        newAlerts.push({
          id: `${key}_${now}`,
          ruleId: rule.id,
          ruleName: `${rule.name} (unknown evidence)`,
          description: `Cannot evaluate: missing evidence field(s): ${missing.join(', ')}`,
          severity: 'info',
          timestamp: now,
          evidence,
          recommendedAction: 'Check the evidence source; this check cannot run without the field.',
          kind: 'unknown_evidence',
          missingFields: missing
        });
      }
      continue;
    }

    if (rule.check(evidence)) {
      const key = `violation:${rule.id}`;
      if (!recentlyRaised(key)) {
        newAlerts.push({
          id: `${key}_${now}`,
          ruleId: rule.id,
          ruleName: rule.name,
          description: rule.description,
          severity: rule.severity,
          timestamp: now,
          evidence,
          recommendedAction: getRecommendedAction(rule.id),
          kind: 'violation'
        });
      }
    }
  }

  return newAlerts;
}

function getRecommendedAction(ruleId: string): string {
  switch (ruleId) {
    case 'camera_stale':
      return 'Robot is navigating on old camera data. Continue with caution.';
    case 'lidar_stale':
      return 'LiDAR data is stale. Obstacle detection may be unreliable.';
    case 'sensors_disagree':
      return 'Camera and LiDAR disagree. Review before proceeding.';
    case 'perception_low':
      return 'Perception confidence is low. Slow down and monitor.';
    case 'uncertainty_high':
      return 'System uncertainty is high. Request operator review.';
    default:
      return 'Review evidence before continuing.';
  }
}
