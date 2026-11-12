# Recorded ink fixtures

Fixtures pair original staff-space ink with **manually entered expectations**. They are not recognition output or ordinary sketch backups. The recorder and loader do not run recognition. A separate development test harness now evaluates the experimental primitive classifier on manually annotated groups; it does not itself evaluate automatic grouping. Separate suites now test grouping with authored synthetic observation clocks/regions, isolated assembly with oracle primitive labels, and their composition on exhaustive synthetic event truth—not recorded-handwriting/native-timing event accuracy.

## Recording on the iPad

1. Download a normal backup if you want to keep the current sketch, then use **New** for a small sample. Draw **one measure** on the current staff. There are no barlines/measure selection yet: the entire current page is exported, including ink outside the staff.
2. Tap **Record fixture**. It freezes a copy of the current ink and finalizes any active stroke as interrupted. Recording never clears or replaces the sketch. The preview shows stroke numbers at their starting points; the list follows drawing order. Overlapping number labels can be disambiguated using the list and the order you drew them.
3. Enter a descriptive unique **Name** and a **Fixture set**, for example `pencil-samples`. Select the time signature. Notes can describe uncertainty, writing style, and device/OS details; avoid personal identifiers.
4. Label the expected primitives. A row groups one or more strokes as one primitive. **Stroke numbers** are comma-separated, 1-based drawing-order numbers, e.g. `1,2`. The initial row labels everything `unknown`; change it or replace it with smaller groups. Use **Add primitive** and **Remove** as needed. A stroke cannot belong to two primitive groups.
5. Optionally add expected notes/rests in **musical order** with **Add note/rest**. Enter the source stroke numbers for each event, including stems, flags, dots, and accidentals that produced it. Pitch is a written letter/octave (`C4` = middle C), with accidentals in their own field; rests have no pitch/accidental. Events support whole through sixteenth durations and 0–2 dots. A stroke cannot belong to two events.
6. Every stroke must be covered by a primitive or event. The same source stroke may appear once at each level (e.g. a head primitive and its assembled note). Primitive-only fixtures and event-only fixtures are allowed. Label ambiguous/unsupported ink `unknown`, with no event for that mark. Partial measures are allowed; totals are **not** checked against the time signature yet.
7. Tap **Download fixture**, then verify that the iPad download/Files UI saved the JSON file. Close the recorder to continue drawing. Closing/Escape discards annotations; they are not autosaved. A fixture download does not replace your normal backup workflow, and **Restore backup** intentionally rejects fixture files.

## Adding a downloaded file

Transfer the JSON to your development machine using Files or another method you trust. Review it, remove identifying notes, and copy it into `fixtures/recorded/`. Keep the original raw samples, IDs, order, completion, timestamps, pressure, and tilt unchanged; edit only expectations/metadata when correcting a label. `.gitattributes` disables line-ending normalization for recorded JSON, preserving original export bytes while allowing CRLF-aware whitespace checks and normal text diffs.

```sh
npm run test:fixtures   # validation/round-trips, inventory, development classifier report
npm test               # includes the reviewed fixtures as well as unit tests
```

Files can be nested by set. Names must be unique across the whole tree. Every `.json` file under `fixtures/` is validated; unknown formats/versions, invalid ink, unknown/repeated references, and uncovered strokes fail the test suite with the file path. Symbol labels and set names are manual ground truth: schema validation does not prove they are musically correct. Get a second review of ambiguous examples rather than silently relabeling them to match a recognizer.

## Version 1 format

- `format: "sheetmusicomposer-fixture"`, `version: 1` (separate from sketch backup format).
- `name`, `set`, `notes`, and `provenance` (`recorded` for browser exports, `synthetic` for hand-authored examples). Provenance is descriptive metadata, not hardware authentication.
- `staff`: units `staff-space`, five line positions `[0,1,2,3,4]` from top to bottom, finite positive width, treble clef, and `4/4`, `3/4`, `2/4`, or `6/8`. One unit is the distance between staff lines. Pan, zoom, DPR, and canvas pixel size do not affect the file.
- `document.strokes`: the same validated raw ink shape as a sketch backup. Finite nonnegative timestamps can decrease or equal zero; samples are never sorted or clamped.
- `expected.primitives`: `{label, strokeIds}` groups. Allowed labels: `noteheadFilled`, `noteheadHollow`, `stem`, `flag`, `beam`, `restBlock`, `restHook`, `quarterRest`, `dot`, `sharp`, `flat`, `natural`, `unknown`.
- `expected.events`: `{kind, duration, dots, strokeIds}`; notes additionally include `pitch: {step, octave}` and `accidental` (`null`, `sharp`, `flat`, `natural`). Rest objects have neither pitch nor accidental. Array order is musical order, not an inferred x-coordinate or timestamp sort.

Human-facing stroke numbers are converted to original string IDs at export. The current decoder accepts octaves 0–9. Fixture documents remain v1 ink-only even when the app sketch uses musical file version 2. Recording exports only the original strokes; stored model events never become expected ground truth automatically. Fixture text fields are limited to 2,000 characters each; JSON is limited to 10 MiB, 10,000 strokes, and 1,000,000 points. Export rejects an oversized fixture rather than truncating raw ink or producing a file the loader cannot read. Limits live in `src/config.ts`.

## Current inventory and accuracy

Grouping tests pass raw synthetic strokes plus an explicitly authored observation schedule (100-ms starts, 40-ms durations, one region), not expected primitive labels, into `groupStrokes()`. They match 29/29 expected groups (4/4 exact fixture partitions). On the three fixtures with exhaustive simple-note event truth, group → classify → assemble yields 6/7 exact expected events, with no extra/wrong emitted candidates; the original C4-quarter classifier miss remains a miss. This differs from isolated assembly's 7/7 with oracle labels. No raw Pencil timestamps are converted into arrival clocks, no recorded handwriting is temporally grouped, and an empty event array is not inferred to mean no notes. See [the grouping contract](../docs/grouping.md).

`synthetic/` contains **three hand-authored smoke tests, two classifier suites, one simple-note assembly suite, and one primitive-grouping suite**, not real handwriting:

- Filled head + stem, with an expected C4 quarter note.
- Hollow head + stem, with an expected E4 half note.
- An ambiguous/unsupported mark that stays unknown, including interrupted ink and decreasing timestamps.
- `classifier-boundaries.json`: 12 groups checking experimental size/aspect, multi-stroke, and interruption gates. The original policy rejected all eleven intended known labels; the candidate now accepts its wide/slanted/retraced stems. Labels are unchanged; rejection is **not** counted as correct recognition of a known label.
- `classifier-linearity.json`: retraced/slanted stems plus four unsupported bent, looped, zigzag, and over-slanted marks, exercising covariance-linearity and stem bounds.
- `simple-note-assembly.json`: five expected whole/half/quarter notes plus shared-stem ambiguity, nearby unsupported ink, an unused stem, and an interrupted head. Event truth is exhaustive for this authored fixture; it is deliberately overfull to isolate geometry from later measure resolution. Together with the first two smoke fixtures, oracle-label assembly matches 7/7 expected events. See [assembly rules/limitations](../docs/assembly.md).

- `primitive-grouping.json`: split outline/inset-fill group truth, separate stem/dot/neighboring heads, interrupted ink, and unsupported connected/horizontal shapes. It has primitive-only expectations; the corresponding observation schedule is authored in the grouping tests, not embedded/recovered as native capture metadata.

`recorded/quarter-e4.json` is the first real Pencil fixture, exported by the user and retained byte-for-byte. Its original name is `Quarter-e4`, set `personal`, provenance `recorded`. It contains two complete strokes (1,091 head samples and 344 stem samples), manually labeled `noteheadFilled` and `stem`. Its head lies near the bottom staff line (E4), but `expected.events` is empty: this is **primitive-only ground truth**, not yet an assertion of an E4 quarter-note event. No event annotation has been inferred from the filename. The raw ink includes 331 timestamp decreases, preserved unchanged.

| Set | Provenance | Files | Expected primitives |
| --- | --- | ---: | --- |
| synthetic-smoke | synthetic | 3 | noteheadFilled: 1; noteheadHollow: 1; stem: 2; unknown: 1 |
| personal | recorded | 1 | noteheadFilled: 1; stem: 1 |
| classifier-boundaries | synthetic | 1 | noteheadHollow: 4; stem: 7; unknown: 1 |
| classifier-linearity | synthetic | 1 | stem: 2; unknown: 4 |
| simple-note-assembly | synthetic | 1 | noteheadFilled: 3; noteheadHollow: 6; stem: 6; unknown: 1 |
| primitive-grouping | synthetic | 1 | noteheadFilled: 1; noteheadHollow: 4; stem: 1; dot: 1; unknown: 2 |
| runtime-review-self-derived | synthetic, template-derived | 1 | noteheadFilled: 1; noteheadHollow: 1; stem: 1; unknown: 1 |
| Pencil-template-dev-1 | recorded | 1 | noteheadFilled: 5; noteheadHollow: 5; stem: 5 |
| Pencil-eval-session-2 | recorded, frozen evaluation | 1 | noteheadFilled: 5; noteheadHollow: 5; stem: 5; unknown: 5 |

- `recorded/sample-fail.json` (`Sample-mixed-first-e4-rejected`, set `personal`, regression role): one real Pencil measure of six expected notes (E4 quarter, B4 whole, G4 half, E4 quarter, G4 half, B4 whole). With the `pencil-dev-v1` bank and singleton grouping, five notes are proposed correctly; the first E4's filled head is rejected as unknown (hollow 1.31 vs filled 1.39 distance), so those two strokes stay unresolved ink. This miss is a documented baseline, not tuned away. Raw ink is unchanged from the export; only the name, notes, and one primitive label (stroke 9 is a stem) were edited.

- `runtime-review.json`: **synthetic template-derived/self-similar** review regression (quarter E4 + whole E4 + unsupported tap), not independent handwriting. Deliberately decreasing sample times and an overfull measure exercise raw preservation/explicit review, not native timing or duration resolution. See [runtime bank/review evidence](../docs/runtime-review.md).

Total: 11 files, with expected primitive counts `noteheadFilled: 17`, `noteheadHollow: 26`, `stem: 30`, `dot: 1`, `unknown: 15`. Inventory counts include evaluation; automatic classification reports do not score it.

Schema validation proves only source-reference integrity and lossless serialization. Separately, the experimental classifier report evaluates **oracle/manual groups**, not automatically recognized notes. The assembly suite separately uses explicit synthetic event truth and oracle primitive labels; it never treats empty event lists on real primitive-only recordings as an assertion of no notes. A frozen session-evaluation command is opt-in and separate from these development/regression results. It prints per-set/provenance confusion cells, exact label agreement, acceptance coverage, wrong accepts, rejected known labels, and unknown rejection. It is a development regression baseline, not a held-out benchmark. Existing annotations and original files are unchanged.

| Regression set | Previous agreement | Candidate agreement | Accepted | Wrong accepts | Known rejects |
| --- | ---: | ---: | ---: | ---: | ---: |
| synthetic-smoke | 3/5 | 4/5 | 3/5 | 0 | 1 |
| personal (recorded) | 0/2 | 1/2 | 1/2 | 0 | 1 |
| classifier-boundaries | 1/12 | 4/12 | 3/12 | 0 | 8 |
| classifier-linearity | new cases | 6/6 | 2/6 | 0 | 0 |
| simple-note-assembly | existing cases | 15/16 | 14/16 | 0 | 1 |
| primitive-grouping | new cases | 7/9 | 5/9 | 0 | 2 |
| runtime-review-self-derived | new self-similar cases | 4/4 | 3/4 | 0 | 0 |

This historical candidate table uses the unchanged **synthetic reference bank**. New named runtime-bank diagnostics are reported separately in [runtime review](../docs/runtime-review.md), including its lower coverage on grouping/smoke cases. Neither protocol is independent handwriting accuracy.

The smoke stems and hollow head now pass; its filled head still fails distance and its interrupted unknown is rejected. The original real Pencil stem now passes while its filled head still fails distance. The boundary suite's three newly supported stems retain their original intended labels; its eight remaining known-label misses are still reported honestly. Do not average these sets together or infer general safety from zero wrong accepts in a tiny collection. The classifier remains disconnected from the canvas. See [the recognition design](../docs/recognition.md).

## Development and frozen evaluation recordings

The user authorized repository distribution of these corrected exports. They are copied byte-for-byte, with original names, sets, labels, raw samples, and CRLF endings retained:

| Original export | Repository path | Role | Annotation inventory |
| --- | --- | --- | --- |
| `Dev.json` | `recorded/development/pencil-dev-1.json` | Development | 15 one-stroke primitives, five of each supported label |
| `Evals.json` | `recorded/evaluation/pencil-eval-1.json` | Evaluation (first frozen candidate scored) | 20 one-stroke primitives, five of each supported label plus five unknowns |

Both have empty expected-event lists and blank notes. The earlier, incorrectly grouped exports are **not** imported. Tests pin the new originals' SHA-256 hashes:

- Development: `15ec56101a055df9280e8e03bb50b4414b50c09316a0ce50629dcd0de60736b9`
- Evaluation: `53abc2f6face9427fa206f39e6867199583eabc866cc0203c3908df000f87f2c`

`tests/fixtures/roles.ts` explicitly assigns every repository fixture to `regression`, `development`, or `evaluation`. New files need a deliberate assignment. All files are schema-validated, inventoried, and round-tripped. The automatic classifier regression report selects only the six regression files. The development template adapter rejects regression/evaluation sources; its leave-one-group-out diagnostic removes the query's own template and does not silently add synthetic seeds. Duplicate recordings/source IDs are rejected. Source IDs and exact point arrays do not overlap between the two new exports; this checks simple copying, not independent proof of session separation or dataset adequacy.

### Development diagnostics and candidate policy

| Development experiment | Previous exact agreement | Candidate agreement/acceptance | Candidate details |
| --- | ---: | ---: | --- |
| Synthetic seed bank | 3/15 | 9/15 | Filled: 2/5; hollow: 3/5; stems: 4/5; six distance rejects |
| Leave-one-group-out development templates | 0/15 | 13/15 | Filled: 3/5; hollow: 5/5; stems: 5/5; two ambiguous filled heads remain unknown |

These are **different template-bank experiments**, not a replacement of the synthetic runtime bank. Both have zero wrong accepts on this small positive-only development collection, which does not calibrate negative-rejection safety. Same-recording leave-one-group-out was used for development decisions and is not session-held-out accuracy. No self-match is counted as success. The raw exports and all original labels remain unchanged; **no redrawing is needed**.

The candidate replaces raw endpoint/travel straightness with a minor/major covariance ratio on derived clouds, permits observed slant, and lowers the top-two margin from 0.4 to 0.1 while retaining the 1.5 distance cutoff. Its full policy and source hashes are frozen before recognition evaluation in `tests/evaluation/frozen-pencil-v1.ts`. See [the design and caveats](../docs/recognition.md).

Run `npm run test:recognition-eval` explicitly to evaluate the frozen 15-template development bank. The command is excluded from ordinary tests/CI, verifies model/data/runner hashes before scoring, and refuses changed sources. Do not rewrite those hashes after seeing results; use the frozen commit to reproduce that experiment. At freeze time the evaluation recording has only schema/annotation/integrity/overlap checks, not recognition results, and its five unknowns are not calibration negatives. After the first evaluation, tuning against its results would require new independent data to claim fresh held-out accuracy.

The first recognition evaluation has now been run after committing freeze `558fa7d`: **10/15 known symbols correctly accepted, five known symbols rejected, all 5/5 unknown marks rejected, zero wrong accepted labels in this small collection**. Overall exact label/rejection agreement is 15/20; this is not full-pipeline or population accuracy. No predictor changes followed the result. See [the frozen result and reproduction protocol](../docs/recognition-evaluations/pencil-v1.md). This collection is now observed, not an unseen reserve for future tuning.

## Collecting additional recordings

For future collections, use the recorder workflow above and keep these roles separate:

1. **Template/development collection:** a few examples each of filled heads, hollow heads, and stems, in normal staff-space sizes and your usual writing styles. Annotate each primitive separately, including multiple strokes if that is how you draw it. Give the set a clear development name such as `pencil-template-dev`. No musical events are required for isolated primitives.
2. **Separate evaluation session:** draw fresh examples later, without copying the training samples, plus some unsupported/ambiguous marks. Use a different set such as `pencil-eval-session-2`, preserve truthful primitive labels (use `unknown` only for genuinely ambiguous ink), and keep this session out of template selection and threshold tuning. An inspected/tuned-on evaluation set becomes development data; reserve new recordings for a subsequent independent evaluation.

These exports are fixture data, not a new personal-template persistence format. Review any identifying notes before sharing/committing, and explicitly decide which recordings may be distributed in the repository. A useful dataset and a reviewed calibration step are still required; these instructions do not establish a sample-size or accuracy guarantee.
