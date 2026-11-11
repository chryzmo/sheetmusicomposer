import { config } from '../config';
import type { SketchDocument } from '../model/document';
import { errorMessage } from '../store/autosave';
import { accidentals, durations, timeSignatures } from '../model/music';
import { primitiveLabels } from '../recognize/primitives';
import { serializeFixture } from './schema';
import { strokeIdsFromNumbers } from './annotations';

function options(values: readonly string[]): string {
  return values.map((value) => `<option>${value}</option>`).join('');
}

export function attachFixtureRecorder(
  button: HTMLButtonElement,
  snapshot: () => SketchDocument,
  download: (text: string, filename: string) => void,
  signal: AbortSignal,
): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'fixture-recorder';
  dialog.setAttribute('aria-labelledby', 'fixture-heading');
  dialog.innerHTML = `
    <form>
      <h2 id="fixture-heading">Record fixture</h2>
      <p>Frozen copy of the current page, treated as one measure. No ink is cleared or replaced.
        Stroke numbers follow drawing order; they are converted to original stroke IDs in the file.</p>
      <p>Label every stroke with a primitive or event. Use unknown for ambiguous/unsupported ink.
        Events are optional and listed in musical order; partial measures are allowed.</p>
      <div class="fixture-fields">
        <label>Name <input name="fixture-name" required maxlength="${config.maxFixtureTextLength}" placeholder="quarter-c4-01"></label>
        <label>Fixture set <input name="fixture-set" required maxlength="${config.maxFixtureTextLength}" value="personal"></label>
        <label>Time signature <select name="time-signature">${options(timeSignatures)}</select></label>
        <label>Notes (optional) <textarea name="fixture-notes" maxlength="${config.maxFixtureTextLength}" placeholder="Writing style, uncertainty, or device notes. Avoid personal identifiers."></textarea></label>
      </div>
      <svg class="fixture-preview" role="img" aria-label="Frozen fixture ink with stroke numbers"></svg>
      <ol class="fixture-strokes" aria-label="Recorded strokes"></ol>
      <h3>Expected primitives</h3>
      <div id="fixture-primitives"></div>
      <button type="button" id="add-primitive">Add primitive</button>
      <h3>Expected notes and rests (optional)</h3>
      <p>Pitch uses written letter and octave, e.g. C4 (middle C); use the accidental field for sharps/flats.</p>
      <div id="fixture-events"></div>
      <button type="button" id="add-event">Add note/rest</button>
      <output id="fixture-status" role="status"></output>
      <div class="tools fixture-actions">
        <button type="submit">Download fixture</button>
        <button type="button" id="close-fixture">Close</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const get = <T extends Element>(selector: string): T => {
    const element = dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing fixture control: ${selector}`);
    return element;
  };
  const value = (root: Element, name: string): string => {
    const field = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
    if (!field) throw new Error(`Missing fixture field: ${name}`);
    return field.value;
  };
  const status = get<HTMLOutputElement>('#fixture-status');
  const primitives = get<HTMLDivElement>('#fixture-primitives');
  const events = get<HTMLDivElement>('#fixture-events');
  let frozen: SketchDocument = { strokes: [] };
  const listen = (element: Element, action: () => void): void => element.addEventListener('click', action, { signal });
  function addRow(container: HTMLElement, kind: 'primitive' | 'event'): HTMLElement {
    const row = document.createElement('fieldset');
    row.className = 'fixture-row';
    row.innerHTML = kind === 'primitive'
      ? `<legend>Primitive</legend><label>Label <select name="label">${options(primitiveLabels)}</select></label>`
      : `<legend>Note/rest</legend>
        <label>Kind <select name="kind"><option value="note">Note</option><option value="rest">Rest</option></select></label>
        <label class="note-field">Pitch <input name="pitch" value="C4" pattern="[A-Ga-g][0-9]" required size="3"></label>
        <label class="note-field">Accidental <select name="accidental"><option value="">None</option>${options(accidentals)}</select></label>
        <label>Duration <select name="duration">${options(durations)}</select></label>
        <label>Dots <select name="dots">${options(Array.from({ length: config.maxFixtureDots + 1 }, (_, i) => String(i)))}</select></label>`;
    row.insertAdjacentHTML('beforeend', '<label>Stroke numbers <input name="strokes" required placeholder="1,2"></label><button type="button">Remove</button>');
    // Row listeners live on the row, not the long-lived AbortSignal: closing a
    // recording must release its detached rows and any large frozen document.
    row.querySelector('button')!.addEventListener('click', () => row.remove());
    const kindSelect = row.querySelector<HTMLSelectElement>('[name="kind"]');
    if (kindSelect) {
      row.querySelector<HTMLSelectElement>('[name="duration"]')!.value = 'quarter';
      kindSelect.addEventListener('change', () => {
        const isRest = kindSelect.value === 'rest';
        row.querySelectorAll<HTMLElement>('.note-field').forEach((field) => { field.hidden = isRest; });
        row.querySelector<HTMLInputElement>('[name="pitch"]')!.disabled = isRest;
      });
    }
    container.append(row);
    return row;
  }
  listen(get('#add-primitive'), () => addRow(primitives, 'primitive'));
  listen(get('#add-event'), () => addRow(events, 'event'));
  listen(get('#close-fixture'), () => dialog.close());
  listen(button, () => {
    frozen = snapshot();
    get<HTMLFormElement>('form').reset();
    primitives.replaceChildren();
    events.replaceChildren();
    status.textContent = '';
    const list = get<HTMLOListElement>('.fixture-strokes');
    list.replaceChildren();
    frozen.strokes.forEach((stroke) => {
      const item = document.createElement('li');
      item.textContent = `${stroke.points.length} samples · ${stroke.completion} · ${stroke.id}`;
      list.append(item);
    });
    preview(get<SVGSVGElement>('svg'), frozen);
    if (frozen.strokes.length > 0) {
      const row = addRow(primitives, 'primitive');
      row.querySelector<HTMLSelectElement>('[name="label"]')!.value = 'unknown';
      row.querySelector<HTMLInputElement>('[name="strokes"]')!.value = frozen.strokes.map((_, i) => i + 1).join(',');
    } else {
      status.textContent = 'Draw one measure first, then reopen Record fixture.';
    }
    get<HTMLButtonElement>('[type="submit"]').disabled = frozen.strokes.length === 0;
    dialog.showModal();
  });
  get<HTMLFormElement>('form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const strokeIds = (row: Element): string[] => strokeIdsFromNumbers(value(row, 'strokes'), frozen);
      const expectedPrimitives = Array.from(primitives.children, (row) => ({ label: value(row, 'label'), strokeIds: strokeIds(row) }));
      const expectedEvents = Array.from(events.children, (row) => {
        const base = { kind: value(row, 'kind'), duration: value(row, 'duration'), dots: Number(value(row, 'dots')), strokeIds: strokeIds(row) };
        if (base.kind === 'rest') return base;
        const pitch = value(row, 'pitch').toUpperCase();
        return { ...base, pitch: { step: pitch[0], octave: Number(pitch.slice(1)) }, accidental: value(row, 'accidental') || null };
      });
      const name = value(dialog, 'fixture-name');
      const text = serializeFixture({
        format: 'sheetmusicomposer-fixture', version: 1, name, set: value(dialog, 'fixture-set'), notes: value(dialog, 'fixture-notes'), provenance: 'recorded',
        staff: { units: 'staff-space', lineYs: [0, 1, 2, 3, 4], width: config.staffWidth, clef: 'treble', timeSignature: value(dialog, 'time-signature') },
        document: frozen, expected: { primitives: expectedPrimitives, events: expectedEvents },
      });
      const filename = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'recorded';
      download(text, `fixture-${filename}.json`);
      status.textContent = 'Fixture download requested. Keep the JSON file and add it to fixtures/ after review. This is not a recognition result.';
    } catch (error) {
      status.textContent = `Fixture not exported: ${errorMessage(error)}`;
    }
  }, { signal });
  dialog.addEventListener('close', () => {
    frozen = { strokes: [] };
    primitives.replaceChildren();
    events.replaceChildren();
    get('.fixture-strokes').replaceChildren();
    get('svg').replaceChildren();
  }, { signal });
  signal.addEventListener('abort', () => dialog.remove(), { once: true });
  button.disabled = false;
}

function preview(svg: SVGSVGElement, document: SketchDocument): void {
  const ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  let minX = 0, minY = 0, maxY = 4;
  let maxX: number = config.staffWidth;
  for (const stroke of document.strokes) for (const point of stroke.points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  svg.setAttribute('viewBox', `${minX - 1} ${minY - 1} ${maxX - minX + 2} ${maxY - minY + 3}`);
  for (let y = 0; y < 5; y++) {
    const line = window.document.createElementNS(ns, 'line');
    for (const [key, value] of Object.entries({ x1: 0, x2: config.staffWidth, y1: y, y2: y, stroke: '#aaa', 'stroke-width': 0.04 })) line.setAttribute(key, String(value));
    svg.append(line);
  }
  document.strokes.forEach((stroke, index) => {
    const path = window.document.createElementNS(ns, 'polyline');
    const points = stroke.points.map((point) => `${point.x},${point.y}`);
    // A repeated endpoint makes single-point taps visible with a round linecap.
    if (points.length === 1) points.push(points[0]!);
    path.setAttribute('points', points.join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#26352f');
    path.setAttribute('stroke-width', String(config.inkWidth));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    const first = stroke.points[0];
    if (!first) return;
    const label = window.document.createElementNS(ns, 'text');
    label.setAttribute('x', String(first.x + 0.2));
    label.setAttribute('y', String(first.y - 0.2));
    label.setAttribute('font-size', '0.8');
    label.setAttribute('fill', '#b12e21');
    label.textContent = String(index + 1);
    svg.append(label);
  });
}
