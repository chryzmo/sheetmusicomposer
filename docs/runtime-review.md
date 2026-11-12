# Runtime-ready bank and explicit musical review

This milestone-2 infrastructure now powers the [opt-in, human-reviewed VexFlow preview](notation-review.md), not automatic canvas recognition. The main canvas keeps original ink. No live timing coordinator, personal-template store, or playback is enabled.

## Explicit bank decision: `pencil-dev-v1`

`createRuntimeBank()` in `src/recognize/runtime-bank.ts` returns **all 15** approved development primitive templates: five filled heads, five hollow heads, five stems. The source is exactly `fixtures/recorded/development/pencil-dev-1.json`, SHA-256 `15ec56101a055df9280e8e03bb50b4414b50c09316a0ce50629dcd0de60736b9`.

The decision is to make the already development-selected, pre-evaluation 15-template bank available as a **named experimental option for forthcoming review**, not to select/merge templates after inspecting evaluation failures. It is single-writer data, not universal handwriting coverage, device-trained personal data, or a guaranteed improvement over synthetic seeds. No evaluation or original `Quarter-e4` strokes become templates. No HOMUS data, network loading, dependency, or inference runtime is added.

`runtime-seeds.json` contains only derived normalized 32-point clouds, original bounds/source IDs, labels, and source metadata. It does not copy raw pressure/tilt/timestamp streams. Original recordings remain byte-for-byte unchanged. All template IDs, vector coordinates, original bounds, and source IDs equal the development adapter's output exactly. **Only provenance kind changes from `user` to `builtin`**, because these would be packaged curated seeds, not the current device owner's templates. This does not affect ranking arithmetic or lexical ties. The asset is now bundled into the lazy same-origin review worker, not loaded as startup training data. The opt-in dialog names the bank visibly.

The three synthetic `createBuiltinTemplates()` reference seeds and their existing reports stay separate. No hidden merge or user-priority behavior is introduced. Personal templates remain a later milestone.

Generate/check explicitly (never during normal app startup/build):

```sh
node scripts/build-runtime-bank.mjs          # writes derived asset only
node scripts/build-runtime-bank.mjs --check # byte-exact reproducibility check
```

The generator has one fixed development path, checks its pinned raw-byte hash, and uses the role-guarded development adapter. It never globs/selects samples or scores recognition. The decoder rejects incompatible identity/version/sampling/provenance, missing/duplicate samples/references, unsupported/unbalanced classes, and invalid cloud numbers/counts/bounds. It returns independent copies. This is not a general user-template import format.

## Preview boundary

`prepareMusicReview(validatedImmutableDocument, runtimeBank, optionalPartition)` is pure and DOM-free. It classifies a complete source partition and assembles whole/half/quarter candidates. It carries the full primitive rankings, distances, margins, geometric diagnostics, template provenance, and assembly rejection reasons. It never generates event IDs or modifies a document.

- Explicit groups must cover every raw stroke exactly once, without empty/foreign/duplicate groups. They can come from finished grouping output for a **single measure**, but caller must check region/readiness/active-contact policy. Capture order is canonicalized without changing raw sample order.
- Without groups, **each stroke is its own group**, explicitly marked `singleton-fallback`. Old backups lack arrival clocks; no clocks are fabricated from `t`, and no fragments are automatically joined. This fallback can miss multi-stroke symbols; it does not establish grouping accuracy.
- Pages with more than one stored measure are refused, not flattened. Current scope is one-measure page review only. Empty/partial/overfull music remains valid pending later duration resolution.
- Processing refuses more than 256 primitives or 50,000 raw points **without truncation**. These are work caps, not acceptance/accuracy thresholds. Ink remains intact on refusal.
- Unknown, interrupted, blocked, and ambiguous sources stay ink. No unsupported note/rest duration is promoted.

## Evidence policy: `distance-headroom-v1`

For each accepted primitive, let `d` be its winning weighted $P distance and `D = config.primitiveMaxDistance` (currently 1.5 at 32 samples). A note's bounded **shape support** is:

```
1 - max(constituent winning distances) / D
```

Whole notes have one constituent (head); halves/quarters have two (head and stem). Invalid/unaccepted distances are refused. All existing classifier geometry/distance/margin gates and conservative assembly rules must already pass; the formula adds no new acceptance threshold or tuning.

**This is an explicit heuristic guess, not calibrated confidence or probability.** It describes normalized distance headroom of the weakest constituent only. It ignores musical intent, population coverage, and the size of a passing margin. Zero means at the distance cutoff; one can be a self-match, not certainty. Never display it as percent certainty or interpret it as measured accuracy. Distances/margins and source-bank identity remain available for honest preview diagnostics.

`reviewedMusicCommand(review, decision)` requires the `user-reviewed` decision kind, explicit selected candidate indices, caller-assigned event IDs, measure ID, and time signature. It does not execute itself. The future UI must require a deliberate review/confirmation action against the displayed snapshot; the string token alone is **not proof of a human action**. No “accept all automatically” or confidence-threshold path is supplied.

Selected notes are saved in musical candidate order, not click order. Unselected candidates and all other raw strokes become unresolved references in original capture order. The generic v2 model `confidence` field stores this documented bounded support value only at that explicit boundary. Full diagnostics, bank ID, and support-policy metadata are transient and **not persisted by score-only v2**. After reload, generic evidence values alone do not identify their originating policy or establish reproducibility/calibration; do not compare unknown-policy callers' scores. Durable full evidence needs a deliberate future schema change.

The underlying validated score command snapshots selected data once and rejects stale base application/out-of-order undo; redo reuses IDs/data. Original ink is never deleted. Subsequent drawing conservatively invalidates events as documented in [music storage](music-storage.md), with Undo restoring music. Document identity does not replace active-pen, policy/template-generation, readiness, worker-message, or async scheduling guards; the future coordinator owns those, including re-associating worker results with their original main-thread immutable base only after token/generation checks.

## Regression evidence and limits

Ordinary tests still exclude evaluation recognition. The frozen v1 manifest/results are untouched; replay from `558fa7d`, not by refreshing hashes. Cloud equality is a derivation/integrity check, not another independent evaluation run. The historical first 20 decisions are not rerun or rebranded as a new runtime-bank accuracy result.

New runtime-bank diagnostics use **regression fixtures only**, with oracle primitive groups, separately from unchanged synthetic-bank reports:

| Regression set | Existing synthetic bank | Runtime bank | Runtime wrong accepts |
| --- | ---: | ---: | ---: |
| classifier-boundaries | 4/12 | 4/12 | 0 |
| classifier-linearity | 6/6 | 6/6 | 0 |
| personal (original recording) | 1/2 | 1/2 | 0 |
| primitive-grouping | 7/9 | 4/9 | 0 |
| simple-note-assembly | 15/16 | 15/16 | 0 |
| synthetic-smoke | 4/5 | 3/5 | 0 |

**The runtime bank has lower authored-regression coverage on two sets**, rejecting three additional grouping primitives and one additional smoke primitive. These are retained known misses, not relabeled successes. The choice preserves the preselected full recorded-development bank rather than adding/choosing synthetic samples after seeing outcomes. It is experimental, review-gated, and not presented as a universal upgrade. Observing zero wrong accepts in these small diagnostics **does not guarantee future safety**; the original real filled-head miss remains.

The new `runtime-review.json` is **synthetic and template-derived/self-similar**, not new independent handwriting. Both banks yield 4/4 primitive agreement on it. With deliberately authored observation clocks/regions, grouping → runtime bank → assembly → review matches its two expected events and leaves the unsupported tap unresolved; no labels are inputs to the pipeline. Its intentionally overfull measure tests structural/review handling, not duration resolution. Other unit cases cover partial/empty/reordered decisions, complete source accounting, stale atomic failure, v2 round-trip, mixed undo/redo, interrupted ink, malformed banks/partitions, and work caps. Existing synthetic grouping 29/29, oracle assembly 7/7, and synthetic-seed composed 6/7 protocols remain separate and unchanged.

[Opt-in VexFlow review display and selection/confirmation controls](notation-review.md) now exist with active/stale guards and raw unknown ink visible. Next: native acceptance, then real observation collection/live coordination with deliberate clock-domain/persistence behavior. Real iPad acceptance must cover bank labeling, unknown visibility, preview comparison, responsiveness, selection/corrections, history, and backup/reload. No native recognition/rendering latency or handwriting accuracy is established here.
