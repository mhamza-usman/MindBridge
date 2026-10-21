import { EvidenceSource } from './types';
import { EvidenceSnapshot, EvidenceItem } from '../domain/types';

export interface ReplaySourceOptions {
  jsonlData?: string;
  sseUrl?: string;
}

export class ReplaySource implements EvidenceSource {
  public id = 'replay_source_1';
  public kind: 'replay' = 'replay';

  private lines: any[] = [];
  private listeners: Array<(s: EvidenceSnapshot) => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private idx = 0;
  private esRef: EventSource | undefined;
  private options: ReplaySourceOptions;

  constructor(options: ReplaySourceOptions | string) {
    if (typeof options === 'string') {
      this.options = { jsonlData: options };
    } else {
      this.options = options;
    }

    if (this.options.jsonlData) {
      this.lines = this.options.jsonlData.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    }
  }

  public start() {
    // SSE streaming mode
    if (this.options.sseUrl) {
      const es = new EventSource(this.options.sseUrl);
      this.esRef = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          // Convert raw SSE format to EvidenceSnapshot
          this.emit(data);
        } catch {
          // ignore malformed lines
        }
      };
      es.onerror = () => {
        console.warn('[ReplaySource] SSE stream error or closed');
      };
      return;
    }

    // Local file replay mode (legacy)
    this.timer = setInterval(() => {
      if (this.idx < this.lines.length) {
        this.emit(this.lines[this.idx++]);
      } else {
        this.stop();
      }
    }, 1000);
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    if (this.esRef) {
      this.esRef.close();
      this.esRef = undefined;
    }
  }

  public onSnapshot(cb: (s: EvidenceSnapshot) => void) {
    this.listeners.push(cb);
  }

  private notifySnapshot(snapshot: EvidenceSnapshot) {
    for (const cb of this.listeners) cb(snapshot);
  }

  private emit(line: any) {
    // Legacy format: has evidence field
    if (line.evidence) {
      const items: Record<string, EvidenceItem> = {};
      for (const [k, v] of Object.entries(line.evidence || {})) {
        items[k] = {
          id: k,
          label: k,
          value: String(v),
          status: 'ok',
          source: 'replay',
          t: line.t
        };
      }
      const s: EvidenceSnapshot = { t: line.t, items };
      this.notifySnapshot(s);
    } else {
      // SSE stream format: convert raw fields to EvidenceSnapshot
      const camAge = line.cam_age_ms ?? line.camera_age_ms ?? 0;
      const lidarAge = line.lidar_age_ms ?? 0;
      const tfAge = line.tf_age_ms ?? 45;
      const battery = line.battery_pct ?? line.battery_reserve_pct ?? 78;
      const calib = line.calibration_valid ?? true;
      const agree = line.sensors_agree ?? true;

      const items: Record<string, EvidenceItem> = {
        'camera_age_ms': {
          id: 'camera_age_ms',
          label: 'Camera freshness',
          value: String(camAge),
          unit: 'ms',
          status: camAge > 200 ? 'bad' : 'ok',
          source: 'replay',
          t: line.t
        },
        'lidar_age_ms': {
          id: 'lidar_age_ms',
          label: 'LiDAR freshness',
          value: String(lidarAge),
          unit: 'ms',
          status: lidarAge > 200 ? 'bad' : 'ok',
          source: 'replay',
          t: line.t
        },
        'tf_age_ms': {
          id: 'tf_age_ms',
          label: 'TF age',
          value: String(tfAge),
          unit: 'ms',
          status: tfAge > 500 ? 'bad' : 'ok',
          source: 'replay',
          t: line.t
        },
        'localization_std_m': {
          id: 'localization_std_m',
          label: 'Localization std dev',
          value: String(line.localization_std_m ?? '0.032'),
          unit: 'm',
          status: 'ok',
          source: 'replay',
          t: line.t
        },
        'battery_reserve_pct': {
          id: 'battery_reserve_pct',
          label: 'Battery reserve',
          value: String(battery),
          unit: '%',
          status: battery < 20 ? 'bad' : 'ok',
          source: 'replay',
          t: line.t
        },
        'calibration_valid': {
          id: 'calibration_valid',
          label: 'Calibration valid',
          value: String(calib),
          status: calib ? 'ok' : 'bad',
          source: 'replay',
          t: line.t
        },
        'sensors_agree': {
          id: 'sensors_agree',
          label: 'Camera and LiDAR agree',
          value: String(agree),
          status: agree ? 'ok' : 'bad',
          source: 'replay',
          t: line.t
        },
        'cam_rate_hz': {
          id: 'cam_rate_hz',
          label: 'Camera rate',
          value: String(line.cam_rate_hz || 0),
          unit: 'Hz',
          status: (line.cam_rate_hz || 0) < 10 ? 'warn' : 'ok',
          source: 'replay',
          t: line.t
        },
        'glare_detected': {
          id: 'glare_detected',
          label: 'Glare detected',
          value: String(line.glare_detected ?? false),
          status: line.glare_detected ? 'bad' : 'ok',
          source: 'replay',
          t: line.t
        },
        'perception_pct': {
          id: 'perception_pct',
          label: 'Perception confidence',
          value: String(line.perception_pct || 0),
          unit: '%',
          status: (line.perception_pct || 0) < 70 ? 'warn' : 'ok',
          source: 'replay',
          t: line.t
        },
        'uncertainty_pct': {
          id: 'uncertainty_pct',
          label: 'Uncertainty',
          value: String(line.uncertainty_pct || 0),
          unit: '%',
          status: (line.uncertainty_pct || 0) > 30 ? 'warn' : 'ok',
          source: 'replay',
          t: line.t
        }
      };
      const s: EvidenceSnapshot = { t: line.t, items, source: 'replay' };
      this.notifySnapshot(s);
    }
  }
}
