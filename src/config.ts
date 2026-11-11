export const config = {
  // Width of the initial single-staff document in staff spaces.
  staffWidth: 40,
  // Visual ink width in staff spaces; not a recognition threshold.
  inkWidth: 0.12,
  // Preferred initial CSS pixels per staff space before fitting a narrow viewport.
  initialSpaceSize: 18,
  // Padding around the staff when fitting the initial view, in staff spaces.
  viewPadding: 2,
  // Minimum/maximum view scale in CSS pixels per staff space for pinch zoom.
  // These are display limits, not recognition or palm-rejection thresholds.
  minSpaceSize: 2,
  maxSpaceSize: 96,
  // Import safety limits: bound JSON file size and decoded ink allocations.
  maxBackupBytes: 10 * 1024 * 1024,
  maxStoredStrokes: 10000,
  maxStoredPoints: 1000000,
  // Number of derived samples per $P cloud; raw ink is never resampled in place.
  pointCloudSampleCount: 32,
  // Bound the quadratic matching work when preparing experimental clouds.
  maxPointCloudSampleCount: 128,
  // $P's starting-point search exponent (the published reference uses 0.5).
  pointCloudSearchExponent: 0.5,
  // Experimental classifier guesses, NOT calibrated on held-out handwriting.
  // Weighted $P acceptance distance and top-two label gap at the configured
  // 32 samples. Retune/revalidate both if the sampling configuration changes.
  primitiveMaxDistance: 1.5,
  primitiveMinMargin: 0.4,
  // Plausible notehead bounds in staff spaces (filled and hollow share these).
  primitiveHeadMinWidth: 0.4,
  primitiveHeadMaxWidth: 1.8,
  primitiveHeadMinHeight: 0.3,
  primitiveHeadMaxHeight: 1.2,
  // Dimensionless width/height range: reject narrow loops and flattened marks.
  primitiveHeadMinAspect: 0.6,
  primitiveHeadMaxAspect: 2.5,
  // Plausible stem bounds in staff spaces; size normalization cannot check these.
  primitiveStemMinHeight: 1.5,
  primitiveStemMaxHeight: 5,
  primitiveStemMaxWidth: 0.6,
  // Dimensionless stem width/height ceiling and endpoint/path-length floor.
  primitiveStemMaxAspect: 0.25,
  primitiveStemMinStraightness: 0.85,
  // Initially support single-stroke stems only; multi-stroke groups remain ink
  // until reviewed examples justify a less restrictive rule.
  primitiveStemMaxStrokes: 1,
  // Fixture annotation safety limits, not recognition thresholds.
  maxFixtureTextLength: 2000,
  maxFixtureDots: 2,
} as const;
