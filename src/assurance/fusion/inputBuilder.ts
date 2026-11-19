import { FusionInput } from './detector';
import { FusionConfig } from './config';
import { EvidenceSnapshot } from '../domain/types';

/**
 * Measurements derived from the telemetry stream that the fusion detector can
 * consume. Each field is null when it cannot be computed — never guessed.
 */
export interface FusionMetrics {
  /** Laplacian-variance sharpness below FusionConfig.sharpnessMinVariance */
  sharpnessLow: boolean | null;
  /** Sharpness trending upward over the window (blur decreasing) */
  blurTrendUp: boolean | null;
  /** Recent/baseline mean LiDAR intensity below FusionConfig.intensityDropRatio */
  intensityDropped: boolean | null;
  /** Calibration age > 30 days. null = calibration file carries no timestamps. */
  calibrationStale: boolean | null;
}

const EMPTY_METRICS: FusionMetrics = {
  sharpnessLow: null,
  blurTrendUp: null,
  intensityDropped: null,
  calibrationStale: null
};

function itemNum(evidence: EvidenceSnapshot, id: string): number | null {
  const v = evidence.items[id]?.value;
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function itemBool(evidence: EvidenceSnapshot, id: string): boolean {
  return evidence.items[id]?.value === 'true';
}

/**
 * Build a FusionInput purely from measured evidence. Signals that cannot be
 * measured from the dataset are set false and listed in `unmeasuredChecks`.
 */
export function buildFusionInput(
  evidence: EvidenceSnapshot,
  disagreementStreak: number,
  metrics: FusionMetrics = EMPTY_METRICS
): FusionInput {
  // Clock skew is NOT measurable from this data: cam_age/lidar_age are
  // publish-phase ages, not synchronized timestamps. Report null (unmeasured)
  // rather than fabricating a skew estimate.
  const syncSkewMs: number | null = null;

  const saturated = itemNum(evidence, 'saturated_px_pct');
  const exposureSaturated = saturated !== null && saturated > FusionConfig.saturatedPxPctThreshold;

  const unmeasured: string[] = [];
  unmeasured.push('Sensor clock skew');
  if (metrics.sharpnessLow === null) unmeasured.push('Image sharpness low', 'Blur increasing over minutes');
  if (metrics.intensityDropped === null) unmeasured.push('LiDAR intensity dropped');
  if (metrics.calibrationStale === null) unmeasured.push('Calibration older than 30 days');
  // Structurally unmeasurable in this dataset:
  unmeasured.push(
    'Bright patch overlaps object',
    'Floor marked polished in map',
    'Object absent in earlier frames',
    'LiDAR returns clean',
    'Same offset on other objects',
    'Recent bump or vibration event',
    'Object present in earlier frames',
    'Shape matches a known item',
    'Height below LiDAR plane'
  );

  return {
    syncSkewMs,
    sensorsDisagree: evidence.items['sensors_agree']?.value === 'false' || itemBool(evidence, 'glare_detected'),
    persistenceCount: disagreementStreak,
    unmeasuredChecks: unmeasured,
    exposureSaturated,
    brightPatchOverlaps: false,
    floorIsPolished: false,
    objectAbsentEarlier: false,
    imageSharpnessLow: metrics.sharpnessLow === true,
    lidarIntensityDropped: metrics.intensityDropped === true,
    blurIncreasing: metrics.blurTrendUp === true,
    calibrationOld: metrics.calibrationStale,
    sameOffsetOtherObjects: false,
    recentBump: false,
    objectPresentEarlier: false,
    shapeMatchesKnown: false,
    heightBelowLidar: false
  };
}
