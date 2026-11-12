import { config } from '../config';
import type { SketchDocument } from '../model/document';
import { timeSignatures } from '../model/music';
import { staffYFromPitch } from '../staff/pitch';
import { errorMessage } from '../store/autosave';
import { headCenter, nearestStroke, nudgePitch, suggestPitch, toExpected } from './quick-label';
import type { QuickDuration, QuickNote } from './quick-label';
import { serializeFixture } from './schema';

const ns = 'http://www.w3.org/2000/svg';
const colors = { unlabeled: '#b12e21', selected: '#1d5fa8', labeled: '#2c7663' };
const durationNames: Readonly<Record<QuickDuration, string>> = { whole: 'whole', half: 'half', quarter: 'quarter' };

type Stage = { kind: 'head' } | { kind: 'stem'; headIds: readonly string[]; duration: QuickDuration };

/** Label a FREE-DRAWN measure by tapping, producing a test fixture. Nothing is
 * recognized: the user taps each note's head (and stem) and picks its length, and
 * confirms or nudges the suggested pitch. Unlabeled ink is saved as unknown. The
 * sketch is never changed. Labels are the user's intent, not recognizer output.
 */
export function attachQuickLabel(
  button: HTMLButtonElement, snapshot: () => SketchDocument,
  download: (text: string, filename: string) => void, signal: AbortSignal,
): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'quick-label';
  dialog.setAttribute('aria-labelledby', 'quick-heading');
  dialog.innerHTML = `
    <h2 id="quick-heading">Label a test measure</h2>
    <p>For a measure you wrote freely. Tap each note's head, choose its length, then tap its stem. Nothing is recognized here: what you tap is the answer key.
      Red ink is not part of any note and is saved as unknown ink. A copy of the page is labeled; the sketch is not changed.</p>
    <p id="quick-prompt" class="guided-prompt" aria-live="polite"></p>
    <svg class="quick-preview" aria-label="Tap strokes to label them"></svg>
    <div class="tools quick-durations" role="group" aria-label="Note length">
      <button type="button" data-duration="whole" disabled>Whole</button>
      <button type="button" data-duration="half" disabled>Half</button>
      <button type="button" data-duration="quarter" disabled>Quarter</button>
      <button type="button" id="quick-cancel-note" disabled>Cancel this note</button>
    </div>
    <output id="quick-status" role="status"></output>
    <h3>Notes</h3>
    <p>Listed left to right. The pitch is where the head sits, using the same rule as recognition, so check each one and nudge it if you meant a different note.</p>
    <ol id="quick-notes" class="training-list" aria-label="Labeled notes"></ol>
    <div class="fixture-fields">
      <label>Name <input name="quick-name" required maxlength="200"></label>
      <label>Fixture set <input name="quick-set" required maxlength="${config.maxFixtureTextLength}" value="personal"></label>
      <label>Time signature <select name="quick-time">${timeSignatures.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label>Notes (optional) <textarea name="quick-notes-text" maxlength="1000" placeholder="Anything worth knowing about how this was written."></textarea></label>
    </div>
    <div class="tools fixture-actions">
      <button type="button" id="quick-download" disabled>Download fixture</button>
      <button type="button" id="quick-close">Close</button>
    </div>`;
  document.body.append(dialog);
  const get = <T extends Element>(selector: string): T => {
    const element = dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing label control: ${selector}`);
    return element;
  };
  const field = (name: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
    const element = dialog.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
    if (!element) throw new Error(`Missing label field: ${name}`);
    return element;
  };
  const svg = get<SVGSVGElement>('.quick-preview'), prompt = get<HTMLParagraphElement>('#quick-prompt');
  const status = get<HTMLOutputElement>('#quick-status'), list = get<HTMLOListElement>('#quick-notes');
  const durationButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-duration]'));
  const cancelButton = get<HTMLButtonElement>('#quick-cancel-note'), downloadButton = get<HTMLButtonElement>('#quick-download');
  const listen = (element: Element, action: () => void): void => element.addEventListener('click', action, { signal });

  let frozen: SketchDocument = { strokes: [] };
  let notes: QuickNote[] = [], selection: string[] = [], stage: Stage = { kind: 'head' }, nextId = 1;

  const strokeById = (id: string) => frozen.strokes.find((s) => s.id === id)!;
  const number = (id: string): number => frozen.strokes.findIndex((s) => s.id === id) + 1;
  const sorted = (): QuickNote[] => [...notes].sort((a, b) => headCenter(a.headStrokeIds.map(strokeById)).x - headCenter(b.headStrokeIds.map(strokeById)).x);
  const owner = (id: string): number => sorted().findIndex((n) => n.headStrokeIds.includes(id) || n.stemStrokeId === id) + 1;
  const pitchName = (n: QuickNote): string => `${n.pitch.step}${n.pitch.octave}`;

  function drawSvg(): void {
    svg.replaceChildren();
    const order = sorted();
    let minX = 0, maxX: number = config.staffWidth, minY = -1, maxY = 5;
    for (const stroke of frozen.strokes) for (const p of stroke.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    for (const n of notes) { const y = staffYFromPitch(n.pitch); minY = Math.min(minY, y - 1); maxY = Math.max(maxY, y + 1); }
    svg.setAttribute('viewBox', `${minX - 1} ${minY - 1} ${maxX - minX + 2} ${maxY - minY + 2}`);
    const add = (tag: string, attrs: Record<string, string | number>, text?: string): SVGElement => {
      const element = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
      if (text !== undefined) element.textContent = text;
      svg.append(element);
      return element;
    };
    for (let y = 0; y < 5; y++) add('line', { x1: 0, x2: config.staffWidth, y1: y, y2: y, stroke: '#aaa', 'stroke-width': 0.04 });
    const assigned = new Set(notes.flatMap((n) => [...n.headStrokeIds, ...(n.stemStrokeId ? [n.stemStrokeId] : [])]));
    const chosen = new Set(stage.kind === 'stem' ? [...stage.headIds] : selection);
    frozen.strokes.forEach((stroke, index) => {
      const points = stroke.points.map((p) => `${p.x},${p.y}`);
      if (points.length === 1) points.push(points[0]!);
      add('polyline', { points: points.join(' '), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': config.inkWidth * 1.5,
        stroke: chosen.has(stroke.id) ? colors.selected : assigned.has(stroke.id) ? colors.labeled : colors.unlabeled, 'data-stroke-number': index + 1 });
    });
    order.forEach((n, i) => {
      const center = headCenter(n.headStrokeIds.map(strokeById));
      add('line', { class: 'quick-pitch', x1: center.x - 0.9, x2: center.x + 0.9, y1: staffYFromPitch(n.pitch), y2: staffYFromPitch(n.pitch), stroke: colors.labeled, 'stroke-width': 0.1, 'stroke-dasharray': '0.25 0.15' });
      add('text', { x: center.x - 0.6, y: Math.min(center.y, staffYFromPitch(n.pitch)) - 1.1, 'font-size': 0.8, fill: colors.labeled, 'font-weight': 700 }, `${i + 1}: ${pitchName(n)}`);
    });
  }

  function renderList(): void {
    list.replaceChildren();
    sorted().forEach((n, i) => {
      const item = document.createElement('li');
      item.className = 'training-item';
      const text = document.createElement('span');
      text.textContent = `Note ${i + 1}: ${pitchName(n)} ${durationNames[n.duration]} (strokes ${[...n.headStrokeIds, ...(n.stemStrokeId ? [n.stemStrokeId] : [])].map(number).join(', ')})`;
      const button = (label: string, aria: string, action: () => void): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button'; element.textContent = label; element.setAttribute('aria-label', `${aria} of note ${i + 1}`);
        element.addEventListener('click', action);
        return element;
      };
      const move = (steps: number): void => {
        const pitch = nudgePitch(n.pitch, steps);
        if (!pitch) { status.textContent = 'That is outside the supported range (C0 to B9).'; return; }
        notes = notes.map((other) => other.id === n.id ? { ...other, pitch } : other);
        status.textContent = `Note ${i + 1} is now ${pitch.step}${pitch.octave}.`;
        render();
      };
      item.append(text, button('Pitch up', 'Raise the pitch', () => move(1)), button('Pitch down', 'Lower the pitch', () => move(-1)),
        button('Remove', 'Remove', () => { notes = notes.filter((other) => other.id !== n.id); status.textContent = `Note ${i + 1} removed; its strokes are unlabeled again.`; render(); }));
      list.append(item);
    });
  }

  function render(): void {
    drawSvg(); renderList();
    const unlabeled = frozen.strokes.length - notes.reduce((sum, n) => sum + n.headStrokeIds.length + (n.stemStrokeId ? 1 : 0), 0);
    if (stage.kind === 'stem') prompt.textContent = `Now tap the stem of this ${durationNames[stage.duration]} note.`;
    else prompt.textContent = selection.length === 0 ? 'Tap the head of a note (tap more strokes if the head has several).'
      : `${selection.length} head stroke${selection.length === 1 ? '' : 's'} selected. Choose the note length.`;
    for (const b of durationButtons) b.disabled = !(stage.kind === 'head' && selection.length > 0);
    cancelButton.disabled = stage.kind === 'head' && selection.length === 0;
    downloadButton.disabled = notes.length === 0;
    get('#quick-notes').setAttribute('data-count', String(notes.length));
    if (frozen.strokes.length > 0 && stage.kind === 'head' && selection.length === 0) {
      const base = `${notes.length} note${notes.length === 1 ? '' : 's'} labeled; ${unlabeled} stroke${unlabeled === 1 ? '' : 's'} will be saved as unknown ink.`;
      prompt.textContent += ` ${base}`;
    }
  }

  function finish(duration: QuickDuration, headIds: readonly string[], stemId: string | null): void {
    const pitch = suggestPitch(headIds.map(strokeById));
    if (!pitch) { status.textContent = 'That head is outside the supported pitch range (C0 to B9), so it was not added.'; return; }
    notes = [...notes, { id: `q${nextId++}`, duration, headStrokeIds: headIds, stemStrokeId: stemId, pitch }];
    selection = []; stage = { kind: 'head' };
    const added = notes.at(-1)!;
    status.textContent = `Added a ${durationNames[duration]} note at ${pitchName(added)}. Check its pitch in the list.`;
    render();
  }

  svg.addEventListener('click', (event) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    // Prefer ink that is not yet part of a note or this selection, so adjacent or overlapping strokes stay reachable.
    const avoid = new Set([...notes.flatMap((n) => [...n.headStrokeIds, ...(n.stemStrokeId ? [n.stemStrokeId] : [])]),
      ...selection, ...(stage.kind === 'stem' ? stage.headIds : [])]);
    const id = nearestStroke(frozen.strokes, point.x, point.y, config.quickLabelTapDistance, avoid);
    if (!id) { status.textContent = 'No stroke is near that point. Tap on the ink.'; return; }
    const taken = owner(id);
    if (taken > 0) { status.textContent = `Stroke ${number(id)} is already part of note ${taken}. Remove that note first to relabel it.`; return; }
    if (stage.kind === 'stem') {
      if (stage.headIds.includes(id)) { status.textContent = `Stroke ${number(id)} is the head. Tap the stem.`; return; }
      finish(stage.duration, stage.headIds, id);
      return;
    }
    selection = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
    status.textContent = `Stroke ${number(id)} ${selection.includes(id) ? 'selected' : 'deselected'}.`;
    render();
  }, { signal });

  for (const b of durationButtons) b.addEventListener('click', () => {
    const duration = b.dataset.duration as QuickDuration;
    if (stage.kind !== 'head' || selection.length === 0) return;
    if (duration === 'whole') finish('whole', selection, null);
    else { stage = { kind: 'stem', headIds: selection, duration }; status.textContent = ''; render(); }
  }, { signal });
  listen(cancelButton, () => { selection = []; stage = { kind: 'head' }; status.textContent = 'Note canceled.'; render(); });
  listen(get('#quick-close'), () => dialog.close());
  listen(downloadButton, () => {
    try {
      const name = field('quick-name').value.trim();
      if (!name) throw new Error('Enter a name');
      const labels = toExpected(frozen.strokes, notes);
      const extra = field('quick-notes-text').value.trim();
      const text = serializeFixture({
        format: 'sheetmusicomposer-fixture', version: 1, name, set: field('quick-set').value, provenance: 'recorded',
        notes: `Free-drawn measure labeled by tapping; pitch suggested from head position, confirmed or adjusted by the labeler.${extra ? ` ${extra}` : ''}`,
        staff: { units: 'staff-space', lineYs: [0, 1, 2, 3, 4], width: config.staffWidth, clef: 'treble', timeSignature: field('quick-time').value },
        // Truth is what the user tapped and confirmed. Saved model events and
        // recognition output are never used as expected results.
        document: { strokes: frozen.strokes }, expected: labels,
      });
      const filename = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'free-measure';
      download(text, `fixture-${filename}.json`);
      status.textContent = 'Fixture download requested. Keep the JSON file and add it to fixtures/ after review. This is your labeling, not a recognition result.';
    } catch (error) {
      status.textContent = `Fixture not exported: ${errorMessage(error)}`;
    }
  });
  listen(button, () => {
    frozen = snapshot();
    notes = []; selection = []; stage = { kind: 'head' }; nextId = 1; status.textContent = '';
    const now = new Date(), pad = (n: number): string => String(n).padStart(2, '0');
    field('quick-name').value = `free-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    field('quick-notes-text').value = '';
    if (frozen.strokes.length === 0) status.textContent = 'Draw a measure first, then reopen this screen.';
    render();
    dialog.showModal();
  });
  dialog.addEventListener('close', () => { frozen = { strokes: [] }; notes = []; selection = []; svg.replaceChildren(); list.replaceChildren(); }, { signal });
  signal.addEventListener('abort', () => dialog.remove(), { once: true });
  button.disabled = false;
}
