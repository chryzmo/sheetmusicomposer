# Simple-note assembly (milestone 2)

`assembleSimpleNotes(strokes, primitives)` in `src/recognize/assemble.ts` is a pure, DOM-free stage for **one finished measure**. It consumes original staff-space `Stroke`s plus an explicit partition into labeled primitives. `PrimitiveClassification` results fit structurally; the caller retains their full rankings/rejection diagnostics. The function does not choose groups, classify shapes, interpret gestures, modify ink, or write to the model.

## Candidates, not committed events

- Filled head + one uniquely attached stem → quarter note.
- Hollow head + one uniquely attached stem → half note.
- Isolated hollow head → whole note, only when no nearby competing ink blocks it.
- Pitch uses the center of the head's **original bounds** and `pitchAtStaffY()`, including ledger lines and its lower-pitch midpoint rule. Out-of-domain pitches remain unresolved.
- Notes are ordered left-to-right. Overlapping head columns are withheld; chords/multiple voices are not interpreted as sequential notes.
- Candidates have `dots: 0`, `accidental: null`, source stroke IDs in original capture order, head centers, and input primitive indices (head, then optional stem). Those indices let the caller retrieve untouched classification evidence.
- Candidates deliberately have **no event ID or confidence** and are not `NoteEvent`s. No conversion from matcher distances, margins, or covariance descriptors to an evidence/probability score is invented. Validated commands, event evidence policy, persistence/migration, and undo integration remain separate work.

Every source stroke must occur exactly once in the input groups, including `unknown`. Missing, duplicate, empty, or foreign references fail explicitly, as do invalid labels, empty/invalid strokes, nonfinite/overflowing geometry, or work-limit violations. This internal typed API is not a file decoder: validate persisted/fixture samples first. Raw timestamps, pressure, and tilt are not used for geometry or rewritten.

The result partitions all source ink into note references and `unresolvedStrokeIds`; unresolved groups also carry source IDs, input indices, and explicit rejection reasons. Recognition never deletes raw strokes, including those referenced by a candidate.

## Attachment and conservative rejection

The following **guesses**, not calibrated handwriting thresholds, live in `src/config.ts`:

| Setting | Initial value | Meaning |
| --- | ---: | --- |
| `assemblyTipMaxGap` | 0.25 staff spaces | Maximum Euclidean distance from a stem's geometric tip to head bounds; inclusive. |
| `assemblyInkClearance` | 0.5 staff spaces | Inclusive axis-wise clearance around each head/stem's original bounds; any other primitive inside either guard blocks the note. |
| `assemblyHeadColumnClearance` | 0.25 staff spaces | Head columns separated by this gap or less are withheld, independently of vertical distance. |
| `assemblyMaxPrimitives` | 256 | Work cap for quadratic attachment/blocker comparisons within one finished measure. Existing source-stroke/point limits also apply. |

Stem tips come from the top/bottom raw geometric extrema (the midpoint of the x span when several samples share an extremum). They are not first/last samples, normalized template positions, or invented bounding-box corners. Reversal, timestamp decreases, and retracing therefore do not hide an end. The assembler trusts supplied labels rather than re-running classifier geometry/shape gates; horizontal/point-like degeneracies are withheld.

All plausible tip/head links are considered. A head must have exactly one link to a stem that also has exactly one link. Two candidate stems, a stem shared by two heads, or both ends near the same head are ambiguous: **do not choose the closest and do not downgrade a rejected half note to whole**.

Other nearby ink may be a flag, dot, accidental, beam, rest, unfinished stroke, or correction gesture. Withhold the whole candidate rather than silently treating a flagged/dotted/accidental-bearing note as an unmodified quarter/half/whole. This includes interrupted or otherwise rejected groups. An unpaired filled head, unused stem, and unsupported mark remain ink. Nearby legitimate notes can be over-rejected; future context/editing needs to address that rather than presenting these guesses as calibrated acceptance.

These geometric guards cannot establish musical intent in all cases. For example, a missing or sufficiently distant stem can be indistinguishable from an isolated whole-note head; a mislabeled barline/delete stroke can be indistinguishable from a stem. Ledger pitches are supported mathematically, but a separately drawn unrecognized ledger-line stroke is still unsupported extra ink and can block the note; ledger-symbol handling is not implemented. Oracle/caller label mistakes, unusual spacing, stray extrema, and gestures remain limitations. Duration totals and alternative-reading search belong to milestone 5, not this function.

## Tests and fixture interpretation

Unit tests cover whole/half/quarter candidates, upward/downward/slanted/retraced stems, multi-stroke heads, ledger/midpoint pitches, source ordering, immutable raw metadata, conflict graphs, overlapping columns, actual versus invented tips, unsupported/near-miss/interrupted ink, inclusive cutoff boundaries, pitch limits, invalid inputs, and bounded work.

The fixture suite explicitly selects **three synthetic fixtures with exhaustive simple-note truth**: the existing C4-quarter and E4-half smoke cases, plus `simple-note-assembly.json`. It reports **7/7 expected events** using oracle primitive labels. The new fixture adds five notes, shared-stem ambiguity, blocked whole-note fallback, an unused stem, an interrupted head, and decreasing raw timestamps. It intentionally contains more duration than its nominal time signature: it tests geometry/assembly, not measure validity/resolution. One synthetic half-note smoke also passes through the actual classifier into assembly to check the API boundary without changing evidence.

This is **not automatic grouping, classifier accuracy, recorded-handwriting event accuracy, or end-to-end recognition**. An empty expected-event list on the real primitive-only recordings does not mean "expect no notes". Neither Pencil development nor evaluation handwriting is assembled/scored here, and no real event annotation is inferred from a filename. Existing primitive regression results are unchanged; the new fixture's separate classifier report is 15/16 exact label agreement, with its interrupted hollow head rejected and no wrong accepts. Synthetic authored shapes do not establish general handwriting performance.

## Frozen evaluation and next integration

No primitive classifier thresholds, template bank, original recorded bytes, stored frozen hashes, or first-run evaluation decisions changed. However, the added assembly settings in shared `src/config.ts` and explicit new fixture assignment in `tests/fixtures/roles.ts` change two pinned file hashes. **The old v1 evaluation runner intentionally refuses this checkout before classification.** Do not update its manifest to bypass the guard; reproduce from a separate worktree at `558fa7d`, as described in the [frozen result](recognition-evaluations/pencil-v1.md).

Next: automatic stroke grouping (using observation timing rather than assuming raw timestamps are monotonic), an explicit reviewed runtime template bank, validated event commands/persistence, and opt-in VexFlow display. Recognition is not attached to the canvas. Native iPad/Safari performance, unknown-ink rendering, alignment, correction/undo, and save/reload acceptance must be tested when integration exists.
