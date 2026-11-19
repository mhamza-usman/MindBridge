export const FusionConfig = {
  maxSyncSkewMs: 50,
  persistenceFrames: 5,
  minTopScore: 0.6,
  minGapToSecond: 0.2,
  /** saturated_px_pct above this counts as an exposure-saturation signal */
  saturatedPxPctThreshold: 5.0,
  /** Laplacian-variance sharpness below this counts as a low-sharpness signal (DERIVED metric) */
  sharpnessMinVariance: 20.0,
  /** recent/baseline mean LiDAR intensity ratio below this counts as a drop (DERIVED metric) */
  intensityDropRatio: 0.8,
};
