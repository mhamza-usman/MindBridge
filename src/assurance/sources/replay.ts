import { EvidenceSource } from './types';
import { EvidenceSnapshot, EvidenceItem } from '../domain/types';

export interface ReplaySourceOptions {
  jsonlData?: string;
  sseUrl?: string;
}

const DERIVED_PERCEPTION = 'min(100, max(0, 92 - cam_age_ms*0.08 - lidar_age_ms*0.05))';
const DERIVED_UNCERTAINTY = 'max(0, 100 - perception_pct)';
const DERIVED_TF_AGE = 't - /tf_static publish time (static transform, not a live TF stream)';
const DERIVED_AGREE = 'consistency flag emitted by converter; true in nominal data, false only in injected fault windows';
const DERIVED_GLARE = 'fault-injection parameter from converter (0 outside injected windows)';
const DERIVED_SAT = 'fault-injection parameter from converter (0 outside injected windows)';
const DERIVED_IMU_RATE = 'IMU message rate from /imu topic (Hz); absent when the recording has no IMU field';

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: any): boolean | null {
  if (v === null || v === undefined) return null;
  return v === true || v === 'true';
}

/**
 * Map one JSONL replay line to an EvidenceSnapshot.
 * Only fields actually present in the line become evidence items; absent
 * fields produce no item (contract shows "Not in dataset"). Computed fields
 * carry a `derived` formula string for the DERIVED label.
 */
export function replayLineToSnapshot(line: any): EvidenceSnapshot {
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
    return { t: line.t, items };
  }

  const t = line.t ?? 0;
  const items: Record<string, EvidenceItem> = {};

  const camAge = num(line.cam_age_ms ?? line.camera_age_ms);
  if (camAge !== null) {
    const violated = line.cam_violated ?? camAge > 200;
    items['camera_age_ms'] = {
      id: 'camera_age_ms', label: 'Camera freshness', value: String(camAge), unit: 'ms',
      status: violated ? 'bad' : 'ok', source: 'replay', t
    };
  }

  const lidarAge = num(line.lidar_age_ms);
  if (lidarAge !== null) {
    const violated = line.lidar_violated ?? lidarAge > 200;
    items['lidar_age_ms'] = {
      id: 'lidar_age_ms', label: 'LiDAR freshness', value: String(lidarAge), unit: 'ms',
      status: violated ? 'bad' : 'ok', source: 'replay', t
    };
  }

  const tfAge = num(line.tf_age_ms);
  if (tfAge !== null) {
    items['tf_age_ms'] = {
      id: 'tf_age_ms', label: 'TF age (static)', value: String(tfAge), unit: 'ms',
      status: tfAge > 500 ? 'warn' : 'ok', source: 'replay', t, derived: DERIVED_TF_AGE
    };
  }

  const camRate = num(line.cam_rate_hz);
  if (camRate !== null) {
    items['cam_rate_hz'] = {
      id: 'cam_rate_hz', label: 'Camera rate', value: String(camRate), unit: 'Hz',
      status: camRate < 10 ? 'warn' : 'ok', source: 'replay', t
    };
  }

  const satPct = num(line.saturated_px_pct);
  if (satPct !== null) {
    items['saturated_px_pct'] = {
      id: 'saturated_px_pct', label: 'Saturated pixels', value: String(satPct), unit: '%',
      status: satPct > 5 ? 'warn' : 'ok', source: 'replay', t, derived: DERIVED_SAT
    };
  }

  const glare = bool(line.glare_detected);
  if (glare !== null) {
    items['glare_detected'] = {
      id: 'glare_detected', label: 'Glare detected', value: String(glare),
      status: glare ? 'bad' : 'ok', source: 'replay', t, derived: DERIVED_GLARE
    };
  }

  const agree = bool(line.sensors_agree);
  if (agree !== null) {
    items['sensors_agree'] = {
      id: 'sensors_agree', label: 'Camera and LiDAR agree', value: String(agree),
      status: agree ? 'ok' : 'bad', source: 'replay', t, derived: DERIVED_AGREE
    };
  }

  const perc = num(line.perception_pct);
  if (perc !== null) {
    items['perception_pct'] = {
      id: 'perception_pct', label: 'Perception confidence', value: String(perc), unit: '%',
      status: perc < 70 ? 'warn' : 'ok', source: 'replay', t, derived: DERIVED_PERCEPTION
    };
  }

  const imuRate = num(line.imu_rate_hz);
  if (imuRate !== null) {
    items['imu_rate_hz'] = {
      id: 'imu_rate_hz', label: 'IMU rate', value: String(imuRate), unit: 'Hz',
      status: imuRate <= 0 ? 'bad' : imuRate < 10 ? 'warn' : 'ok', source: 'replay', t, derived: DERIVED_IMU_RATE
    };
  }

  const unc = num(line.uncertainty_pct);
  if (unc !== null) {
    items['uncertainty_pct'] = {
      id: 'uncertainty_pct', label: 'Uncertainty', value: String(unc), unit: '%',
      status: unc > 30 ? 'warn' : 'ok', source: 'replay', t, derived: DERIVED_UNCERTAINTY
    };
  }

  return { t, items, source: 'replay' };
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
    this.notifySnapshot(replayLineToSnapshot(line));
  }
}
