import { EvidenceSource } from './types';
import { EvidenceSnapshot, EvidenceItem, Validity } from '../domain/types';

export class SyntheticSource implements EvidenceSource {
  public id = 'synthetic_source_1';
  public kind: 'synthetic' = 'synthetic';
  
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(s: EvidenceSnapshot) => void> = [];
  private currentScenario: 'nominal' | 'stale' | 'conflict' | 'unknown' = 'nominal';

  public start() {
    this.timer = setInterval(() => this.emit(), 1000);
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public onSnapshot(cb: (s: EvidenceSnapshot) => void) {
    this.listeners.push(cb);
  }

  public setScenario(scenario: 'nominal' | 'stale' | 'conflict' | 'unknown') {
    this.currentScenario = scenario;
    this.emit();
  }

  private emit() {
    const s = this.getSnapshot(this.currentScenario);
    for (const cb of this.listeners) {
      cb(s);
    }
  }

  private getSnapshot(scenario: string): EvidenceSnapshot {
    const items: Record<string, EvidenceItem> = {};
    const t = Date.now();

    const add = (id: string, label: string, value: string, status: Validity) => {
      items[id] = { id, label, value, status, source: 'synthetic', t };
    };

    if (scenario === 'nominal') {
      add('camera_age_ms', 'Camera freshness', '80', 'ok');
      add('lidar_age_ms', 'LiDAR freshness', '60', 'ok');
      add('tf_age_ms', 'TF age', '45', 'ok');
      add('localization_std_m', 'Localization std dev', '0.032', 'ok');
      add('battery_reserve_pct', 'Battery reserve', '78', 'ok');
      add('calibration_valid', 'Calibration', 'true', 'ok');
      add('sensors_agree', 'Camera and LiDAR agree', 'true', 'ok');
    } else if (scenario === 'stale') {
      add('camera_age_ms', 'Camera freshness', '450', 'bad');
      add('lidar_age_ms', 'LiDAR freshness', '120', 'ok');
      add('tf_age_ms', 'TF age', '45', 'ok');
      add('localization_std_m', 'Localization std dev', '0.032', 'ok');
      add('battery_reserve_pct', 'Battery reserve', '78', 'ok');
      add('calibration_valid', 'Calibration', 'true', 'ok');
      add('sensors_agree', 'Camera and LiDAR agree', 'unk', 'unk');
    } else if (scenario === 'conflict') {
      add('camera_age_ms', 'Camera freshness', '90', 'ok');
      add('lidar_age_ms', 'LiDAR freshness', '70', 'ok');
      add('tf_age_ms', 'TF age', '45', 'ok');
      add('localization_std_m', 'Localization std dev', '0.034', 'ok');
      add('battery_reserve_pct', 'Battery reserve', '78', 'ok');
      add('calibration_valid', 'Calibration', 'true', 'ok');
      add('sensors_agree', 'Sensor agreement', 'false', 'bad');
    } else if (scenario === 'unknown') {
      add('camera_age_ms', 'Camera freshness', '1900', 'bad');
      add('lidar_age_ms', 'LiDAR freshness', 'NaN', 'unk');
      add('tf_age_ms', 'TF age', '45', 'ok');
      add('localization_std_m', 'Localization std dev', 'NaN', 'unk');
      add('battery_reserve_pct', 'Battery reserve', '78', 'ok');
      add('calibration_valid', 'Calibration', 'false', 'bad');
      add('sensors_agree', 'Sensor agreement', 'unk', 'unk');
    }

    return { t, items };
  }
}
