# Recognition foundation: $P point-cloud matcher

The matcher in `src/recognize/templates.ts` adapts the published **$P** algorithm. It is a shape-comparison building block, not the app's recognizer: nothing on the canvas is converted into notes yet.

## Current API and boundaries

- `preparePointCloud(strokes, count?)` accepts geometry-only strokes (captured `Stroke` objects also fit structurally), makes derived copies, resamples pen-down paths, uniformly scales, and centers them. It returns original staff-space bounds and source IDs alongside normalized points. Raw time, pressure, tilt, completion, positions, and sample order are not changed.
- `prepareTemplate(strokes, metadata, count?)` prepares a labeled example with a stable template ID and source provenance. These are in-memory APIs; there is no template-file decoder/store/training UI yet. Do not cast untrusted saved templates to these types.
- `pointCloudDistance(a, b)` uses $P's weighted, bidirectional greedy matching and starting-point search. This is approximate point-cloud matching, not an exact assignment solver. Counts must agree.
- `rankPointCloud(query, templates)` evaluates each template, returns the best example for each label, and sorts the labels by distance. Exact ties use label/template IDs lexically, not insertion order or host locale. There is no cross-template pruning that would invalidate runner-up scores. An empty bank returns no candidates.

**Distances are not probabilities.** They are not comparable across different sample counts, and a nearest template is not automatically a known symbol. The matcher does not itself reject candidates; the experimental classifier below adds a conservative policy. Confidence calibration, personal-template priority, live pipeline integration, measure resolution, and model commands remain future work. A [pure grouping stage](grouping.md) now proposes groups using original geometry and explicit observation clocks/regions, but no live coordinator is connected. A separate [pure assembly stage](assembly.md) now provides pitch/duration candidates from already-labeled heads/stems, without integrating recognition or events into the app. Keep unsupported/uncertain ink visible when those stages are connected.

The full primitive vocabulary lives in `src/recognize/primitives.ts` and is shared with fixture validation. `createBuiltinTemplates()` supplies three explicitly **synthetic** authored examples: a filled-head zigzag, hollow ellipse, and vertical stem. They are a small experimental seed bank, not real handwriting, copied HOMUS samples, or a claim of useful classifier accuracy. The recorded fixture is never used as a template in this bank.

## Normalization and degenerate input

Resampling never interpolates between different pen strokes. Translation and uniform scale are normalized; aspect ratio is retained, and rotation/reflection are not normalized away. Assembly must use original staff-space geometry, not centered template coordinates.

- Taps/repeated points do not divide by zero or loop indefinitely. If the whole group's pen-down path has zero length, select original points by index instead of inventing connectors between isolated taps. This is an explicit extension of upstream $P, whose degenerate normalization can produce NaN.
- An isolated zero-length stroke mixed with a nonzero path can receive no derived samples, as with the reference resampling scheme. Raw ink remains intact. The later grouping stage must keep augmentation dots separate; this matcher does not solve dot association.
- Empty strokes, duplicate/empty stroke IDs, nonfinite coordinates, overflowing bounds, invalid normalized clouds, duplicate template IDs, and incompatible sample counts fail explicitly. A later classifier should handle invalid/unusable groups conservatively, not erase ink.
- Path arithmetic uses stable lengths, with a uniform-scale fallback for overflowing totals or underflowing sample intervals. Matching uses the reference arithmetic on bounded normalized coordinates. Source copying and bounded loops replace upstream's input-array splicing.

`src/config.ts` holds sample count (32), the allowed experimental sample-count ceiling (128), and starting-point search exponent (0.5), plus the explicitly guessed classifier thresholds below. No calibrated music-recognition thresholds exist yet. Do not tune these using held-out test cases and then call those cases an independent accuracy result.

## License and reference checks

Source: <https://depts.washington.edu/acelab/proj/dollar/pdollar.js>, reference last updated July 14, 2018.

Pinned retrieved-source SHA-256: `a36ee4b844171de940cb46dde3f3998a8424c68b570a42ed490992aea2ae1654`.

Copyright (C) 2012 Radu-Daniel Vatavu, Lisa Anthony, and Jacob O. Wobbrock. The complete upstream New BSD notice, citation, and adaptation notes are retained in [`public/third-party-notices.txt`](../public/third-party-notices.txt). Vite copies this file into `dist/`, so deploy it with the rest of the artifact. A WebKit test verifies its contents are served. No upstream demo gesture samples are bundled, and no npm runtime dependency is needed.

Tests include nine distance goldens obtained independently from that pinned upstream implementation: eight comparisons between locally authored shapes and one comparison between the real Pencil fixture's head/stem strokes. Tests run offline against checked-in expected values. These are algorithm-conformance tests, not label predictions. Additional tests cover immutable raw data, normalization, pen-up gaps, articulation variation, degenerate input, range limits, ranked alternatives, and provenance.

## Experimental primitive classification

`classifyPrimitive(strokes, templates)` in `src/recognize/classify.ts` accepts **already-grouped, validated, staff-space `Stroke`s** and an explicit template bank for `noteheadFilled`, `noteheadHollow`, and `stem`. It returns a label or `unknown`, a rejection reason, original bounds/IDs, the full best-per-label candidate list with geometry rejection details, the top-two distance gap, and a covariance-linearity descriptor. It does not supply a model `confidence`, mutate ink, write events, or choose groups. Invalid typed input or incompatible template counts throw; callers must not cast untrusted persisted data into this API.

All policy numbers live in `src/config.ts`. They remain **experimental**, not calibrated probabilities or population-validated acceptance thresholds. The margin and slanted-stem allowances below were chosen using development inputs only:

- Filled/hollow heads share a width range of 0.4–1.8 and height range of 0.3–1.2 staff spaces, with width/height 0.6–2.5.
- Stems must be 1.5–5 staff spaces tall, at most 1.8 spaces wide, with width/height at most 0.65 (roughly a 33-degree straight slant). Initially only single-stroke stems are eligible. On the derived 32-point cloud, the minor/major covariance eigenvalue ratio must be at most 0.02. `cloudLinearityRatio()` returns 0 for collinear geometry and 1 for isotropic/degenerate geometry, including numeric underflow. It uses bounded coordinates, clamps negative roundoff, and does not rotate ink/templates.
- This replaces the old endpoint/raw-path ratio gate: the five development stems had endpoint/travel ratios around 0.38–0.43 despite nearly collinear bodies. Their resampled covariance ratios are approximately 0.0011–0.0087. Retracing a straight stem is now permitted; bends/loops/zigzags still fail line-fit or other geometry checks. A straight scribble/delete gesture or other line-shaped symbol is **not distinguishable from a stem using this feature alone**. Later gestures and musical attachment must supply context.
- The best label must have weighted distance at most 1.5 (unchanged) and a distinct runner-up at least 0.1 farther away (formerly 0.4) at the configured 32 samples. Retune/revalidate if sampling changes. Multiple templates of the same label do not provide that competitor.
- Interrupted groups remain `unknown`, even if their available shape is a perfect match. An empty bank and a bank without a competing label cannot force acceptance.
- Geometry checks do not remove competitors or promote a farther eligible label. If the closest label fails geometry, reject; if an ineligible label is a close runner-up, still reject the ambiguity. Candidates remain available for future contextual reasoning, but no resolver is implemented yet.

Tests cover seed-derived positives (explicitly not held-out data), geometry gates, interruptions, retracing/disconnected strokes, missing alternatives, ties, cutoff neighborhoods, raw immutability, timestamp-order independence, and malformed inputs. The original synthetic boundary fixture retains its **intended** primitive labels: three wide/slanted/retraced examples are now accepted as stems, while eight known labels remain misses. No ground truth is relabeled to fit the classifier. A new synthetic linearity fixture covers retraced/slanted stems and unsupported bent, looped, zigzag, and over-slanted marks.

## Evaluation status and next steps

The **development/regression** comparisons below use manual/oracle primitive groups and the unchanged synthetic seed bank. The candidate policy and all 15 development templates are separately frozen before any evaluation recognition run. It does not measure grouping, pitch, duration, rendering, full-pipeline accuracy, or real iPad latency. Recorded input is not automatically held-out: the existing recording was already inspected during matcher development. No templates or thresholds were selected to improve its results.

`npm run test:fixtures` now prints per-set/provenance confusion cells, including per-primitive rejection reasons, exact label agreement, acceptance coverage, wrong accepts, known-label rejects, and unknown rejection. All ten fixture files validate/round-trip; every original recorded export is unchanged. Synthetic linearity, simple-note assembly, and primitive-grouping fixtures are explicitly assigned to regression, while the two Pencil collections retain development/evaluation roles. No aggregate percentage mixes the safety cases with handwriting.

| Regression set, synthetic seed bank | Before exact agreement | Candidate exact agreement | Accepted groups | Wrong accepts | Known rejects |
| --- | ---: | ---: | ---: | ---: | ---: |
| synthetic-smoke (synthetic) | 3/5 | 4/5 | 3/5 | 0 | 1 |
| personal (recorded) | 0/2 | 1/2 | 1/2 | 0 | 1 |
| classifier-boundaries (synthetic) | 1/12 | 4/12 | 3/12 | 0 | 8 |
| classifier-linearity (synthetic cases) | N/A | 6/6 | 2/6 | 0 | 0 |
| simple-note-assembly (synthetic cases) | N/A | 15/16 | 14/16 | 0 | 1 |
| primitive-grouping (new synthetic cases) | N/A | 7/9 | 5/9 | 0 | 2 |

On the existing smoke inputs, both stems and the hollow head pass; the filled head still fails distance and the interrupted unknown stays ink. On the original real `Quarter-e4`, the stem now passes while the filled head still fails distance. **This is insufficient for enabling canvas recognition.** Zero wrong accepts in this tiny development collection is not evidence of general safety. The real fixture remains primitive-only ground truth with no expected note event. Existing expectations are preserved, including misses.

The user has now supplied corrected development and reserved evaluation recordings, with 15 and 20 individually annotated primitives respectively. Their raw bytes are retained and pinned by SHA-256. `tests/fixtures/roles.ts` keeps automatic classifier regressions, development template work, and reserved evaluation separate; all are still schema-validated. The development adapter refuses evaluation/regression files and excludes each query's own template for leave-one-group-out diagnostics.

The candidate improves development agreement from 3/15 to 9/15 with synthetic seeds, and from 0/15 to 13/15 with leave-one-group-out development templates. The latter accepts three filled heads, all five hollow heads, and all five stems; two filled-head/hollow-head ambiguities remain unknown. There are no wrong accepted labels on these fifteen known-positive development samples. These are different template-bank experiments, not a deployed bank replacement, negative-rejection safety calibration, or independent validation. Same-recording leave-one-group-out was used for development decisions, so it is **not** held-out accuracy.

## Frozen session evaluation protocol and first result

`tests/evaluation/frozen-pencil-v1.ts` pins source SHA-256 hashes (classifier, geometry, $P matching, configuration, decoders, adapter, role/report helpers, runner/config) and both original recording hashes **before the first recognition evaluation**. The candidate bank contains all 15 supported development annotations, with no synthetic seeds or evaluation examples. The source freeze is committed before running the explicit opt-in command:

```sh
npm run test:recognition-eval
```

The runner verifies all hashes before classification and prints every confusion/rejection and per-annotation decision. A changed model fails the guard; reproduce from the frozen commit rather than rewriting hashes after seeing results. Normal unit/fixture tests and CI do not run this evaluation command. The integrity test deliberately has no accuracy pass/fail target selected after observing scores.

At freeze time, evaluation has been used only for schema, annotations, exact-copy/source-overlap checks, and byte integrity, not recognition results. Its five unknowns are not calibration negatives. A first evaluation may be reported only for that pre-frozen candidate; after results are seen, this collection cannot establish fresh independent accuracy for a model tuned against those results.

The first run, after committing freeze `558fa7d`, correctly accepts **10/15 known primitives** (filled heads 2/5, hollow heads 4/5, stems 4/5), rejects five known primitives, and correctly rejects **5/5 unknowns**, with no wrong accepted labels in this small collection. Overall exact label/rejection agreement is 15/20, including the five unknowns; accepted coverage is 10/20. There is no prior independent score to compare against. See the [full result, all decisions, limitations, and reproduction instructions](recognition-evaluations/pencil-v1.md). No candidate changes were made after seeing results. The evaluation is now observed, not an unseen tuning reserve. See the [fixture collection and split protocol](../fixtures/README.md). Pure [oracle-label assembly](assembly.md) and [observation-clock grouping](grouping.md) now exist; a live coordinator, validated event commands/persistence, and VexFlow integration follow. Synthetic group → classify → assemble yields 6/7 expected events without oracle primitive inputs, versus isolated assembly's 7/7 with oracle labels; the known C4-quarter classifier rejection is not hidden. Neither measures recorded/native timing or end-to-end app accuracy. Added assembly/grouping settings and fixture assignments change shared pinned files, so the frozen v1 runner now intentionally rejects this checkout before classification. Reproduce from a separate worktree at `558fa7d`; do not change the frozen manifest. Evaluate $Q behind the same interface only after establishing a useful baseline and measuring actual iPad latency. No iPad performance or accuracy is claimed by these unit tests.

HOMUS use remains gated on clear data reuse terms and a reviewed mapping from its whole-symbol labels to our primitive pipeline. No corpus, neural model, browser inference runtime, or remote recognition service is added here.
