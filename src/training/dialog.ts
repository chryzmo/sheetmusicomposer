import { config } from '../config';
import type { SketchDocument } from '../model/document';
import type { Stroke } from '../ink/types';
import { sampleGeometryRejections } from '../recognize/classify';
import type { GeometryRejection } from '../recognize/classify';
import type { SimplePrimitive } from '../recognize/primitives';
import { decodeUserTemplateSample, encodeUserTemplateSample, userTemplateLabels, userTemplates } from '../recognize/user-templates';
import type { UserTemplateSample } from '../recognize/user-templates';
import { errorMessage } from '../store/autosave';
import type { LoadedTemplates, TemplateRepository } from '../store/template-store';

const labelNames: Readonly<Record<SimplePrimitive, string>> = {
  noteheadFilled: 'Filled notehead', noteheadHollow: 'Hollow notehead', stem: 'Stem',
};
const problemText: Readonly<Record<GeometryRejection, string>> = {
  'head-size': 'Too small or too large for a notehead.', 'head-aspect': 'Too narrow or too flat for a notehead.',
  'stem-size': 'Too short or too long for a stem.', 'stem-aspect': 'Too slanted for a stem.',
  'stem-strokes': 'A stem must be one stroke.', 'stem-linearity': 'Not straight enough for a stem.',
};
const ns = 'http://www.w3.org/2000/svg';

/** Small outline of one sample's strokes, scaled to its own bounds. */
function drawThumbnail(svg: SVGSVGElement, strokes: readonly Stroke[]): void {
  svg.replaceChildren();
  const points = strokes.flatMap((stroke) => stroke.points);
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const size = Math.max(maxX - minX, maxY - minY, 0.5), pad = size * 0.1;
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${size + pad * 2} ${size + pad * 2}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const stroke of strokes) {
    const line = document.createElementNS(ns, 'polyline');
    const coordinates = stroke.points.map((p) => `${p.x},${p.y}`);
    if (coordinates.length === 1) coordinates.push(coordinates[0]!);
    line.setAttribute('points', coordinates.join(' '));
    for (const [key, value] of Object.entries({ fill: 'none', stroke: '#26352f', 'stroke-width': String(size * 0.04), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) line.setAttribute(key, value);
    svg.append(line);
  }
}

/** Personal-template training dialog. Samples come only from ink the user drew
 * and labeled here; recognition output never becomes a sample. A frozen copy of
 * the current page is shown with one row per stroke (default Skip), so nothing
 * is trained by accident and the sketch is never changed. Saved samples are not
 * yet used by Review notes.
 */
export function attachTemplateTraining(
  button: HTMLButtonElement, snapshot: () => SketchDocument,
  repository: TemplateRepository | null, unavailableReason: string, signal: AbortSignal,
): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'template-training';
  dialog.setAttribute('aria-labelledby', 'training-heading');
  dialog.innerHTML = `
    <h2 id="training-heading">Personal templates</h2>
    <p>Teach the app your handwriting. Draw several single-stroke examples of each shape on the staff at normal size
      (for example 5 filled noteheads, 5 hollow noteheads, and 5 stems), then open this screen and choose a shape for each stroke.
      Use <strong>New</strong> first so training marks do not mix with a sketch. Strokes you leave on Skip are ignored.</p>
    <p><strong>Saved samples are stored only on this device and are not used by Review notes yet.</strong> Clearing website data deletes them.</p>
    <output id="training-status" role="status"></output>
    <h3>Saved samples</h3>
    <p id="training-counts"></p>
    <ul id="training-saved" class="training-list" aria-label="Saved personal samples"></ul>
    <div id="training-damaged" hidden>
      <p><span id="training-damaged-text"></span> <button type="button" id="training-remove-damaged">Remove damaged records</button></p>
      <details><summary>Reasons</summary><ul id="training-damaged-reasons"></ul></details>
    </div>
    <div class="tools"><button type="button" id="training-clear">Delete all personal samples</button></div>
    <h3>Add from the current page</h3>
    <p id="training-help"></p>
    <ol id="training-rows" class="training-list" aria-label="Strokes on the current page"></ol>
    <div class="tools training-actions">
      <button type="button" id="training-save" disabled>Save labeled samples</button>
      <button type="button" id="training-close">Close</button>
    </div>`;
  document.body.append(dialog);
  const get = <T extends Element>(selector: string): T => {
    const element = dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing training control: ${selector}`);
    return element;
  };
  const status = get<HTMLOutputElement>('#training-status');
  const counts = get<HTMLParagraphElement>('#training-counts');
  const saved = get<HTMLUListElement>('#training-saved');
  const rows = get<HTMLOListElement>('#training-rows');
  const saveButton = get<HTMLButtonElement>('#training-save');
  const clearButton = get<HTMLButtonElement>('#training-clear');
  const damaged = get<HTMLDivElement>('#training-damaged');
  const listen = (element: Element, action: () => void): void => element.addEventListener('click', action, { signal });

  let stored: LoadedTemplates = { samples: [], skipped: [] };
  let frozen: SketchDocument = { strokes: [] };
  let busy = false;

  const perLabel = (label: SimplePrimitive): number => stored.samples.filter((s) => s.label === label).length;
  const selectedRows = (): { select: HTMLSelectElement; problem: HTMLElement; stroke: Stroke }[] =>
    Array.from(rows.children, (item, i) => ({
      select: item.querySelector<HTMLSelectElement>('select')!, problem: item.querySelector<HTMLElement>('.training-problem')!, stroke: frozen.strokes[i]!,
    }));

  /** Problems that would stop one stroke from being saved as `label`, in plain words. */
  function problemFor(stroke: Stroke, label: SimplePrimitive): string {
    try {
      decodeUserTemplateSample(encodeUserTemplateSample({ id: 'check', label, createdAt: 0, strokes: [stroke] }));
      userTemplates([{ id: 'check', label, createdAt: 0, strokes: [stroke] }]);
      const rejections = sampleGeometryRejections(label, [stroke]);
      return rejections.length === 0 ? '' : `Not saved: ${rejections.map((r) => problemText[r]).join(' ')}`;
    } catch (error) {
      const message = errorMessage(error);
      return message.includes('complete') ? 'Not saved: this stroke was interrupted. Draw it again.' : `Not saved: ${message}.`;
    }
  }

  function refreshRows(): void {
    const chosen = new Map<SimplePrimitive, number>();
    for (const { select, problem, stroke } of selectedRows()) {
      const label = userTemplateLabels.find((l) => l === select.value);
      if (!label) { problem.textContent = ''; continue; }
      let text = problemFor(stroke, label);
      const total = perLabel(label) + (chosen.get(label) ?? 0) + 1;
      if (!text && total > config.maxUserTemplatesPerLabel) text = `Not saved: at most ${config.maxUserTemplatesPerLabel} samples per shape. Delete one first.`;
      if (!text) chosen.set(label, (chosen.get(label) ?? 0) + 1);
      problem.textContent = text;
    }
    const ready = selectedRows().some(({ select, problem }) => select.value !== '' && problem.textContent === '');
    saveButton.disabled = busy || repository === null || !ready;
  }

  function renderSaved(): void {
    counts.textContent = userTemplateLabels.map((label) => `${labelNames[label]}: ${perLabel(label)} of ${config.maxUserTemplatesPerLabel}`).join(' · ');
    saved.replaceChildren();
    stored.samples.forEach((sample, index) => {
      const item = document.createElement('li');
      item.className = 'training-item';
      const thumbnail = document.createElementNS(ns, 'svg');
      thumbnail.classList.add('training-thumb');
      drawThumbnail(thumbnail, sample.strokes);
      const text = document.createElement('span');
      text.textContent = `${labelNames[sample.label]} · ${new Date(sample.createdAt).toLocaleDateString()}`;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${labelNames[sample.label].toLowerCase()} sample ${index + 1}`);
      remove.addEventListener('click', () => void change(() => repository!.remove([sample.id]), 'Sample deleted.'));
      item.append(thumbnail, text, remove);
      saved.append(item);
    });
    const skipped = stored.skipped;
    damaged.hidden = skipped.length === 0;
    get('#training-damaged-text').textContent = `${skipped.length} stored record${skipped.length === 1 ? ' was' : 's were'} damaged or unusable and ignored.`;
    get('#training-damaged-reasons').replaceChildren(...skipped.map(({ key, reason }) => {
      const item = document.createElement('li'); item.textContent = `${key}: ${reason}`; return item;
    }));
    clearButton.disabled = busy || repository === null || (stored.samples.length === 0 && skipped.length === 0);
  }

  async function reload(): Promise<void> {
    stored = await repository!.load();
    renderSaved();
    refreshRows();
  }

  /** Runs one storage change, then reloads from storage so the list shows what is really saved. */
  async function change(action: () => Promise<void>, success: string): Promise<boolean> {
    if (!repository || busy) return false;
    let ok = false;
    busy = true; saveButton.disabled = true; clearButton.disabled = true;
    try {
      await action();
      status.textContent = success;
      ok = true;
    } catch (error) {
      status.textContent = `Not changed: ${errorMessage(error)}`;
    }
    try { await reload(); } catch (error) { status.textContent = `Could not read personal templates: ${errorMessage(error)}`; }
    busy = false; renderSaved(); refreshRows();
    return ok;
  }

  function renderRows(): void {
    rows.replaceChildren();
    frozen.strokes.forEach((stroke, index) => {
      const item = document.createElement('li');
      item.className = 'training-item';
      const thumbnail = document.createElementNS(ns, 'svg');
      thumbnail.classList.add('training-thumb');
      drawThumbnail(thumbnail, [stroke]);
      const label = document.createElement('label');
      label.append(`Stroke ${index + 1} (${stroke.points.length} samples${stroke.completion === 'complete' ? '' : ', interrupted'}) `);
      const select = document.createElement('select');
      select.name = `stroke-${index + 1}`;
      select.innerHTML = `<option value="">Skip</option>${userTemplateLabels.map((l) => `<option value="${l}">${labelNames[l]}</option>`).join('')}`;
      select.addEventListener('change', refreshRows);
      label.append(select);
      const problem = document.createElement('span');
      problem.className = 'training-problem'; problem.setAttribute('role', 'status');
      item.append(thumbnail, label, problem);
      rows.append(item);
    });
  }

  listen(get('#training-close'), () => dialog.close());
  listen(saveButton, () => {
    const now = Date.now();
    const samples: UserTemplateSample[] = selectedRows().flatMap(({ select, problem, stroke }, i) => {
      const label = userTemplateLabels.find((l) => l === select.value);
      return label && problem.textContent === '' ? [{ id: crypto.randomUUID(), label, createdAt: now + i, strokes: [stroke] }] : [];
    });
    const skipped = selectedRows().filter(({ select, problem }) => select.value !== '' && problem.textContent !== '').length;
    void change(() => repository!.add(samples), `Saved ${samples.length} sample${samples.length === 1 ? '' : 's'}.` +
      (skipped > 0 ? ` ${skipped} labeled stroke${skipped === 1 ? ' was' : 's were'} not saved; see the messages beside them.` : '')).then((ok) => {
      if (!ok) return;
      for (const { select } of selectedRows()) select.value = '';
      refreshRows();
    });
  });
  listen(get('#training-remove-damaged'), () => void change(() => repository!.remove(stored.skipped.map(({ key }) => key)), 'Damaged records removed.'));
  listen(clearButton, () => {
    if (!confirm('Delete all personal samples? Review notes uses only the built-in samples until you train again.')) return;
    void change(() => repository!.clear(), 'All personal samples deleted.');
  });
  listen(button, () => {
    frozen = snapshot();
    status.textContent = '';
    renderRows();
    get('#training-help').textContent = frozen.strokes.length === 0
      ? 'The page is empty. Draw single-stroke examples, then reopen this screen.' : 'Choose a shape for each stroke you want to save. Others stay on Skip.';
    if (!repository) {
      status.textContent = `Personal template storage is unavailable: ${unavailableReason}. Existing storage has not been changed.`;
      stored = { samples: [], skipped: [] };
      renderSaved(); refreshRows();
      for (const select of rows.querySelectorAll('select')) select.disabled = true;
    } else {
      counts.textContent = 'Loading saved samples…';
      saveButton.disabled = true; clearButton.disabled = true;
      void reload().catch((error: unknown) => { status.textContent = `Could not read personal templates: ${errorMessage(error)}`; });
    }
    dialog.showModal();
  });
  dialog.addEventListener('close', () => { frozen = { strokes: [] }; rows.replaceChildren(); saved.replaceChildren(); }, { signal });
  signal.addEventListener('abort', () => dialog.remove(), { once: true });
  button.disabled = false;
}
