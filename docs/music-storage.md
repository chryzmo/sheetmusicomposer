# Validated music, commands, and sketch format 2

This milestone-2 step adds **structural musical validation, undoable score updates, and persistence alongside raw ink**. It does not convert recognizer candidates into committed events, select templates/evidence policy, connect the pipeline to the canvas, or render notation.

## Document and validation

`SketchDocument` retains original `strokes` and optionally has ordered `measures`. Absence means legacy ink-only data; an explicitly present empty array is an empty musical document. Unassigned strokes are valid and remain ink, alongside strokes referenced by events/unresolved lists.

`decodeMeasures(value, validatedStrokes)` in `src/model/validate-music.ts` validates and copies musical trees:

- Unique, nonblank measure IDs and globally unique event IDs (at most 256 UTF-16 code units each).
- Treble clef, supported time signatures, ordered note/rest events, shared duration/accidental vocabulary, C0–B9 written pitches, integral 0–2 dots.
- Explicit finite `confidence` in [0,1]. Missing/nonfinite/out-of-range scores fail; no score, ID, accidental default, or pitch is fabricated. A bounded evidence score is **not a calibrated probability**, and structural validation cannot establish recognition correctness/calibration.
- Every event has nonempty references to known **complete** source strokes. Unknown/repeated references fail globally across all events, measures, and unresolved lists. Interrupted strokes may remain unresolved, never consumed as events.
- Rests cannot contain pitch/accidental fields. Notes require an explicit accidental (`null` means none).
- Limits: 1,000 measures; event/reference arrays also bounded by the existing 10,000-stroke cap. All limits live in `src/config.ts`.

Array order is preserved as musical order; the decoder does not sort by raw timestamps/coordinates or check duration totals. Empty/partial/overfull measures are allowed pending milestone-5 resolution. Support for rests/dots/accidentals in the stored vocabulary is not a claim that their recognizers exist. Raw point validation still belongs to the sketch decoder; the music decoder expects already validated ink.

## Commands and stale results

`replaceMeasuresCommand(before, proposedMeasures)` validates/copies the proposal at construction and produces one undoable score update. It preserves the original stroke array and never deletes or rewrites ink. IDs and bounded evidence must be explicitly supplied by a caller with a separately reviewed policy. `SimpleNoteCandidate` has neither ID nor confidence and is **not** accepted automatically. The separate [opt-in reviewed boundary](runtime-review.md) now defines an explicitly non-probabilistic distance-headroom heuristic and requires selected candidates/caller IDs; it is not calibrated certainty or automatic recognition.

Apply requires the exact immutable `before` document object; Undo requires its exact resulting snapshot. A stale async result cannot replace a newer document, even one with equal-looking data. Validation/apply/revert failures leave history stacks unchanged. Undo returning to the exact original snapshot legitimately permits the matching command again. Callers must still guard active pen contact, template/policy generations, and asynchronous scheduling; document identity covers committed state only.

Stroke commands now retain exact before/after snapshots for Undo/Redo so mixed score/ink/New/Restore history preserves those guards. Incoming raw samples are still copied once at stroke-command construction. New ink invalidates **only the saved note/rest events it comes near**: an event is touched when the new stroke's bounding box reaches within `inkInvalidationMargin` (1.5 staff spaces, a guess to tune by hand) of the event's own ink, or of a note's written head position, which differs from its ink once the pitch was corrected (`src/edit/invalidation.ts`). A long stroke touches every event its box reaches; ink elsewhere leaves the music untouched, with no change to the measures. Each touched event's original references move to the same measure's unresolved list in capture order, the new stroke stays unassigned ink, and empty measure metadata is retained. Undo restores the previous music and raw ink atomically; Redo invalidates it again. Even a stray/interrupted new stroke does this. Pan/zoom/Fit do not alter the document or invalidate music.

New clears music as well as ink, including measure-only documents. Restore retains both as a single undo step. Neither command creates an archive; backups remain necessary for independent retention. All commands assume the existing immutable document contract; do not mutate document objects outside commands.

## Explicit file compatibility

Both backups and IndexedDB payloads use format `sheetmusicomposer`:

```text
version 1: document = { strokes }
version 2: document = { strokes, measures }
```

- Existing v1 files decode without adding measures or modifying/reordering any samples. Ink-only documents continue to write v1; no automatic storage upgrade or rewrite is performed at load.
- Presence of `measures`, including `[]`, selects v2. V2 requires a validated measure array. A v1 envelope containing musical measures fails instead of silently stripping them. Unknown file versions still fail closed.
- Adding explicit music is the opt-in v1 → v2 transition; Undo can restore the exact ink-only snapshot. New intentionally writes a blank v1 document again. This is not data loss by an implicit migration: these are explicit reversible user/command changes.
- IndexedDB **database version remains 1**, with the same store/key and `{ revision, sketch }` record. The file payload version is separate. Existing atomic read/check/write, cross-tab revision checks, validation before save, serialized autosave, quota handling, and fail-closed loading apply to both payloads.
- Older builds that only support file v1 reject v2 rather than erase music. Their existing read-before-save validation/revision guards also prevent overwriting a newer musical draft. Keep independent backups before changing builds.
- Downloads remain complete, not truncated; the existing 10-MiB import cap and oversize warning still apply to the full file, including music.

The UI still shows original ink only. Loading/restoring musical data displays an explicit notice explaining that notation is not rendered and new drawing next to an event invalidates it (Undo restores it). There is no new recognition/score-acceptance control in this step.

Fixture files remain `sheetmusicomposer-fixture` v1 and ink-only. Recording from a musical document exports only its original strokes; expected labels/events are entered manually. **Saved recognition/model events are never copied into fixture ground truth.** Existing recorded exports/labels and recognition scores are unchanged.

Neither v1 nor this score-only v2 format contains grouping arrival clocks, regions, template banks, pending candidates, undo history, view state, or full classifier diagnostics. Do not reconstruct arrival clocks from raw sample `t`; collecting/persisting/reloading real observation metadata needs a separate deliberate clock-domain/schema policy before live grouping integration.

## Validation and next work

Unit tests cover vocabulary/domain boundaries, evidence/dot/reference limits, interruption, global uniqueness/disjointness, independent snapshots, version compatibility, malformed input, stale command rejection, atomic mixed undo/redo, and ink-driven score invalidation. WebKit tests cover v2 Restore/IndexedDB/reload/backup, invalid imports/stored payloads, New including measure-only documents, invalidation/Undo/Redo, and fixture-ground-truth isolation. These use authored schema data, not claimed handwriting recognition.

No primitive recognition, grouping, or assembly algorithm/policy changed. The frozen v1 evaluation manifest/first results remain unchanged; shared config/role files and the extended sketch/fixture decoders now differ from that freeze, so replay in the documented worktree at `558fa7d` rather than updating hashes. No new evaluation recognition is run.

A [named experimental runtime-ready bank and explicit reviewed-selection/evidence boundary](runtime-review.md) now exist. Its full diagnostics/policy metadata remain transient, not persisted by v2. [Opt-in VexFlow review display/confirmation](notation-review.md) now uses that boundary; the main canvas still shows original ink, and preview re-reads raw source rather than displaying stored score corrections. Next native acceptance and the live observation/recognition coordinator. Real-iPad acceptance remains necessary for musical backup behavior, draw/undo invalidation, unknown-ink visibility, responsiveness, alignment, active-contact timing, and safe reload when those paths are used. Native rendering/recognition performance remains untested.
