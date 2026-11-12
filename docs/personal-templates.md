# Personal templates (milestone 7)

Status: **PR 4 of 4 (the plan is complete).** Samples can be trained, stored, listed, and deleted on the device, **Review notes uses them** together with the built-in bank, and `npm run test:fixtures` reports whether they help on held-out sessions. Automatic canvas recognition still does not exist.

## Plan

1. **Model (this PR):** validated sample format, merge with the built-in bank, bank identity, tie-break rule, limits. DOM-free, in `src/recognize/user-templates.ts`.
2. **Storage and training screen (this PR):** IndexedDB repository (database version 2) and the **Personal templates** screen. Covered by real WebKit end-to-end tests.
3. **Wire into review (this PR):** see below.
4. **Evaluation (this PR):** see below.

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

## Training screen and storage (PR 2)

- **Flow:** draw single-stroke examples on the staff (use **New** first), tap **Personal templates**, and choose a shape for each stroke. Every stroke defaults to **Skip**, so nothing is saved by accident. The screen works on a frozen copy of the page and never changes the sketch. Saved samples can be deleted one at a time, or all at once.
- **One stroke is one sample.** Multi-stroke heads are not supported yet; stems must be one stroke in any case.
- **Own-gate check:** before saving, a stroke is checked against the geometry gates of the label it was given (`sampleGeometryRejections`). A stroke that could never pass them (for example a tiny dot labeled as a head) is refused with a reason, and the others still save. Interrupted strokes are refused.
- **Atomic save:** all chosen samples are saved in one transaction that also enforces the per-shape limit, or none are. Two tabs cannot both pass the limit.
- **Database:** the shared database moves to **version 2**, adding a `templates` store; existing sketches are untouched by the upgrade (tested by upgrading a real version-1 database). A tab running older code that opens the upgraded database reports storage unavailable rather than risking data. Templates open independently of the sketch: if they are unavailable, drawing, saving, and review work as before and the screen says so.
- **Damaged records** are ignored and listed with their reason, and can be removed with one button.
- **Not included yet:** exporting/importing templates (website data can be cleared, which deletes them), a dedicated training canvas separate from the sketch, and multi-stroke samples. Backups of sketches do not include templates.

## Guided shape trainer

The Personal templates screen has **Start guided training**: the app names what to draw, labels each stroke from the prompt, and saves it as a sample, so nothing is annotated afterwards (the earlier screen still exists for labeling strokes already on the page).

- **Prompts** (`src/training/script.ts`) rotate filled head, hollow head, stem, so the hand switches shapes as it does when writing music, 8 per shape per round. Each prompt carries a hint that varies size, speed, stroke direction, slant, and position (on a line, in a space, above or below the staff). The aim is for training data to support **free sketching of your own music**, not only careful copying. A later round shifts the hints.
- **Own canvas:** strokes go on the trainer's own staff (a second instance of the same ink surface, with the same Pencil and palm handling), never the sketch.
- **Rules are the training screen's** (`src/training/validate.ts`): a complete single stroke that passes the prompted shape's own geometry gates. A stroke that fails is **not saved, its ink is removed, the prompt repeats, and the reason is shown**. Saving is one sample at a time.
- **Controls:** Undo last (removes the sample and returns to its prompt), Skip this prompt, Clear drawing area (keeps saved samples), Another round, Done. A shape already at its limit is skipped automatically.
- **Labels are the prompt, i.e. what you were asked to draw.** They are never recognizer output. A mislabeled sample (you drew a hollow head for a filled prompt) is not detected beyond the shape gates, so keep to the prompt.
- **Not included yet:** copying whole measures, tap-to-label annotation for free-drawn test measures, and session export/import. The plan is in the project notes: test measures should be free-drawn, since that is how the app will be used.

## Tap-to-label for free-drawn test measures

Training data from guided prompts is only worth having if it helps on **your own music**, so the test data has to be free-drawn. **Label measure** (toolbar) labels such a measure by tapping instead of typing stroke numbers:

1. Draw a measure freely on the sketch, then tap **Label measure**. It works on a frozen copy; the sketch and its undo history are untouched.
2. Tap a note's **head** (several strokes if the head has several), choose **Whole / Half / Quarter**, then tap its **stem** (a whole note has none). About three taps per note.
3. The **pitch** is suggested from where the head sits, using the same snapping as recognition (`pitchAtStaffY`). A dashed tick on the staff and the note list show it; nudge it up or down if you meant another note. For the recorded measures so far, the suggestion equals the hand-entered pitch for all 21 notes, so it is a good default; because it is the *same rule* as recognition, snapping errors only show up in a fixture if the labeler corrects them.
4. **Download fixture.** Primitives and events are derived: whole = hollow head; half = hollow head + stem; quarter = filled head + stem. Events run **left to right by notehead**. Every stroke no note claimed is saved as its own `unknown` primitive with no event (red ink until labeled).

Rules and limits:

- Nothing is recognized and nothing is prefilled from Review notes: the answer key is what you tapped and confirmed, never recognizer output.
- A tap selects the nearest stroke within a tolerance (`config.quickLabelTapDistance`), **preferring ink that is not yet in a note or the selection**, so a stem beside the next note's head, or overlapping outlines of one head, stay reachable. If only a labeled stroke is near, the tap says which note owns it.
- A stem must be a single stroke; a multi-stroke stem, dots, accidentals, rests, and eighths are not supported here (use **Record fixture**).
- Add the downloaded file with `npm run fixtures:import -- --session <id> <file>` (it records the role and session; see the [fixtures guide](../fixtures/README.md#adding-a-downloaded-file)). Do not use the same strokes to train and to test: training strokes come from guided training, test measures from here.

## Using personal samples in review (PR 3)

- **When read:** at each **Review notes** tap, the main thread reads the stored samples fresh (so multi-tab changes are seen), shows the bank, and sends the validated samples to the worker. The worker builds the merged bank and prepares the clouds off the ink-render thread.
- **Visible:** the dialog names the bank (`pencil-dev-v1`, or `pencil-dev-v1+user-N-<hash>`), the number of personal samples, and how many stored records were damaged and ignored. A proposal is marked when the closest template for any of its shapes was one of your samples; the diagnostics list each template ID and its `builtin`/`user` source.
- **Invalidation:** Keep re-reads storage and compares bank identities. If the samples changed since the preview (another tab, a reset), nothing is kept and the dialog asks you to review again. Within one tab the training screen and the review are both modal, so they cannot overlap. A cancelled or replaced review still cannot be revived, as before.
- **Failure behavior:** if a stored sample read fails, or a sample cannot be turned into a template, review **fails closed** with a message (it never silently reviews with a different bank). If the template store cannot open at all, review uses the built-in samples only and says so on screen.
- **Priority** is unchanged from PR 1: pooled distance ranking, a personal template wins only an exact tie. Whether personal samples *help* on held-out handwriting is not established by this PR; the evaluation step (PR 4) measures that.

## Evaluating personal samples (PR 4)

`npm run test:fixtures` prints a report that simulates training from recorded fixtures and scores the built-in bank against the built-in plus personal bank on the same held-out ink. Code: `tests/fixtures/personal-eval.ts`, `personal-sessions.ts`, `personal.test.ts`.

- **Simulated training uses the training screen's rules:** one complete stroke, the label's own geometry gates, the per-shape limit, manual fixture labels only (never recognizer output). Refused samples are listed in the report with the reason.
- **Strict (primary):** leave-one-**session**-out. A held-out session is scored with samples from *other* sessions only. A session is one sitting of the writer, recorded in `tests/fixtures/manifest.json` by `fixtures:import --session` (never inferred from names or file times); measures drawn in the same sitting share a session because they are not independent. When unsure, merge into one session: coarser only makes the check stricter.
- **Optimistic (for contrast):** leave-one-**fixture**-out, where other measures from the same sitting still train. It is printed only to show how much same-sitting reuse inflates results, and it is labeled NOT held out.
- **Scored:** per-shape results on oracle groups (exact, wrong accepts, known rejects) and note-level results through the same singleton review the app uses (notes proposed exactly, wrong proposals). A fixture with no expected events is not scored for notes, since an empty list is not a claim of "no notes".
- **Excluded:** the development fixture (already the built-in bank), the reserved evaluation fixture, and synthetic fixtures. The frozen `pencil-v1` evaluation files are untouched.
- **One pre-stated safety rule, asserted per strict fold:** personal samples must not add wrong accepted shapes or wrong proposed notes that the built-in bank did not already make. This is the project's "unreadable ink stays ink" invariant, not an accuracy target. **No accuracy threshold is asserted**, so scores can be compared without a target chosen after seeing them.
- **A new recorded fixture** needs a manifest entry (role and session) before the suite will run; `npm run fixtures:import -- --session <id> <file>` makes it. Choosing the session is the deliberate decision.

### First result (recorded fixtures at the time of this PR)

Three sessions: the original Quarter-e4 recording (2 primitives, no scored notes), the mixed sample, and three measures recorded back to back. Strict folds, notes proposed exactly (built-in -> personal), wrong proposals 0 in every case: mixed sample 5/6 -> 5/6; three measures 8/15 -> 11/15 (12 samples from the other sessions); total 13/21 -> 16/21. Shapes: 24/34 -> 27/34 exact, wrong accepts 0. Optimistic reuse reaches 17/21, so same-sitting reuse inflated the result only slightly here.

Read this carefully: it is **one writer**, three sessions, and one fold carries nearly all of the gain. The sessions that did not change (the mixed sample's first filled head, one whole head) are still rejected on the margin gate even with personal samples. One stem from the seven-note measure fails its own `stem-aspect` gate (too slanted) and would be refused by the training screen too, which suggests the stem slant limit may be tight for this writer; that is a threshold question for more data, not something this evaluation can settle. More sessions (especially recorded after training on the iPad) make the strict folds more meaningful.
