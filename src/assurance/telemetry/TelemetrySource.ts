import { EvidenceSnapshot, EvidenceItem } from '../domain';

export interface TelemetryData {
  t: number;
  source: string;
  cam_age_ms: number;
  lidar_age_ms: number;
  camera?: {
    image_base64?: string | null;
    width: number;
    height: number;
    has_image: boolean;
    original_width?: number;
    original_height?: number;
  };
  lidar?: {
    points: Array<{ x: number; y: number; z: number }>;
    num_points: number;
    has_lidar: boolean;
  };
  imu?: {
    accel_x: number;
    accel_y: number;
    accel_z: number;
    accel_mag: number;
    gyro_x: number;
    gyro_y: number;
    gyro_z: number;
    gyro_mag: number;
    has_imu: boolean;
  };
  cam_rate: number;
  lidar_rate: number;
}

export class TelemetrySource {
  private sseUrl: string;
  private esRef: EventSource | null = null;
  private listeners: Array<(data: TelemetryData) => void> = [];
  private timerRef: NodeJS.Timeout | null = null;

  constructor({ sseUrl }: { sseUrl: string }) {
    this.sseUrl = sseUrl;
  }

  onSnapshot(cb: (data: TelemetryData) => void): void {
    this.listeners.push(cb);
  }

  start(): void {
    if (typeof window === 'undefined') return;

    this.esRef = new EventSource(this.sseUrl);

    this.esRef.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as TelemetryData;
        this.listeners.forEach(cb => cb(data));
      } catch (e) {
        console.error('Failed to parse telemetry data:', e);
      }
    };

    this.esRef.onerror = (e) => {
      console.error('SSE error:', e);
      this.esRef?.close();
    };
  }

  stop(): void {
    this.esRef?.close();
    this.esRef = null;
    this.listeners = [];
    if (this.timerRef) {
      clearInterval(this.timerRef);
      this.timerRef = null;
    }
  }
}
