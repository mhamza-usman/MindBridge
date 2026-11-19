import { FusionMetrics } from './inputBuilder';
import { FusionConfig } from './config';
import { TelemetryData } from '../telemetry/TelemetrySource';

const WINDOW = 60;
const INTENSITY_BASELINE_N = 50;
const INTENSITY_RECENT_N = 10;

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Rolling metrics computed from the real telemetry stream.
 * Every value is DERIVED from measured fields (converter-computed sharpness,
 * mean LiDAR intensity). Returns null fields when not enough data exists.
 */
export class FusionMetricsBuffer {
  private sharpness: number[] = [];
  private intensity: number[] = [];

  push(data: TelemetryData): void {
    const cams = data.cameras;
    if (cams) {
      // Prefer the primary RGB camera; fall back to any camera reporting sharpness.
      const primary = cams['hawk_0_left_rgb_image'] ?? cams['d455_1_rgb_image'];
      const s = primary?.sharpness;
      if (typeof s === 'number' && Number.isFinite(s)) {
        this.sharpness.push(s);
        if (this.sharpness.length > WINDOW) this.sharpness.shift();
      }
    }
    const mi = data.lidar?.mean_intensity;
    if (typeof mi === 'number' && Number.isFinite(mi)) {
      this.intensity.push(mi);
      if (this.intensity.length > WINDOW) this.intensity.shift();
    }
  }

  metrics(): FusionMetrics {
    const sharp = this.sharpness;
    let sharpnessLow: boolean | null = null;
    let blurTrendUp: boolean | null = null;

    if (sharp.length >= 10) {
      const latest = sharp[sharp.length - 1];
      const baseline = median(sharp.slice(0, Math.min(INTENSITY_BASELINE_N, sharp.length)));
      // Low sharpness: below absolute floor OR below half the early baseline.
      sharpnessLow = latest < FusionConfig.sharpnessMinVariance ||
        (Number.isFinite(baseline) && baseline > 0 && latest < 0.5 * baseline);

      // Blur increasing: mean of last 10 frames clearly below the 10 before that.
      if (sharp.length >= 20) {
        const recent = sharp.slice(-10);
        const prior = sharp.slice(-20, -10);
        const rMean = recent.reduce((a, b) => a + b, 0) / recent.length;
        const pMean = prior.reduce((a, b) => a + b, 0) / prior.length;
        blurTrendUp = pMean > 0 && rMean < 0.8 * pMean;
      }
    }

    let intensityDropped: boolean | null = null;
    if (this.intensity.length >= INTENSITY_BASELINE_N + INTENSITY_RECENT_N) {
      const baseline = median(this.intensity.slice(0, INTENSITY_BASELINE_N));
      const recent = this.intensity.slice(-INTENSITY_RECENT_N);
      const rMean = recent.reduce((a, b) => a + b, 0) / recent.length;
      intensityDropped = baseline > 0 && rMean < FusionConfig.intensityDropRatio * baseline;
    }

    return {
      sharpnessLow,
      blurTrendUp,
      intensityDropped,
      // r2b_calibration.json carries no timestamps, so calibration age cannot
      // be determined — reported honestly as unmeasured.
      calibrationStale: null
    };
  }
}
