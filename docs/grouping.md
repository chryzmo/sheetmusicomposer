# Experimental primitive stroke grouping (milestone 2)

`groupStrokes(observations, options)` in `src/recognize/group.ts` is a pure, bounded **snapshot calculation**. It proposes primitive stroke groups without consulting primitive labels, classifier templates/scores, event truth, or saved sample timestamps. It is not a live timer/coordinator and is not connected to the canvas.

## Inputs and clock contract

Each completed `ObservedStroke` has original validated ink, observation-clock `startedAt`/`endedAt` values, and a supplied `{ measureId, beatId }` location. `beatId` may be null when beat mapping is unavailable. Staff geometry/caller region tracking supplies these IDs; the grouper does not derive measure boundaries or beats from recognized notes or arbitrary pixel widths.

Observation times must be finite/nonnegative, ordered in capture sequence (`previous endedAt <= next startedAt <= next endedAt`), and no later than `options.now`. Use a monotonic arrival clock, such as a future coordinator's `performance.now()` calls at observed pen contact/release; **do not backdate them using PointerEvent/sample timestamps**. Raw `InkPoint.t` may decrease, repeat, or be zero and is never sorted, normalized, clamped, or used for pauses.

`options.active` can describe an in-progress stroke by observation start/location **without passing partial ink**. If it began before the pending group's idle deadline, that timeout is held throughout contact. A stroke starting at/after the deadline cannot reopen the expired group. `finishMeasure` during active contact is rejected. Conflicting explicit current/active locations fail rather than choosing one silently.

Saved version-1 ink, the score-only version-2 schema, and the existing Pencil exports **do not contain these arrival clocks/regions**. They cannot establish recorded temporal grouping accuracy. The synthetic fixture harness supplies a separately authored 100-ms-start/40-ms-duration, single-region schedule; this is test input, not recovered or fabricated native capture metadata. Future live integration must collect actual observations; any persistence/export extension needs a deliberate schema and clock-domain/reload policy. Do not silently invent timings for old recordings.

## Grouping rules and output

- Keep capture order and every stroke ID. Do not split raw strokes, alter sample order, or segment a one-stroke complete note into head/stem pieces.
- A compact path may be a head fragment. Both width/height must be substantial; taps, small dots, thin axis-aligned lines, and tall stem-like paths remain separate singleton groups.
- Join consecutive eligible fragments only within the same supplied beat/measure, before the idle timeout, and while their union stays within the existing head size ceilings.
- Open fragments need unambiguous endpoint continuity. One unique endpoint pairing extends a chain; two disjoint pairings close its outline. Competing pairings are rejected, not resolved by nearest distance.
- A compact closed outline can accept substantial inset fill/retracing within its padded bounding box, in either drawing order. This is a bounding-box heuristic, **not contour containment or proof of musical intent**.
- Close pending groups on an inclusive idle timeout, region change, incompatible geometry, interruption, group-size limit, or explicit measure finish. Ineligible singletons/interrupted strokes close immediately. Interrupted ink never joins a complete group.

The result contains `closed` groups with original bounds, source IDs, location, and `closedBy`; an optional `pending` group; and `readyMeasureIds`. Every completed input stroke appears exactly once across closed/pending groups. Input objects/raw metadata are never modified. A snapshot is **not an append-only delta**: repeated calls repeat closed groups. Future coordinators must replace/reconcile the snapshot and use source revisions rather than appending it or committing stale asynchronous results.

Only closed groups may be sent to the classifier. A symbol pause does **not** complete its measure. Only seen measures other than the current location (plus the current one on explicit finish) are ready for finished-measure assembly; returning to a measure removes it from that ready snapshot. Even an immediately closed stem/unknown singleton does not make the active measure ready.

## Initial settings

All numbers are explicit **guesses**, not handwriting-calibrated thresholds, in `src/config.ts`:

| Setting | Value | Purpose |
| --- | ---: | --- |
| `groupPauseMs` | 500 ms | Inclusive observation-clock idle gap. |
| `groupMaxInputStrokes` | 256 | Bounded recomputation window; reject overflow, never truncate. |
| `groupMaxStrokesPerGroup` | 8 | Close a compact chain before accepting a ninth stroke into it. |
| `groupFragmentMinWidth` / `groupFragmentMinHeight` | 0.2 / 0.2 staff spaces | Keep thin line-like marks separate. |
| `groupFragmentMinExtent` | 0.3 staff spaces | Require a substantial maximum dimension; keep small dots separate. |
| `groupEndpointMaxGap` | 0.15 staff spaces | Inclusive endpoint-join radius. |
| `groupLoopMaxGap` | 0.1 staff spaces | Inclusive initial-path closure radius. |
| `groupContainmentPadding` | 0.05 staff spaces | Allow modest inset-fill edge jitter. |

Compact individual/combined bounds also use the existing head width/height ceilings (1.8/1.2 staff spaces), **without changing the primitive classifier's policy**. Raw point counts share the existing storage safety cap. Large documents need deliberate measure/window coordination, not arbitrary slicing that could cut a pending group. Unsupported/over-limit work must leave original ink intact.

## Evidence and limitations

Unit tests cover clock/geometry boundaries, pause versus measure readiness, region changes, long active contact, revisits, open/closed paths, opposite draw directions, inset fill, competing endpoint links, interruption, head/stem/dot separation, compact limits, group/input/point caps, immutable data, and invalid inputs.

Four explicitly selected synthetic fixtures match **29/29 expected groups and 4/4 complete source partitions**, using raw geometry and the authored observation schedule—not oracle primitive inputs. The new `primitive-grouping.json` covers split outlines, inset fill, stems/dots, nearby separate heads, interrupted ink, an unsupported one-stroke complete glyph, and horizontal ink. Its expected events are unannotated, not evidence that no notes exist.

On the three synthetic fixtures with exhaustive event truth, **group → classify → assemble produces 6/7 exact expected events with no extra/wrong emitted candidates** using the unchanged synthetic seed bank. The original C4-quarter filled head still fails classifier distance; that reject remains a miss and its source ink is retained. This differs from the isolated assembler's 7/7 using oracle labels. Neither result is recorded-handwriting, native-timing, population, or end-to-end app accuracy. Primitive regression/development scores are unchanged; the new fixture separately reports 7/9 primitive agreement (two correct unknown rejects, five correct accepts, two known rejects: unsupported dot and interrupted head).

No Pencil development/evaluation recording is temporally grouped or used to tune these settings. Original bytes, labels, primitive policy/templates, and frozen evaluation results/hashes are unchanged. Shared config/role files still differ from the v1 freeze: replay that candidate in its documented frozen worktree, not by refreshing hashes.

This handles only consecutive compact head-like fragments and singleton other strokes. It may split valid symbols after slow pauses, nonconsecutive editing, thin fill strokes, boundary jitter, or more than eight fragments; nearby/contained shapes can also be grouped incorrectly. It does not recognize semantic intent, general multi-stroke accidentals/rests/flags, single-stroke note components, delete gestures, or barlines. Caller regions/clocks must be correct. Real observation collection, native behavior, recognition quality, and actual iPad latency remain untested.

[Musical validation, guarded commands, and score-only v2 persistence](music-storage.md) now exist, without inventing candidate evidence or grouping clock metadata. A [named runtime-ready experimental bank/review boundary](runtime-review.md) now exists; its singleton fallback never fabricates grouping clocks or joins fragments. [Opt-in VexFlow review/confirmation](notation-review.md) now exists, using singleton fallback for all current app ink—not this temporal grouper. Next native acceptance, then a recognition coordinator that collects real observation clocks, runs recognition off ink-drawing frames, preserves unknown ink, and rejects stale results. Native iPad acceptance must cover pause/contact timing, boundary handling, responsiveness, undo/reload, and overlay alignment when that integration exists.
