# Recorded ink fixtures

Fixtures pair original staff-space ink with **manually entered expectations**. They are not recognition output or ordinary sketch backups. The recorder and loader do not run a recognizer yet.

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
npm run test:fixtures   # recursive validation, round-trip tests, visible inventory
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

Human-facing stroke numbers are converted to original string IDs at export. The current decoder accepts octaves 0–9. Fixture text fields are limited to 2,000 characters each; JSON is limited to 10 MiB, 10,000 strokes, and 1,000,000 points. Export rejects an oversized fixture rather than truncating raw ink or producing a file the loader cannot read. Limits live in `src/config.ts`.

## Current inventory and accuracy

`synthetic/` contains **three hand-authored smoke tests**, not real handwriting:

- Filled head + stem, with an expected C4 quarter note.
- Hollow head + stem, with an expected E4 half note.
- An ambiguous/unsupported mark that stays unknown, including interrupted ink and decreasing timestamps.

`recorded/quarter-e4.json` is the first real Pencil fixture, exported by the user and retained byte-for-byte. Its original name is `Quarter-e4`, set `personal`, provenance `recorded`. It contains two complete strokes (1,091 head samples and 344 stem samples), manually labeled `noteheadFilled` and `stem`. Its head lies near the bottom staff line (E4), but `expected.events` is empty: this is **primitive-only ground truth**, not yet an assertion of an E4 quarter-note event. No event annotation has been inferred from the filename. The raw ink includes 331 timestamp decreases, preserved unchanged.

| Set | Provenance | Files | Expected primitives |
| --- | --- | ---: | --- |
| synthetic-smoke | synthetic | 3 | noteheadFilled: 1; noteheadHollow: 1; stem: 2; unknown: 1 |
| personal | recorded | 1 | noteheadFilled: 1; stem: 1 |

Total expected primitive counts: `noteheadFilled: 2`, `noteheadHollow: 1`, `stem: 3`, `unknown: 1`.

**Recognition accuracy: N/A before and after this change.** The current suite validates schema, source references, and lossless serialization only. Establish per-primitive and per-set recognition accuracy in milestone 2, keeping recorded and synthetic results separate. Do not report these schema checks as recognition successes.
