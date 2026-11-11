# Recognition foundation: $P point-cloud matcher

The matcher in `src/recognize/templates.ts` adapts the published **$P** algorithm. It is a shape-comparison building block, not the app's recognizer: nothing on the canvas is converted into notes yet.

## Current API and boundaries

- `preparePointCloud(strokes, count?)` accepts geometry-only strokes (captured `Stroke` objects also fit structurally), makes derived copies, resamples pen-down paths, uniformly scales, and centers them. It returns original staff-space bounds and source IDs alongside normalized points. Raw time, pressure, tilt, completion, positions, and sample order are not changed.
- `prepareTemplate(strokes, metadata, count?)` prepares a labeled example with a stable template ID and source provenance. These are in-memory APIs; there is no template-file decoder/store/training UI yet. Do not cast untrusted saved templates to these types.
- `pointCloudDistance(a, b)` uses $P's weighted, bidirectional greedy matching and starting-point search. This is approximate point-cloud matching, not an exact assignment solver. Counts must agree.
- `rankPointCloud(query, templates)` evaluates each template, returns the best example for each label, and sorts the labels by distance. Exact ties use label/template IDs lexically, not insertion order or host locale. There is no cross-template pruning that would invalidate runner-up scores. An empty bank returns no candidates.

**Distances are not probabilities.** They are not comparable across different sample counts, and a nearest template is not automatically a known symbol. No distance/margin rejection threshold, confidence calibration, personal-template priority, grouping, pitch decision, musical assembly, measure resolution, or model command is implemented here. Those belong to the next pipeline stages. Keep unsupported/uncertain ink visible when those stages are connected.

The full primitive vocabulary lives in `src/recognize/primitives.ts` and is shared with fixture validation. `createBuiltinTemplates()` supplies three explicitly **synthetic** authored examples: a filled-head zigzag, hollow ellipse, and vertical stem. They are a small experimental seed bank, not real handwriting, copied HOMUS samples, or a claim of useful classifier accuracy. The recorded fixture is never used as a template in this bank.

## Normalization and degenerate input

Resampling never interpolates between different pen strokes. Translation and uniform scale are normalized; aspect ratio is retained, and rotation/reflection are not normalized away. Assembly must use original staff-space geometry, not centered template coordinates.

- Taps/repeated points do not divide by zero or loop indefinitely. If the whole group's pen-down path has zero length, select original points by index instead of inventing connectors between isolated taps. This is an explicit extension of upstream $P, whose degenerate normalization can produce NaN.
- An isolated zero-length stroke mixed with a nonzero path can receive no derived samples, as with the reference resampling scheme. Raw ink remains intact. The later grouping stage must keep augmentation dots separate; this matcher does not solve dot association.
- Empty strokes, duplicate/empty stroke IDs, nonfinite coordinates, overflowing bounds, invalid normalized clouds, duplicate template IDs, and incompatible sample counts fail explicitly. A later classifier should handle invalid/unusable groups conservatively, not erase ink.
- Path arithmetic uses stable lengths, with a uniform-scale fallback for overflowing totals or underflowing sample intervals. Matching uses the reference arithmetic on bounded normalized coordinates. Source copying and bounded loops replace upstream's input-array splicing.

`src/config.ts` holds sample count (32), the allowed experimental sample-count ceiling (128), and starting-point search exponent (0.5). No calibrated music-recognition thresholds exist yet. Do not tune these using held-out test cases and then call those cases an independent accuracy result.

## License and reference checks

Source: <https://depts.washington.edu/acelab/proj/dollar/pdollar.js>, reference last updated July 14, 2018.

Pinned retrieved-source SHA-256: `a36ee4b844171de940cb46dde3f3998a8424c68b570a42ed490992aea2ae1654`.

Copyright (C) 2012 Radu-Daniel Vatavu, Lisa Anthony, and Jacob O. Wobbrock. The complete upstream New BSD notice, citation, and adaptation notes are retained in [`public/third-party-notices.txt`](../public/third-party-notices.txt). Vite copies this file into `dist/`, so deploy it with the rest of the artifact. A WebKit test verifies its contents are served. No upstream demo gesture samples are bundled, and no npm runtime dependency is needed.

Tests include nine distance goldens obtained independently from that pinned upstream implementation: eight comparisons between locally authored shapes and one comparison between the real Pencil fixture's head/stem strokes. Tests run offline against checked-in expected values. These are algorithm-conformance tests, not label predictions. Additional tests cover immutable raw data, normalization, pen-up gaps, articulation variation, degenerate input, range limits, ranked alternatives, and provenance.

## Evaluation status and next steps

**Before/after recognition accuracy: N/A → N/A.** The four reviewed fixture files still validate and round-trip. Matching tests and synthetic self/invariance matches must not be counted as held-out handwriting recognition successes. The real `Quarter-e4` fixture remains primitive-only ground truth, with no expected note event.

Next add reviewed templates and session-held-out input, then the primitive classifier's geometric checks and conservative unknown rejection. Report confusion/coverage per primitive and fixture set, distinguishing synthetic from recorded cases. Grouping/assembly, validated event commands/persistence, and VexFlow integration follow. Evaluate $Q behind the same interface only after establishing this baseline and measuring actual iPad latency. No iPad performance or accuracy is claimed by the matcher unit tests.

HOMUS use remains gated on clear data reuse terms and a reviewed mapping from its whole-symbol labels to our primitive pipeline. No corpus, neural model, browser inference runtime, or remote recognition service is added here.
