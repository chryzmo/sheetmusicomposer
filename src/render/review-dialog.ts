import { config } from '../config';
import type { InkSurface, InkSurfaceStatus } from '../ink/surface';
import { timeSignatures } from '../model/music';
import type { TimeSignature } from '../model/music';
import type { SketchDocument } from '../model/document';
import { reviewedMusicCommand } from '../recognize/review';
import type { MusicReview } from '../recognize/review';
import { runtimeBankId } from '../recognize/runtime-bank';
import { templateBankIdentity } from '../recognize/user-templates';
import type { LoadedTemplates } from '../store/template-store';
import { drawInkReference } from './ink-reference';
import type { ReviewRequest, ReviewResponse } from './review-protocol';
import { reviewDuration, reviewDurationMessage } from './notation-model';

/** Where review reads personal samples. `load` is null when template storage could
 * not open; review then uses the built-in samples only and says so.
 */
export interface ReviewTemplateSource {
  readonly load: (() => Promise<LoadedTemplates>) | null;
  readonly unavailableReason: string;
}

export interface NoteReviewUi { update: (state: Pick<InkSurfaceStatus, 'document' | 'isDrawing'>) => void }

/** Opt-in UI only. No live timers, temporal grouping claims, or automatic edits.
 * Worker generations + exact main-thread base identity + contact checks guard
 * every asynchronous boundary; no cloned worker base can become a command base.
 */
export function attachNoteReview(button: HTMLButtonElement, surface: InkSurface,
  onKept: (notes: number, unresolved: number) => void, signal: AbortSignal, templates: ReviewTemplateSource): NoteReviewUi {
  const dialog = document.createElement('dialog');
  dialog.id = 'note-review'; dialog.setAttribute('aria-labelledby', 'note-review-title');
  dialog.innerHTML = `
    <h2 id="note-review-title">Review proposed notes</h2>
    <div class="tools review-actions"><button id="review-keep" type="button" disabled>Keep selected notes</button>
      <button id="review-close" type="button" autofocus>Cancel review</button></div>
    <p id="review-bank">Experimental bank: <strong>pencil-dev-v1</strong> (15 single-writer development samples). Whole, half, and quarter notes only.</p>
    <p>Re-reads the whole page as <strong>one measure</strong>. Keeping checked notes replaces its current music, not its ink. Cancel leaves the sketch unchanged.</p>
    <details><summary>Recognition limits and evidence policy</summary>
      <p>Singleton fallback: each original stroke is classified separately. No arrival clocks or fragment joins are invented. Multi-stroke heads may be missed. This is not universal handwriting coverage.</p>
      <p>Shape support is distance headroom, <strong>not calibrated confidence or probability</strong>. Duration resolution and direct pitch/duration correction are not implemented.</p>
    </details>
    <label class="review-signature">Review time signature <select id="review-signature"></select></label>
    <div class="review-panels">
      <section><h3>Frozen original ink</h3><p>Stroke numbers follow capture order. Unused ink is red; selected sources are green. All ink stays visible.</p>
        <svg class="review-ink" role="img" aria-label="Frozen original review ink with stroke numbers"></svg></section>
      <section><h3>All proposed notes</h3><p>Numbers match the checkboxes below. Not spacing-aligned to ink. Only checked proposals will be kept.</p>
        <div class="review-notation" aria-label="Notation preview"></div></section>
    </div>
    <output id="review-status" role="status">Preparing preview…</output>
    <p id="review-duration"></p>
    <p>Check each pitch and duration; leave wrong proposals unchecked. Nothing is selected automatically.</p>
    <div id="review-choices"></div>`;
  document.body.append(dialog);
  const get = <T extends Element>(selector: string): T => {
    const element = dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing review UI: ${selector}`);
    return element;
  };
  const signature = get<HTMLSelectElement>('#review-signature');
  for (const value of timeSignatures) { const option = document.createElement('option'); option.value = value; option.textContent = value; signature.append(option); }
  const bankNote = get<HTMLParagraphElement>('#review-bank');
  const status = get<HTMLOutputElement>('#review-status'), duration = get<HTMLParagraphElement>('#review-duration');
  const choices = get<HTMLDivElement>('#review-choices'), notation = get<HTMLDivElement>('.review-notation');
  const ink = get<SVGSVGElement>('.review-ink'), keep = get<HTMLButtonElement>('#review-keep');
  const options = { signal };
  let source = surface.currentDocument(), drawing = false, generation = 0, renderGeneration = 0;
  let worker: Worker | null = null, prepared: MusicReview | null = null, ready = false;
  let inputs: HTMLInputElement[] = [];
  let paths = new Map<string, SVGPolylineElement>();
  const stopWorker = (): void => { worker?.terminate(); worker = null; };
  const updateButton = (): void => { button.disabled = signal.aborted || drawing || dialog.open || source.strokes.length === 0; };
  const current = (token: number, base: SketchDocument): boolean => !signal.aborted && dialog.open && token === generation &&
    !drawing && surface.currentDocument() === base;
  const selected = (): number[] => inputs.flatMap((input, i) => input.checked ? [i] : []);
  const timeSignature = (): TimeSignature => {
    const value = timeSignatures.find((v) => v === signature.value);
    if (!value) throw new Error('Choose a supported time signature');
    return value;
  };
  const refreshSelection = (): void => {
    if (!prepared || !ready || !current(generation, prepared.base)) { keep.disabled = true; return; }
    const indices = selected(), used = new Set(indices.flatMap((i) => prepared!.candidates[i]!.note.strokeIds));
    const proposed = new Set(prepared.candidates.flatMap((c) => c.note.strokeIds));
    for (const [id, path] of paths) path.setAttribute('stroke', used.has(id) ? '#2c7663' : proposed.has(id) ? '#26352f' : '#b12e21');
    keep.disabled = indices.length === 0;
    const { units, target } = reviewDuration(indices.map((i) => prepared!.candidates[i]!.note.duration), timeSignature());
    const message = reviewDurationMessage(units, target, timeSignature());
    duration.textContent = message.text; duration.dataset.state = message.state;
    const proposals = prepared.candidates.length, unused = prepared.assembly.unresolvedStrokeIds.length;
    status.textContent = `${proposals} proposal${proposals === 1 ? '' : 's'}; ${unused} stroke${unused === 1 ? '' : 's'} unused by proposals (red). ${indices.length} selected. Unchecked proposal sources also remain unresolved.`;
  };
  const invalidate = (message: string): void => {
    generation++; renderGeneration++; ready = false; prepared = null; stopWorker(); keep.disabled = true;
    for (const input of inputs) input.disabled = true;
    if (dialog.open) { signature.disabled = true; status.textContent = message; }
  };
  const dismiss = (): void => {
    invalidate(''); dialog.close();
  };
  dialog.addEventListener('close', () => {
    invalidate(''); prepared = null; inputs = []; paths.clear();
    choices.replaceChildren(); notation.replaceChildren(); ink.replaceChildren(); duration.textContent = ''; delete duration.dataset.state;
    updateButton(); if (!signal.aborted) button.focus();
  }, options);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); dismiss(); }, options);
  get<HTMLButtonElement>('#review-close').addEventListener('click', dismiss, options);
  choices.addEventListener('change', refreshSelection, options);

  const fillChoices = (review: MusicReview): void => {
    choices.replaceChildren(); inputs = [];
    const numbers = new Map(review.base.strokes.map((s, i) => [s.id, i + 1]));
    review.candidates.forEach((candidate, i) => {
      const row = document.createElement('section'); row.className = 'review-candidate';
      const label = document.createElement('label'); label.className = 'review-choice';
      const input = document.createElement('input'); input.type = 'checkbox'; input.disabled = true;
      const name = `Note ${i + 1}: ${candidate.note.pitch.step}${candidate.note.pitch.octave}, ${candidate.note.duration}; strokes ${candidate.note.strokeIds.map((id) => numbers.get(id)).join(', ')}`;
      input.setAttribute('aria-label', name); inputs.push(input);
      label.append(input, document.createTextNode(name)); row.append(label);
      const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
      summary.textContent = 'Matching diagnostics (not probabilities)';
      pre.textContent = `Shape support: ${candidate.shapeSupport.toFixed(4)} (distance headroom only)\n` +
        candidate.evidence.map((p) => `${p.label}: strokes ${p.strokeIds.map((id) => numbers.get(id)).join(', ')}; label gap ${p.margin?.toFixed(4)}; linearity ${p.linearityRatio.toFixed(4)}\n` +
          p.candidates.map((c) => `  ${c.label}: distance ${c.distance.toFixed(4)}; ${c.templateId}; ${c.source.kind}; geometry ${c.geometryRejections.join(', ') || 'passes'}`).join('\n')).join('\n');
      // Provenance of the closest template per shape: personal or built-in.
      if (candidate.evidence.some((p) => p.candidates[0]?.source.kind === 'user')) {
        const note = document.createElement('small'); note.className = 'review-personal';
        note.textContent = 'Closest match was one of your personal samples.';
        row.append(note);
      }
      details.append(summary, pre); row.append(details); choices.append(row);
    });
  };
  const render = async (review: MusicReview, token: number): Promise<void> => {
    const renderToken = ++renderGeneration;
    ready = false; keep.disabled = true;
    for (const input of inputs) input.disabled = true;
    status.textContent = 'Loading local notation fonts and drawing preview…';
    try {
      const renderer = await import('./notation');
      await renderer.notationReady;
      if (!current(token, review.base) || renderToken !== renderGeneration) return;
      renderer.drawNotation(notation, review.candidates, timeSignature());
      ready = true;
      for (const input of inputs) input.disabled = false;
      refreshSelection();
    } catch (error) {
      if (current(token, review.base) && renderToken === renderGeneration) {
        ready = false; keep.disabled = true; notation.replaceChildren();
        status.textContent = `Preview failed: ${error instanceof Error ? error.message : String(error)}. Current sketch unchanged; cancel to return to ink.`;
      }
    }
  };
  signature.addEventListener('change', () => { if (prepared && current(generation, prepared.base)) void render(prepared, generation); }, options);

  const describeBank = (id: string, personal: number, skipped: number, unavailable: string): void => {
    bankNote.replaceChildren();
    const bold = document.createElement('strong'); bold.textContent = id;
    bankNote.append('Bank: ', bold, personal === 0 && unavailable === ''
      ? ' (15 built-in single-writer development samples; no personal samples). '
      : unavailable !== '' ? ` (built-in samples only: personal templates are unavailable, ${unavailable}). `
        : ` (15 built-in samples plus ${personal} personal sample${personal === 1 ? '' : 's'}). `,
      skipped > 0 ? `${skipped} stored template record${skipped === 1 ? ' was' : 's were'} damaged and ignored. ` : '',
      'Whole, half, and quarter notes only.');
  };
  button.addEventListener('click', () => {
    if (drawing || dialog.open || signal.aborted) return;
    const base = surface.currentDocument(), token = ++generation;
    prepared = null; ready = false; inputs = []; keep.disabled = true; signature.disabled = true;
    signature.value = base.measures?.[0]?.timeSignature ?? '4/4';
    dialog.showModal(); updateButton(); status.textContent = 'Preparing review off the ink-render thread…';
    try {
      // Check before structured-cloning or building a large SVG on the UI thread.
      if ((base.measures?.length ?? 0) > 1) throw new Error('Review supports one-measure pages only');
      if (base.strokes.length > config.assemblyMaxPrimitives) throw new Error('Review exceeds primitive work limit');
      if (base.strokes.reduce((sum, s) => sum + s.points.length, 0) > config.reviewMaxPoints) throw new Error('Review exceeds point work limit');
      paths = drawInkReference(ink, base, new Set(base.strokes.map((s) => s.id)));
      void startWorker(base, token);
    } catch (error) {
      stopWorker(); status.textContent = `Review unavailable: ${error instanceof Error ? error.message : String(error)}. Current sketch unchanged.`;
    }
  }, options);
  /** Reads personal samples fresh for THIS review, then starts the worker. A read
   * failure fails closed (no review) rather than quietly using a different bank.
   */
  const startWorker = async (base: SketchDocument, token: number): Promise<void> => {
    try {
      bankNote.textContent = 'Bank: loading personal templates…';
      let loaded: LoadedTemplates = { samples: [], skipped: [] };
      if (templates.load) {
        try { loaded = await templates.load(); }
        catch (error) {
          if (current(token, base)) status.textContent = `Review unavailable: could not read personal templates: ${error instanceof Error ? error.message : String(error)}. Current sketch unchanged.`;
          return;
        }
        if (!current(token, base)) return;
      }
      describeBank(templateBankIdentity(runtimeBankId, loaded.samples), loaded.samples.length, loaded.skipped.length, templates.load ? '' : templates.unavailableReason);
      const job = new Worker(new URL('./review-worker.ts', import.meta.url), { type: 'module' });
      worker = job;
      job.onmessage = (event: MessageEvent<ReviewResponse>) => {
        if (!current(token, base) || event.data.token !== token || worker !== job) return;
        stopWorker();
        if (event.data.kind === 'error') { status.textContent = `Review unavailable: ${event.data.message}. Current sketch unchanged.`; return; }
        // Re-associate ONLY this generation's result with its exact original base.
        const review: MusicReview = { ...event.data.review, base };
        prepared = review;
        paths = drawInkReference(ink, base, new Set(review.candidates.flatMap((c) => c.note.strokeIds)));
        signature.disabled = false; fillChoices(review); void render(review, token);
      };
      job.onerror = (event) => {
        event.preventDefault();
        if (!current(token, base) || worker !== job) return;
        stopWorker(); status.textContent = 'Review worker failed. Current sketch unchanged; cancel to return to ink.';
      };
      job.postMessage({ token, document: base, samples: loaded.samples } satisfies ReviewRequest);
    } catch (error) {
      stopWorker(); if (current(token, base)) status.textContent = `Review unavailable: ${error instanceof Error ? error.message : String(error)}. Current sketch unchanged.`;
    }
  };
  keep.addEventListener('click', () => {
    const review = prepared;
    if (!ready || !review || !current(generation, review.base) || selected().length === 0) return;
    // Personal templates are a recognition input: if they changed since this
    // preview (another tab, or anything else), the proposals no longer describe
    // what a new review would show, so refuse rather than keep stale proposals.
    const token = generation;
    keep.disabled = true;
    void (async () => {
      if (templates.load) {
        let latest: LoadedTemplates;
        try { latest = await templates.load(); }
        catch (error) { if (current(token, review.base) && prepared === review) invalidate(`Could not confirm personal templates: ${error instanceof Error ? error.message : String(error)}. Close and review again.`); return; }
        if (!current(token, review.base) || prepared !== review) return;
        if (templateBankIdentity(runtimeBankId, latest.samples) !== review.bankId) {
          invalidate('Personal templates changed since this preview. Close it and review again so proposals use the current samples. Nothing was kept.');
          return;
        }
      }
      keepSelected(review);
    })();
  }, options);
  const keepSelected = (review: MusicReview): void => {
    if (!ready || !current(generation, review.base) || selected().length === 0) { keep.disabled = false; refreshSelection(); return; }
    try {
      const selection = selected().map((candidateIndex) => ({ candidateIndex, eventId: crypto.randomUUID() }));
      const command = reviewedMusicCommand(review, { kind: 'user-reviewed', measureId: review.base.measures?.[0]?.id ?? crypto.randomUUID(),
        timeSignature: timeSignature(), selected: selection });
      surface.applyReview(command); // Rechecks active contact + exact command base.
      const unresolved = surface.currentDocument().measures?.[0]?.unresolvedStrokeIds.length ?? 0;
      dismiss(); onKept(selection.length, unresolved);
    } catch (error) {
      invalidate(`Could not keep review: ${error instanceof Error ? error.message : String(error)}. Close and review again.`);
    }
  };
  signal.addEventListener('abort', () => { invalidate(''); dialog.remove(); prepared = null; paths.clear(); inputs = []; }, { once: true });
  updateButton();
  return { update: (state) => {
    const changed = state.document !== source;
    source = state.document; drawing = state.isDrawing;
    if (changed || drawing) invalidate(drawing ? 'Pen contact started. Close this preview, lift the Pencil, and review again.' : 'Sketch changed. Close this preview and review again before keeping notes.');
    updateButton();
  } };
}
