import { TelemetryData } from './TelemetrySource';

export class TelemetryBuffer {
  private buffer: TelemetryData[] = [];
  private maxSize: number;
  private windowSize: number; // seconds

  constructor(maxSize: number = 1000, windowSize: number = 60) {
    this.maxSize = maxSize;
    this.windowSize = windowSize;
  }

  add(data: TelemetryData): void {
    this.buffer.push(data);
    this.cleanup();
  }

  cleanup(): void {
    // Remove data older than window size
    if (this.buffer.length > 0) {
      const latestTime = this.buffer[this.buffer.length - 1].t;
      this.buffer = this.buffer.filter(d => d.t >= latestTime - this.windowSize);
    }

    // Cap at max size
    if (this.buffer.length > this.maxSize) {
      this.buffer = this.buffer.slice(-this.maxSize);
    }
  }

  getAll(): TelemetryData[] {
    return this.buffer;
  }

  getLatest(): TelemetryData | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null;
  }

  getIMUData(): Array<{ t: number; accel_x: number; accel_y: number; accel_z: number; accel_mag: number; gyro_x: number; gyro_y: number; gyro_z: number; gyro_mag: number }> {
    return this.buffer.map(d => ({
      t: d.t,
      accel_x: d.imu?.accel_x || 0,
      accel_y: d.imu?.accel_y || 0,
      accel_z: d.imu?.accel_z || 0,
      accel_mag: d.imu?.accel_mag || 0,
      gyro_x: d.imu?.gyro_x || 0,
      gyro_y: d.imu?.gyro_y || 0,
      gyro_z: d.imu?.gyro_z || 0,
      gyro_mag: d.imu?.gyro_mag || 0,
    }));
  }

  getSensorTimelineData(): Array<{ t: number; cam_age_ms: number; lidar_age_ms: number; cam_rate: number; lidar_rate: number }> {
    return this.buffer.map(d => ({
      t: d.t,
      cam_age_ms: d.cam_age_ms,
      lidar_age_ms: d.lidar_age_ms,
      cam_rate: d.cam_rate,
      lidar_rate: d.lidar_rate,
    }));
  }

  getLatestCameraData() {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].camera : null;
  }

  getLatestLidarData() {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].lidar : null;
  }

  clear(): void {
    this.buffer = [];
  }
}
