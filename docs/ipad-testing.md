# iPad acceptance checklist: ink, navigation, and storage

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

## Known limitations

- One current local sketch only; no library, accounts, or sync. No recognition or offline cold starts yet. Undo/redo and the view are session-only.
- The fixture recorder exports the entire current page as one measure; there is no measure selection or recognition accuracy baseline yet. Its annotations are not autosaved. Synthetic examples and the first recorded Pencil sample are kept in separate directories/sets; the recorded sample currently has primitive labels only. See [the fixture guide](../fixtures/README.md).
- Non-passive canvas touch listeners suppress native gesture handling in addition to `touch-action: none`. They are retained from the inter-stroke improvement reported by the user; application navigation uses Pointer Events, never Touch Events as a second drawing path.
- IndexedDB can be cleared or evicted; an OS kill can lose uncommitted ink. Wait for Saved and keep downloaded backups. Lifecycle flushes are best effort, not a guarantee.
- Navigation, resize, and Fit staff change only the view, never the stored staff-space points.
- Ink uses a constant visual width; there is no smoothing or pressure-based width yet.

Record failures with reproduction steps and screenshots/video where possible. Do not claim device acceptance until this checklist has been run on the target hardware.
