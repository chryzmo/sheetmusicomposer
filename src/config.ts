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
  // Experimental classifier policy, NOT population-calibrated probabilities.
  // Weighted $P distance cutoff is unchanged; the smaller top-two label gap
  // is development-informed (same-session leave-one-group-out, not held-out
  // validation). Both apply at 32 samples; revalidate if sampling changes.
  primitiveMaxDistance: 1.5,
  primitiveMinMargin: 0.1,
  // Plausible notehead bounds in staff spaces (filled and hollow share these).
  primitiveHeadMinWidth: 0.4,
  primitiveHeadMaxWidth: 1.8,
  primitiveHeadMinHeight: 0.3,
  primitiveHeadMaxHeight: 1.2,
  // Dimensionless width/height range: reject narrow loops and flattened marks.
  primitiveHeadMinAspect: 0.6,
  primitiveHeadMaxAspect: 2.5,
  // Stem bounds in staff spaces; size normalization cannot check these.
  // The wider/slanted allowance is a development-informed guess. Linearity
  // below checks the body, rather than treating a tilted straight stem as wide.
  primitiveStemMinHeight: 1.5,
  primitiveStemMaxHeight: 5,
  primitiveStemMaxWidth: 1.8,
  // Dimensionless width/height ceiling (roughly a 33-degree straight slant).
  primitiveStemMaxAspect: 0.65,
  // Minor/major covariance eigenvalue ceiling on the derived 32-point cloud.
  // A guessed line-fit tolerance: permits observed jitter/retracing, rejects
  // bends/loops. It is not raw endpoint/path-length "straightness" or confidence.
  primitiveStemMaxLinearityRatio: 0.02,
  // Initially support single-stroke stems only; multi-stroke groups remain ink
  // until reviewed examples justify a less restrictive rule.
  primitiveStemMaxStrokes: 1,
  // Fixture annotation safety limits, not recognition thresholds.
  maxFixtureTextLength: 2000,
  maxFixtureDots: 2,
} as const;
