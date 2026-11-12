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
  // Personal-template limits (training samples saved on this device). Bounds
  // matching cost, which grows with every template, and storage. Guesses, not
  // tuned: per supported label, and per sample's raw points.
  maxUserTemplatesPerLabel: 30,
  maxUserTemplatePoints: 20000,
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
  // Grouping guesses, NOT calibrated from handwriting. All grouping times use
  // an explicit monotonic observation clock, never raw sample timestamps.
  groupPauseMs: 500,
  // Bound a recomputed grouping window and compact fragment-chain size.
  groupMaxInputStrokes: 256,
  groupMaxStrokesPerGroup: 8,
  // Staff-space fragment minima keep taps, small dots, and thin horizontal/
  // vertical lines separate. Union size must also fit the head bounds above.
  groupFragmentMinWidth: 0.2,
  groupFragmentMinHeight: 0.2,
  groupFragmentMinExtent: 0.3,
  // Staff-space endpoint join radius and single-path closed-loop radius.
  // Ambiguous endpoint pairings remain separate instead of choosing nearest.
  groupEndpointMaxGap: 0.15,
  groupLoopMaxGap: 0.1,
  // Staff-space padding for inset fill/retracing inside a compact closed path.
  groupContainmentPadding: 0.05,
  // Assembly guesses, NOT calibrated acceptance thresholds. Process one finished
  // measure at a time; cap the quadratic attachment/blocker work explicitly.
  assemblyMaxPrimitives: 256,
  // Maximum Euclidean gap from an actual stem tip to the head's original bounds,
  // in staff spaces. Both matching tips / competing heads or stems are rejected.
  assemblyTipMaxGap: 0.25,
  // Axis-wise staff-space clearance around each source primitive of a note.
  // Extra ink inside this guard could change duration/pitch or be a gesture;
  // this deliberately exceeds the attachment gap to withhold near misses too.
  assemblyInkClearance: 0.5,
  // Minimum horizontal gap between head bounds, in staff spaces. Overlapping
  // columns are withheld rather than interpreted as chords/multiple voices.
  assemblyHeadColumnClearance: 0.25,
  // Opt-in review processing cap, not an acceptance/accuracy threshold. Larger
  // pages remain ink; never truncate a page to manufacture a smaller review.
  reviewMaxPoints: 50000,
  // Bound VexFlow/DOM preview work, not recognition acceptance. Refuse rather
  // than silently displaying/keeping a truncated subset of proposals.
  reviewMaxDisplayNotes: 32,
  // Musical document validation limits, not recognition/calibration settings.
  maxMusicMeasures: 1000,
  maxMusicIdLength: 256,
  maxMusicDots: 2,
  // Fixture annotation safety limits, not recognition thresholds.
  // How close a tap must land to a stroke, in staff spaces, to select it while
  // labeling a test measure. A usability tolerance, not a recognition threshold.
  quickLabelTapDistance: 0.8,
  maxFixtureTextLength: 2000,
  maxFixtureDots: 2,
} as const;
