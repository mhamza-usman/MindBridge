import { FusionConfig } from './config';

export interface FusionInput {
  /** Clock skew estimate in ms, or null when it cannot be measured from the data. */
  syncSkewMs: number | null;
  /** True when the camera/LiDAR disagreement signal is present this frame. */
  sensorsDisagree: boolean;
  /** Consecutive frames the disagreement signal has persisted. */
  persistenceCount: number;
  /** Check labels the caller could not measure; surfaced in the report as "not enough evidence". */
  unmeasuredChecks?: string[];

  // Cause 1: Glare
  exposureSaturated: boolean;
  brightPatchOverlaps: boolean;
  floorIsPolished: boolean;
  objectAbsentEarlier: boolean;

  // Cause 2: Dust
  imageSharpnessLow: boolean;
  lidarIntensityDropped: boolean;
  blurIncreasing: boolean;

  // Cause 3: Calibration Drift
  /** null = calibration age cannot be determined from the data. */
  calibrationOld: boolean | null;
  sameOffsetOtherObjects: boolean;
  recentBump: boolean;

  // Cause 4: Real object LiDAR missed
  objectPresentEarlier: boolean;
  shapeMatchesKnown: boolean;
  heightBelowLidar: boolean;
}

export interface CauseScore {
  name: string;
  checksMet: number;
  checksTotal: number;
  score: number;
  evidence: { label: string; met: boolean }[];
  /** Actionable check tied to this cause (product guidance, not sensor data). */
  suggestedCheck: string;
}

export interface DiagnosisReport {
  syncFault: boolean;
  /** Always null: the dataset carries no object localization, so location is "Not enough evidence". */
  conflictLocation: string | null;
  rankedCauses: CauseScore[];
  suggestedChecks: string[];
  cannotTell: string;
  unresolved: boolean;
  /** Cause-check labels that could not be measured from available data. */
  unmeasured: string[];
}

const CAUSE_SUGGESTIONS: Record<string, string> = {
  'Glare on polished floor (camera false positive)': 'Capture a second frame at lower exposure and compare.',
  'Lens dust or partial blockage': 'Clean the lens and re-check image sharpness.',
  'Camera to LiDAR calibration drift': 'Verify camera-LiDAR extrinsics against /tf_static.',
  'Real object the LiDAR missed (glass, thin edge)': 'Confirm with a LiDAR-only pass over the same spot.'
};

export function evaluateFusion(input: FusionInput): DiagnosisReport {
  const unmeasured = input.unmeasuredChecks ?? [];

  if (input.syncSkewMs !== null && input.syncSkewMs > FusionConfig.maxSyncSkewMs) {
    return {
      syncFault: true,
      conflictLocation: null,
      rankedCauses: [],
      suggestedChecks: ['Check clock sync between camera and LiDAR nodes'],
      cannotTell: 'Cannot compare sensors due to sync fault',
      unresolved: true,
      unmeasured
    };
  }

  if (input.sensorsDisagree && input.persistenceCount >= FusionConfig.persistenceFrames) {
    const causes: CauseScore[] = [];

    const glareChecks = [
      { label: 'Exposure saturated in region', met: input.exposureSaturated },
      { label: 'Bright patch overlaps object', met: input.brightPatchOverlaps },
      { label: 'Floor marked polished in map', met: input.floorIsPolished },
      { label: 'LiDAR returns clean', met: false },
      { label: 'Object absent in earlier frames', met: input.objectAbsentEarlier }
    ];
    causes.push({
      name: 'Glare on polished floor (camera false positive)',
      checksMet: glareChecks.filter(c => c.met).length,
      checksTotal: glareChecks.length,
      score: glareChecks.filter(c => c.met).length / glareChecks.length,
      evidence: glareChecks,
      suggestedCheck: CAUSE_SUGGESTIONS['Glare on polished floor (camera false positive)']
    });

    const dustChecks = [
      { label: 'Image sharpness low', met: input.imageSharpnessLow },
      { label: 'LiDAR intensity dropped', met: input.lidarIntensityDropped },
      { label: 'Blur increasing over minutes', met: input.blurIncreasing }
    ];
    causes.push({
      name: 'Lens dust or partial blockage',
      checksMet: dustChecks.filter(c => c.met).length,
      checksTotal: dustChecks.length,
      score: dustChecks.filter(c => c.met).length / dustChecks.length,
      evidence: dustChecks,
      suggestedCheck: CAUSE_SUGGESTIONS['Lens dust or partial blockage']
    });

    const calibChecks = [
      { label: 'Calibration older than 30 days', met: input.calibrationOld === true },
      { label: 'Same offset on other objects', met: input.sameOffsetOtherObjects },
      { label: 'Recent bump or vibration event', met: input.recentBump }
    ];
    causes.push({
      name: 'Camera to LiDAR calibration drift',
      checksMet: calibChecks.filter(c => c.met).length,
      checksTotal: calibChecks.length,
      score: calibChecks.filter(c => c.met).length / calibChecks.length,
      evidence: calibChecks,
      suggestedCheck: CAUSE_SUGGESTIONS['Camera to LiDAR calibration drift']
    });

    const realChecks = [
      { label: 'Object present in earlier frames', met: input.objectPresentEarlier },
      { label: 'Shape matches a known item', met: input.shapeMatchesKnown },
      { label: 'Height below LiDAR plane', met: input.heightBelowLidar }
    ];
    causes.push({
      name: 'Real object the LiDAR missed (glass, thin edge)',
      checksMet: realChecks.filter(c => c.met).length,
      checksTotal: realChecks.length,
      score: realChecks.filter(c => c.met).length / realChecks.length,
      evidence: realChecks,
      suggestedCheck: CAUSE_SUGGESTIONS['Real object the LiDAR missed (glass, thin edge)']
    });

    causes.sort((a, b) => b.score - a.score);

    const topScore = causes[0].score;
    const gap = causes[0].score - causes[1].score;
    const unresolved = topScore < FusionConfig.minTopScore || gap < FusionConfig.minGapToSecond;

    const cannotTellParts: string[] = [];
    if (unresolved) {
      cannotTellParts.push('Not enough measured evidence to rank a cause confidently.');
    }
    if (unmeasured.length > 0) {
      cannotTellParts.push(`Not measurable from this dataset: ${unmeasured.join('; ')}.`);
    }
    cannotTellParts.push('MindBridge cannot see the object. If the checks stay split, it will say Unknown, not pick a cause.');

    return {
      syncFault: false,
      conflictLocation: null,
      rankedCauses: causes,
      suggestedChecks: unresolved ? [] : [causes[0].suggestedCheck],
      cannotTell: cannotTellParts.join(' '),
      unresolved,
      unmeasured
    };
  }

  return {
    syncFault: false,
    conflictLocation: null,
    rankedCauses: [],
    suggestedChecks: [],
    cannotTell: '',
    unresolved: false,
    unmeasured
  };
}
