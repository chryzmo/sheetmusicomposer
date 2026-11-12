# Personal templates (milestone 7)

Status: **PR 1 of 4, pure model only.** There is no storage, training screen, or recognizer wiring yet. Nothing in the app changes behavior.

## Plan

1. **Model (this PR):** validated sample format, merge with the built-in bank, bank identity, tie-break rule, limits. DOM-free, in `src/recognize/user-templates.ts`.
2. **Storage and training screen:** IndexedDB repository (database version bump) and a screen to draw, review, delete, and reset samples. Needs real WebKit end-to-end tests, so it ships with the UI that exercises it.
3. **Wire into review:** the worker receives the merged bank; any template change invalidates in-flight reviews; diagnostics show user vs built-in matches.
4. **Evaluation:** a leave-one-session-out report, so training on one's own samples never becomes the only measure.

## Rules fixed by this PR

- A sample stores the **original strokes** (staff spaces, capture order), not a derived cloud, so a sampling-policy change re-derives templates without re-training. Samples are immutable; to correct one, delete it and draw again.
- Only `noteheadFilled`, `noteheadHollow`, and `stem` are supported, matching the current classifier. Samples need 1 to 8 complete strokes (interrupted ink is refused) and at most 20,000 points. Each shape is limited to 30 samples (`config.ts`; guesses, not tuned).
- Records from storage are decoded from `unknown`. A damaged, unsupported, duplicate, or over-limit record is **skipped and reported**, never thrown, so one bad record cannot disable recognition. Over the limit, the oldest samples are kept.
- **Priority:** the built-in and personal templates are ranked together by distance, and the best per label wins. A personal template outranks a built-in one only on an **exactly equal** distance. This is a tie-break, not a bonus. A distance bonus would need held-out evidence first.
- The built-in `pencil-dev-v1` bank is the fallback and is never modified. Personal templates are namespaced `user/<id>` with `user` provenance.
- **Bank identity** is the built-in ID when there are no samples, otherwise `<built-in>+user-<count>-<hash>`. Samples are immutable, so ID, label, and creation time determine content. Any add, delete, or relabel changes the identity; input order does not. The hash is a non-cryptographic FNV-1a for change detection only.
- Template ink is not checked against a label's geometry gates yet. The training screen should warn when a drawn sample would be rejected by its own label's rules.

## Evidence so far

A throwaway experiment (not committed) added the other recorded files' primitives to the built-in bank and classified each held-out file: 23/32 to 26/32 exact primitives, zero wrong accepts either way. This was the same session, held out by file, so it is optimistic and not an accuracy claim. The mechanics test in `user-templates.test.ts` shows one such rejection becoming an accept; it is not a measurement.
