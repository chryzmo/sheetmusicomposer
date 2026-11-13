# iPad acceptance checklist: ink, navigation, storage, and note review

Status: the user reported Pencil drawing and rapid strokes with a resting palm working, then accepted touch navigation as looking good. The user also reported undo/redo testing passing on the iPad. After the timestamp validation fix, the user reported the backup restore → Saved → reload/ink recovery test passing on the iPad, followed by New-page testing looking good. The user subsequently reported the fixture-recorder test checking out; the exported primitive-only sample is now preserved in `fixtures/recorded/quarter-e4.json` and validated by the fixture loader. Storage error, multi-tab conflict, and other unchecked scenarios below still need device acceptance. Device/OS versions and item-by-item regression results have not been recorded; the checklist below remains the reference for future changes. Automated WebKit tests use synthetic pointer events; they do not prove native Pencil, palm rejection, coalesced-event, or pointer-capture behavior.

## Setup

- Record iPad model, iPadOS/Safari version, Pencil model, app revision, and test URL.
- Open a trusted HTTPS deployment or `npm run dev:lan` on the same trusted LAN.
- Confirm the canvas fills the workspace, finishes loading, and shows a save-state indicator.
- Use disposable ink for initial storage tests. If a sketch already exists, download a backup before testing restore or deletion. Keep the browser and origin fixed during reload tests.

## Drawing

- Write a filled notehead, hollow notehead, stem, short dot, and a fast zigzag.
- Draw 20 short strokes rapidly, lifting/reapplying the Pencil without pausing. Each contact should count once, with no cooldown. Repeat with your palm on the screen.
- If contacts are delayed or missed, open the same URL with `?debugInk=1`. The footer shows a bounded local log of pointer down/up/cancel/capture-loss and errors, with page-relative times. Report whether a `down pen` line appears immediately when touching down, and copy or photograph the log. It does not upload input data.
- Verify ink follows the Pencil without visible jumps, gaps, or excessive lag.
- Try varied pressure and Pencil tilt. Width is currently constant; metadata capture is unit-tested, not exposed in the UI.
- Draw above/below the staff and at each edge of the canvas.
- Start a stroke inside, move outside, and release. Pointer capture should retain the end of the stroke and allow the next stroke normally.
- Hover with a supported Pencil: no ink should appear until contact.
- Touch with fingers or a palm while writing: neither should draw extra strokes or shift/zoom the view.
- On a device with a mouse/trackpad, verify clicks and drags do not draw.

## Undo and redo

- Confirm Undo/Redo start disabled. Draw three distinct Pencil strokes, then tap Undo three times. Each tap should remove exactly one new stroke, newest first; Undo should disable when all edits from this session have been undone, leaving any initially loaded ink.
- Tap Redo three times: exact strokes should return in original order and positions, including small dots. Redo should disable at the end.
- Undo once and draw a new stroke: the old redo branch should be unavailable.
- Pan/zoom between edits: Undo should remove ink, not reverse navigation. Fit staff must not erase history or clear redo.
- Repeat with a resting palm: toolbar taps after lifting/reapplying a finger should work, and drawing should still have no inter-stroke delay.
- If a hardware keyboard is available, verify Command-Z/Command-Shift-Z or Control-Z/Control-Shift-Z/Control-Y. While holding the Pencil down, Undo should remove only that partial stroke; lifting afterward must not re-add it. Redo should restore its captured portion. Redo during drawing is ignored.
- Interrupt a stroke by switching apps or rotating, then undo/redo it. It should be one history step with all samples received before interruption preserved.
- Wait for Saved, then reload: ink should remain but Undo/Redo should start disabled. History is session-only.

## Touch navigation

- Without Pencil contact, drag one finger: staff and ink should pan together, without scrolling the page.
- Pinch two fingers: staff and ink should zoom around the fingers' midpoint; moving the midpoint should also pan. Check both zoom limits and confirm the view stays usable.
- Lift one finger after pinching, then move the remaining finger: navigation should become a pan without jumping.
- Add a third finger: its movement should not change the view until one of the first two lifts.
- Draw ink, pan/zoom, then draw again. New ink must land under the Pencil. Tap **Fit staff**: both old and new strokes should align correctly relative to the staff.
- Rest a palm before starting a Pencil stroke, then move it during and after the stroke. Once Pencil contact begins, that palm contact must not navigate until lifted. A palm moving before Pencil contact may pan; this is a known limitation of the conservative policy, not a claim of hardware palm detection.
- While writing, add another finger; it must stay suppressed even after lifting the Pencil. Lift that finger and touch again: deliberate navigation should work immediately.
- Repeat rapid Pencil strokes with your palm resting. Confirm the previous inter-stroke delay has not returned.
- Pan the staff offscreen and tap **Fit staff** to recover it; no ink should disappear.

## Interruptions and resize

- Draw several strokes, then rotate the device. Ink should remain aligned relative to the staff. The view retains its scale and the document point at the viewport center; use **Fit staff** to refit.
- Rotate while the Pencil is down: keep all samples received so far as an interrupted stroke; start a fresh stroke after lifting/reapplying the Pencil.
- Switch apps or tabs during a stroke, then return. Earlier ink should remain, and the next stroke should not connect to the old one. Already committed ink should reload after eviction; an unfinished or uncommitted stroke is not guaranteed to survive an OS process kill.
- Trigger an interruption such as opening Control Center while drawing. No stuck active pointer or loss of prior completed strokes.
- Check the footer counts each complete/interrupted stroke once and transitions through Drawing/Saving to Saved, without resizing the canvas during ordinary strokes.

## Save/load and backup/restore

- Draw several distinct strokes. Wait for **Saved on this device**, reload, and confirm exact ink returns. Undo/Redo start disabled and Fit staff is restored.
- Timestamp regression: rapid Pencil/coalesced input must not produce **Invalid timestamp** merely because raw sample times decrease. Restore a backup from the failed-save session, wait for Saved, reload, and confirm ink remains. Raw timestamps and sample order must not be rewritten.
- Draw, undo, wait for Saved, and reload: the undone stroke must stay absent. Repeat with Redo before reload.
- Draw a partial stroke, switch apps, return, and wait for Saved. Reload and confirm captured ink remains. Do not assume an OS kill can complete pending writes.
- Use **Download backup**. Confirm iPad Firefox/Safari's download or Files UI produces a timestamped JSON file you can retrieve outside website storage.
- **New page (initial user testing passed):** draw ink, pan/zoom, tap New, and cancel: ink/view must remain unchanged. Tap New and confirm: ink must clear and the view refit. Undo must recover the ink, and Redo must clear it again. Wait for Saved and reload: the blank page must remain. New replaces the same saved draft, not a separate archive; use the downloaded backup to keep old pages. On an already blank page, New must not prompt or add an empty history step.
- Draw additional ink, then **Restore backup** from that JSON file. Confirm replacement, verify original ink returns, then Undo and Redo the restore. Wait for Saved and reload to verify the restored document remains.
- Cancel the restore confirmation and try malformed JSON: neither must replace the current sketch. Read the failure/canceled status.
- Verify that storage failures remain visible and Download backup remains usable. Automated tests simulate quota/security errors; do not deliberately fill or erase valuable device data for this check.
- Open two tabs at the same origin before editing. Save an edit in the first, then draw in the second. The stale tab must report a conflict, not replace the saved sketch; download its ink before reloading.
- If offered, tap **Request persistent storage** and read the granted/denied result. Either outcome must explain that backups are still needed.
- Verify browser/origin isolation using only disposable test data: importing a JSON backup is required to move between browsers, devices, ports, or hostnames. Never interpret a blank draft at a different origin as permission to delete the old one.
- Recheck rapid Pencil strokes, palm suppression, pan/zoom, and toolbar layout with the new save/backup controls present.

## Fixture recorder (initial user testing passed)

The user reported fixture-recorder testing passing after the suggested filled-head/stem recording workflow. The exported file is checked in unchanged as `fixtures/recorded/quarter-e4.json`; its filled-head/stem labels and 1,435 raw samples pass loader/round-trip validation. It has no expected note event, so the event-entry part of the suggested workflow is not established by the file itself. The broader checks below remain the regression checklist; this report does not establish item-by-item completion.

- Keep a normal backup before using New for a disposable sample. Draw a filled head and stem as two strokes on the staff, then tap **Record fixture**. Check that the frozen preview labels the correct stroke starts 1 and 2.
- Enter a name/set and time signature. Change the initial unknown group to `noteheadFilled` on stroke `1`, then add `stem` on stroke `2`. Add the expected note with pitch, duration, optional dots/accidental, and sources `1,2`. Verify the native selects, keyboard, dialog scrolling, and close controls work in both orientations.
- Download the fixture and confirm Files contains retrievable JSON. Transfer it to `fixtures/recorded/`, review the expected result and raw geometry, and run `npm run test:fixtures`. Compare the fixture document to a backup of the same ink: IDs, samples, timestamps, pressure/tilt, and completion must agree.
- Pan/zoom the page and record it again: the view must not change exported raw positions or staff geometry. Time signature is fixture metadata only; the canvas has no printed signature or barlines yet.
- Try a rest with no pitch and an unknown/unsupported mark with no event. Unknown stays explicitly labeled ink; export does not run recognition. Try missing, repeated, and out-of-range source numbers and read the validation error before fixing them.
- Close or press Escape without exporting; drawing and its undo/redo must still work. Reopen: annotations are intentionally reset, and the new snapshot must reflect current ink. Check that opening the recorder does not add an undo step (except finalizing an already active stroke).
- Recheck ordinary drawing, palm behavior, navigation, New, and backup/restore with the new toolbar button. Fixture JSON is deliberately rejected by Restore backup; retain a normal backup separately.

## Experimental note review — pending native acceptance

This new path has automated WebKit coverage only. The earlier accepted ink/fixture behavior does **not** establish Pencil recognition quality, preview responsiveness, font/layout readability, or review interaction on hardware. Record iPad/OS/Pencil/revision and screenshots with failures before advancing to live recognition or later milestones.

- Keep a backup; use disposable ink. Draw a filled head and separate stem (quarter), hollow head and separate stem (half), and isolated hollow head (whole) at different horizontal positions. Start near the staff to avoid separately drawn unsupported ledger strokes. Try your usual style; misses must remain ink, not be relabeled as successful recognition.
- Lift the Pencil; tap **Review notes**. Verify the visible bank `pencil-dev-v1`, one-measure replacement warning, and singleton limitation under Recognition limits. No checkbox should start checked. The source view must retain all original ink with capture-order stroke numbers; red means unused/unresolved. Proposal numbers must match checkbox pitch/duration labels and their listed source strokes. Compare actual glyph shapes/ledger positions, not just labels.
- Check portrait and landscape: scroll the dialog, both reference/notation panels, candidate details, and sticky Keep/Cancel actions. Cancel must stay reachable. Confirm music fonts are legible, and source/notation are understood as separate spacing—not an aligned overlay.
- Open matching diagnostics: distances, label gaps, template IDs/provenance, and shape support must be labeled non-probabilistic. Unknowns/ambiguities must stay visible; do not call safe rejects correct recognized notes. Record wrong proposals separately from misses.
- Select one correct note; its source ink should turn green in the reference. Change 4/4 to another supported signature. Check partial/overfull duration warnings in quarter-note units (6/8 target = 3), with no invented rests/duration repairs. Uncheck everything: Keep must disable. An unknown-only page must not offer fabricated selectable notes.
- Cancel, reopen, and compare a downloaded backup: no source/model/history change, and selection resets. Try Cancel while first-review assets/worker are loading; no late popup/commit may appear. First-review load/font/render and repeated-review latency need actual measurements; a worker does not prove adequate native responsiveness.
- Keep only correct proposals. Main canvas must still show all original ink; footer event/unresolved counts update and save status must reach Saved independently. Download a backup. Undo/Redo must restore exact score IDs/data and ink; reload must preserve music and reset history. The preview is an ink re-read, not display of stored corrections. New ink must invalidate music; Undo restores it.
- Verify New/Undo and Restore/Undo after keeping music. Record fixture afterward: defaults remain manual unknown groups/no events, never copied recognized ground truth. Enter expected results from your written intent if exporting a new recognition fixture.
- Review must disable during Pencil contact without interrupting that stroke. Return from the dialog and repeat rapid strokes/palm suppression, pan/zoom, Fit, toolbar/keyboard history, backup/reload, and Save-state layout checks. Rotating/app-switching during ordinary drawing must retain prior interruption behavior.
- Leave unsupported flags/dots/accidentals/rests, connected glyphs, and split heads as visible unresolved ink when they cannot be safely read. More than one stored measure or processing/display cap errors must refuse review without flattening/truncation or data loss. Direct correction gestures and native/live grouping are not implemented yet.

See [review workflow/architecture/limits](notation-review.md). No native acceptance has been reported for this section yet.

## Personal templates (training screen) — pending native acceptance

New in this change. Automated WebKit tests use synthetic pointer events, so Pencil feel, layout, and real iPad storage behavior need hand checks. Saved samples are also used by Review notes (next section).

- Tap **Personal templates** then **Start guided training** (the quickest route; see the guided checks below). Or, for the manual route: download a backup, tap **New**, draw about 5 filled noteheads, 5 hollow noteheads, and 5 stems as single strokes at your normal writing size, then tap **Personal templates**. The dialog should list one row per stroke with a small thumbnail and a shape menu set to **Skip**. Check scrolling and that Close and Save stay reachable in portrait and landscape.
- Choose a shape for every stroke and save. Counts should update and the saved list should show recognizable thumbnails. Strokes you saved reset to Skip. Reopen the screen after closing: nothing should save twice.
- Deliberately label a stem as a head, a tiny dot as a head, and a head as a stem. Each should be refused with a plain reason, without blocking the correct strokes.
- Reload the page, then reopen the screen: saved samples and counts should remain. Delete one sample, then use **Delete all personal samples** (it should ask first). The sketch itself must stay unchanged throughout.
- Rapid strokes, palm rejection, navigation, undo/redo, backup/restore, and autosave should still work with the new toolbar button. Record the iPad/OS/Pencil and any stroke that is refused unexpectedly, with a screenshot.

### Guided training checks

- Open **Personal templates** and tap **Start guided training**. The prompt names the shape and a hint; the staff area below should accept Pencil strokes with the usual palm handling, and the sketch behind the dialog must not change.
- Draw about 8 of each shape, following the hints (small, large, quick, high, low, up and down strokes, slanted stems). After each stroke the status should say what was saved and the prompt should advance.
- Draw something wrong on purpose (a tiny dot for a notehead): it should not be saved, its ink should disappear, and the same prompt should repeat with a reason.
- Try **Undo last**, **Skip this prompt**, **Clear drawing area**, and **Another round**. Check the saved counts, and that **Done** returns to a saved list that includes the new samples.
- Note any stroke that was refused that you think was fine (and which prompt), any prompt that is hard to follow, and how it feels to use the staff area at its size (portrait and landscape).

## Label measure (tap-to-label) — pending native acceptance

For free-drawn test measures. Automated tests use synthetic taps and strokes; touch and Pencil taps on real ink need hand checks.

- Write a short measure of your own music (a few notes, different lengths), at your normal size and speed. Include one stray mark you do not want labeled.
- Tap **Label measure**. Tap each head, choose its length, then tap its stem. Check that taps land on the stroke you mean (including a stem right beside the next note's head), and that tapping again on a selected stroke or a labeled one explains what happened.
- Check each suggested pitch against what you meant, using the dashed tick and the list; nudge any that are wrong. Note any pitch you had to correct (it shows where snapping disagrees with intent).
- Download the fixture, confirm the Files copy, and check the stray mark became unknown ink. Time how long a measure takes to label compared with **Record fixture**, and note any step that is awkward on the iPad (target size, scrolling, the dialog moving as the prompt changes).

## Review with personal samples — pending native acceptance

Review notes now reads your trained samples. Automated tests use synthetic ink, so whether your samples actually improve recognition has to be judged on the iPad.

- With no personal samples, Review notes should look and behave as before; the bank line reads `pencil-dev-v1` with no personal samples.
- Train a small set (about 5 of each shape), then draw measures you know failed before, for example filled heads that were rejected, and tap **Review notes**. The bank line should read `pencil-dev-v1+user-N-…` with your sample count. Compare which notes are now proposed, and record any that are **wrong** (a wrong proposal matters more than a miss).
- Proposals whose closest match was one of your samples show a note; open the matching diagnostics and check the template IDs and `builtin`/`user` source make sense.
- Open a review, then change your samples in a second tab and return: Keep should refuse with a message and keep nothing. Review again and confirm the new bank.
- Delete all personal samples and review again: the bank returns to built-in only, with the same proposals as before training.
- First-review latency with many samples (30 per shape is the limit): note whether opening the review feels slower.
- Heavy hollow heads (drawn with a retraced or thick outline) may now be left as red ink instead of becoming a note, if their ink density is at least 11 (see the matching diagnostics). Draw a few such hollow heads and note whether any is withheld, since that is the veto's cost. Dense scribbled filled heads that used to be misread as hollow should now stay as ink rather than become a wrong note.
- Record fixtures of any new wrong proposals or surprising misses, for the evaluation step.

## Repitch a kept note (hold, then drag) — pending native acceptance

After **Review notes → Keep**, each kept note shows an orange ring on the page. Hold the Pencil still on a ring, then drag up or down to change its pitch. Automated tests drive synthetic pen events, so the feel of the gesture has to be judged on the iPad.

- Hold the Pencil on a ring without moving: after about half a second the ring fills and a pitch label (for example `G4`) appears. Drag: the label steps by one line or space at a time. Lift: the note changes and the status line says `Moved a note from E4 to G4`. The original ink does not move.
- Tap **Undo**: the pitch returns. **Redo** reapplies it. While still dragging, Undo only abandons the drag.
- Start a stroke on a note and move straight away: it should be ordinary ink, not a grab. Try drawing slowly across a note and note any accidental grabs. (New ink still clears kept notes, as before; Undo restores them.)
- Hold on empty staff, and hold on a note with a finger: neither should grab. A finger still pans.
- The timing (`noteGrabHoldMs`), the allowed movement while holding (`noteGrabHoldTolerance`) and the grab size (`noteGrabRadius`) in `src/config.ts` are guesses. Say whether holding feels too slow, too sensitive, or hard to land on a head.
- Drag past the top or bottom of the page range: the pitch should stop at the last valid pitch rather than jump.

## Tap a kept note to change its duration — pending native acceptance

A quick Pencil tap on a kept note's ring steps its duration quarter → half → whole → quarter. Automated tests use synthetic taps, so the feel has to be judged on the iPad.

- Tap a ring: the note changes and the status line says what changed and whether the measure is now overfull, underfull or full. The measure is never repaired for you. Original ink does not move.
- Undo and Redo step each change exactly.
- A tap on empty staff, or a tap that drifts slightly, should still leave an ordinary ink dot or stroke. Note any tap that cycled a note when you meant to draw, or a deliberate tap that drew a dot instead. The tap tolerance is the same `noteGrabHoldTolerance` as the hold, and the time limit is `noteGrabHoldMs`.
- Holding instead of tapping should still start the pitch drag, not cycle the duration.
- Only whole, half and quarter are cycled until flags exist; eighths and sixteenths are not yet drawn or recognized.

## Known limitations

- One current local sketch only; no library, accounts, or sync. Recognition is opt-in experimental one-measure review with singleton groups, not live transcription. No offline cold starts yet. Undo/redo and the view are session-only.
- The fixture recorder exports the entire current page as one measure; there is no measure selection or native end-to-end handwriting accuracy baseline yet. Its annotations are not autosaved. Synthetic examples and the first recorded Pencil sample are kept in separate directories/sets; the recorded sample currently has primitive labels only. See [the fixture guide](../fixtures/README.md).
- Non-passive canvas touch listeners suppress native gesture handling in addition to `touch-action: none`. They are retained from the inter-stroke improvement reported by the user; application navigation uses Pointer Events, never Touch Events as a second drawing path.
- IndexedDB can be cleared or evicted; an OS kill can lose uncommitted ink. Wait for Saved and keep downloaded backups. Lifecycle flushes are best effort, not a guarantee.
- Navigation, resize, and Fit staff change only the view, never the stored staff-space points.
- Ink uses a constant visual width; there is no smoothing or pressure-based width yet.

Record failures with reproduction steps and screenshots/video where possible. Do not claim device acceptance until this checklist has been run on the target hardware.
