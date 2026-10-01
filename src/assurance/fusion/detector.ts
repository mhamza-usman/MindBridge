import { FusionConfig } from './config';

export interface FusionInput {
  syncSkewMs: number;
  persistenceCount: number;
  cameraSeesObject: boolean;
  lidarSeesObject: boolean;
  
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
  calibrationOld: boolean;
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
}

export interface DiagnosisReport {
  syncFault: boolean;
  conflictLocation: string | null;
  rankedCauses: CauseScore[];
  suggestedChecks: string[];
  cannotTell: string;
  unresolved: boolean;
}

export function evaluateFusion(input: FusionInput): DiagnosisReport {
  if (input.syncSkewMs > FusionConfig.maxSyncSkewMs) {
    return {
      syncFault: true,
      conflictLocation: null,
      rankedCauses: [],
      suggestedChecks: ['Check clock sync between camera and LiDAR nodes'],
      cannotTell: 'Cannot compare sensors due to sync fault',
      unresolved: true
    };
  }

  if (input.cameraSeesObject !== input.lidarSeesObject && input.persistenceCount >= FusionConfig.persistenceFrames) {
    const causes: CauseScore[] = [];

    const glareChecks = [
      { label: 'Exposure saturated in region', met: input.exposureSaturated },
      { label: 'Bright patch overlaps object', met: input.brightPatchOverlaps },
      { label: 'Floor marked polished in map', met: input.floorIsPolished },
      { label: 'LiDAR returns clean', met: !input.lidarSeesObject },
      { label: 'Object absent in earlier frames', met: input.objectAbsentEarlier }
    ];
    causes.push({
      name: 'Glare on polished floor (camera false positive)',
      checksMet: glareChecks.filter(c => c.met).length,
      checksTotal: glareChecks.length,
      score: glareChecks.filter(c => c.met).length / glareChecks.length,
      evidence: glareChecks
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
      evidence: dustChecks
    });

    const calibChecks = [
      { label: 'Calibration older than 30 days', met: input.calibrationOld },
      { label: 'Same offset on other objects', met: input.sameOffsetOtherObjects },
      { label: 'Recent bump or vibration event', met: input.recentBump }
    ];
    causes.push({
      name: 'Camera to LiDAR calibration drift',
      checksMet: calibChecks.filter(c => c.met).length,
      checksTotal: calibChecks.length,
      score: calibChecks.filter(c => c.met).length / calibChecks.length,
      evidence: calibChecks
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
      evidence: realChecks
    });

    causes.sort((a, b) => b.score - a.score);

    const topScore = causes[0].score;
    const gap = causes[0].score - causes[1].score;
    const unresolved = topScore < FusionConfig.minTopScore || gap < FusionConfig.minGapToSecond;

    return {
      syncFault: false,
      conflictLocation: 'At 3.2 m, 1.5 m left', 
      rankedCauses: causes,
      suggestedChecks: [
        'Capture a second frame at lower exposure.',
        'Slow to 0.3 m/s through the polished zone.',
        'Run one LiDAR-only pass over the same spot.'
      ],
      cannotTell: 'MindBridge cannot see the object. If the checks stay split, it will say Unknown, not pick a cause.',
      unresolved
    };
  }

  return {
    syncFault: false,
    conflictLocation: null,
    rankedCauses: [],
    suggestedChecks: [],
    cannotTell: '',
    unresolved: false
  };
}
