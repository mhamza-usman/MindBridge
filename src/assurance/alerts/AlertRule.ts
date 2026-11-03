export interface AlertRule {
  id: string;
  name: string;
  description: string;
  threshold: string;
  severity: 'info' | 'warning' | 'critical';
  check: (evidence: any) => boolean;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  evidence: any;
  recommendedAction: string;
}

export const ALERT_RULES: AlertRule[] = [
  {
    id: 'camera_stale',
    name: 'Camera freshness',
    description: 'Camera messages are stale',
    threshold: 'cam_age_ms > 200ms',
    severity: 'warning',
    check: (e) => parseFloat(e.items['camera_age_ms']?.value || 0) > 200
  },
  {
    id: 'lidar_stale',
    name: 'LiDAR freshness',
    description: 'LiDAR messages are stale',
    threshold: 'lidar_age_ms > 200ms',
    severity: 'warning',
    check: (e) => parseFloat(e.items['lidar_age_ms']?.value || 0) > 200
  },
  {
    id: 'sensors_disagree',
    name: 'Sensor agreement',
    description: 'Camera and LiDAR disagree',
    threshold: 'sensors_agree == false',
    severity: 'critical',
    check: (e) => e.items['sensors_agree']?.value === 'false'
  },
  {
    id: 'calibration_invalid',
    name: 'Calibration valid',
    description: 'Calibration is invalid',
    threshold: 'calibration_valid == false',
    severity: 'critical',
    check: (e) => e.items['calibration_valid']?.value === 'false'
  },
  {
    id: 'perception_low',
    name: 'Perception confidence',
    description: 'Perception confidence is low',
    threshold: 'perception_pct < 70%',
    severity: 'warning',
    check: (e) => parseFloat(e.items['perception_pct']?.value || 100) < 70
  },
  {
    id: 'uncertainty_high',
    name: 'System uncertainty',
    description: 'System uncertainty is high',
    threshold: 'uncertainty_pct > 30%',
    severity: 'warning',
    check: (e) => parseFloat(e.items['uncertainty_pct']?.value || 0) > 30
  }
];

export function checkAlerts(evidence: any, previousAlerts: Alert[]): Alert[] {
  const newAlerts: Alert[] = [];
  const now = Date.now();

  for (const rule of ALERT_RULES) {
    if (rule.check(evidence)) {
      // Check if this alert was already raised in the last 10 seconds
      const recent = previousAlerts.find(a => 
        a.ruleId === rule.id && 
        now - a.timestamp < 10000
      );
      
      if (!recent) {
        newAlerts.push({
          id: `${rule.id}_${now}`,
          ruleId: rule.id,
          ruleName: rule.name,
          description: rule.description,
          severity: rule.severity,
          timestamp: now,
          evidence: evidence,
          recommendedAction: getRecommendedAction(rule.id)
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
    case 'calibration_invalid':
      return 'Calibration is invalid. Do not trust sensor fusion.';
    case 'perception_low':
      return 'Perception confidence is low. Slow down and monitor.';
    case 'uncertainty_high':
      return 'System uncertainty is high. Request operator review.';
    default:
      return 'Review evidence before continuing.';
  }
}
