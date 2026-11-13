import { config } from './config';
import { pitchName } from './edit/note-anchors';
import { reviewDuration } from './render/notation-model';
import { historyShortcut } from './edit/shortcuts';
import { attachFixtureRecorder } from './fixtures/recorder';
import { attachQuickLabel } from './fixtures/quick-label-dialog';
import { attachInkSurface } from './ink/surface';
import { createDocument } from './model/document';
import { attachNoteReview } from './render/review-dialog';
import { attachTemplateTraining } from './training/dialog';
import type { NoteReviewUi } from './render/review-dialog';
import { createAutosave, errorMessage } from './store/autosave';
import type { SaveState } from './store/autosave';
import { openSketchRepository } from './store/indexeddb';
import type { SketchRepository } from './store/indexeddb';
import { openTemplateRepository } from './store/template-store';
import type { TemplateRepository } from './store/template-store';
import { parseBackup, serializeBackup } from './store/schema';
import './style.css';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>('#score');
const status = required<HTMLOutputElement>('#ink-status');
const musicStatus = required<HTMLOutputElement>('#music-status');
let noteReview: NoteReviewUi | null = null;
const saveStatus = required<HTMLOutputElement>('#save-status');
const undoButton = required<HTMLButtonElement>('#undo');
const redoButton = required<HTMLButtonElement>('#redo');
const fitButton = required<HTMLButtonElement>('#fit-staff');
const newButton = required<HTMLButtonElement>('#new-page');
const downloadButton = required<HTMLButtonElement>('#download');
const restoreButton = required<HTMLButtonElement>('#restore');
const retryButton = required<HTMLButtonElement>('#retry-save');
const fileInput = required<HTMLInputElement>('#backup-file');
const backupStatus = required<HTMLOutputElement>('#backup-status');
const keepButton = required<HTMLButtonElement>('#keep-storage');
const storageNote = required<HTMLOutputElement>('#storage-note');
const events = new AbortController();
const options = { signal: events.signal };
let disposed = false;

// Bounded, opt-in local diagnostics, never per-move DOM work or telemetry.
const debug = new URLSearchParams(location.search).has('debugInk');
const panel = document.createElement('pre');
const messages: string[] = [];
const diagnose = (message: string): void => {
  if (!debug || disposed) return;
  messages.push(`${performance.now().toFixed(0)}ms ${message}`);
  if (messages.length > 24) messages.shift();
  panel.textContent = messages.join('\n');
};
if (debug) {
  panel.id = 'ink-debug';
  panel.setAttribute('aria-label', 'Ink input diagnostics');
  document.querySelector('footer')?.append(panel);
  diagnose(`secure=${window.isSecureContext} uuid=${typeof crypto.randomUUID} pointerEvents=${'PointerEvent' in window}`);
  window.addEventListener('error', (event) => diagnose(`ERROR: ${event.message}`), options);
}

let repository: SketchRepository | null = null;
let initialDocument = createDocument();
let revision = 0;
let loadError = '';
try {
  repository = await openSketchRepository();
  const stored = await repository.load();
  if (stored) { initialDocument = stored.document; revision = stored.revision; }
} catch (error) {
  // Fail closed: allow in-memory drawing and backup, but never overwrite an
  // unreadable/unsupported saved document with a new empty one.
  loadError = errorMessage(error);
  repository?.close();
  repository = null;
}

// Templates fail independently of the sketch: if they cannot open, drawing,
// saving, and review still work (on the built-in samples).
let templateRepository: TemplateRepository | null = null;
let templateError = '';
try { templateRepository = await openTemplateRepository(); } catch (error) { templateError = errorMessage(error); }

const musicNotice = ' Musical data is preserved. The canvas displays original ink only; Review notes is an experimental re-read, not a display of stored score corrections. New ink clears saved note/rest events; Undo restores them.';
if (initialDocument.measures !== undefined) backupStatus.textContent = `Musical backup loaded.${musicNotice}`;

let saveState: SaveState = { kind: 'saved' };
let isDrawing = false;
let lastDocument = initialDocument;
let changed = false;
const showSaveStatus = (): void => {
  if (disposed) return;
  retryButton.hidden = saveState.kind !== 'error' || repository === null;
  if (loadError) {
    saveStatus.textContent = `Storage unavailable: ${loadError}. Drawing is memory-only; download a backup before leaving. Existing storage has not been changed.`;
  } else if (saveState.kind === 'error') {
    saveStatus.textContent = `Not saved: ${saveState.message}. Download a backup, or retry saving.`;
  } else if (isDrawing) {
    saveStatus.textContent = 'Drawing — current stroke not saved yet';
  } else if (saveState.kind === 'saving') {
    saveStatus.textContent = 'Saving…';
  } else {
    saveStatus.textContent = revision > 0 ? 'Saved on this device' : 'Ready — no saved sketch yet';
  }
};
const store = repository;
const autosave = store ? createAutosave(async (document: typeof initialDocument) => {
  revision = await store.save(document, revision);
}, (state) => { saveState = state; showSaveStatus(); }) : null;

const surface = attachInkSurface(canvas, ({ document, strokeCount, canUndo, canRedo, isDrawing: drawing }) => {
  if (disposed) return;
  isDrawing = drawing;
  status.textContent = `${strokeCount} ${strokeCount === 1 ? 'stroke' : 'strokes'}`;
  undoButton.disabled = !canUndo;
  redoButton.disabled = !canRedo;
  if (document !== lastDocument) {
    changed = true;
    lastDocument = document;
    autosave?.enqueue(document);
  }
  musicStatus.textContent = document.measures === undefined ? '' : `Music: ${document.measures.reduce((n, m) => n + m.events.length, 0)} events in document; ${document.measures.reduce((n, m) => n + m.unresolvedStrokeIds.length, 0)} unresolved assigned strokes. Canvas retains original ink.`;
  noteReview?.update({ document, isDrawing: drawing });
  showSaveStatus();
}, diagnose, initialDocument, {
  onNoteMoved: ({ from, to }) => {
    backupStatus.textContent = `Moved a note from ${pitchName(from)} to ${pitchName(to)}. Undo reverses this step. Original ink is unchanged.`;
  },
  onDurationChanged: ({ pitch, from, to }) => {
    const measure = surface.currentDocument().measures?.[0];
    const total = measure && reviewDuration(measure.events.map((e) => e.duration), measure.timeSignature);
    // Report, never repair: the user decides how to fix an over/underfull measure.
    const state = !total ? '' : total.units > total.target ? 'overfull' : total.units < total.target ? 'underfull' : 'full';
    const fit = measure && total ? ` Measure is ${state}: ${total.units} of ${total.target} quarter-note units in ${measure.timeSignature}.` : '';
    backupStatus.textContent = `Changed the ${pitchName(pitch)} note from ${from} to ${to}. Undo reverses this step.${fit}`;
  },
});
noteReview = attachNoteReview(required<HTMLButtonElement>('#review-notes'), surface, (notes, unresolved) => {
  backupStatus.textContent = `Review kept ${notes} note${notes === 1 ? '' : 's'} with ${unresolved} unresolved stroke${unresolved === 1 ? '' : 's'}. All raw ink is preserved. Undo reverses this step; new ink invalidates music.`;
}, events.signal, { load: templateRepository ? () => templateRepository!.load() : null, unavailableReason: templateError });
attachTemplateTraining(required<HTMLButtonElement>('#train-templates'), surface.snapshot, templateRepository, templateError, events.signal);
canvas.setAttribute('aria-disabled', 'false');
fitButton.disabled = false;
newButton.disabled = false;
downloadButton.disabled = false;
restoreButton.disabled = false;

newButton.addEventListener('click', () => {
  if ((isDrawing || lastDocument.strokes.length > 0 || (lastDocument.measures?.length ?? 0) > 0) &&
      !confirm('Start a new page? This clears the current sketch. Download a backup first to keep a separate copy. You can Undo until reload.')) return;
  backupStatus.textContent = '';
  surface.newPage();
}, options);
fitButton.addEventListener('click', surface.fitStaff, options);
undoButton.addEventListener('click', surface.undo, options);
redoButton.addEventListener('click', surface.redo, options);
retryButton.addEventListener('click', () => autosave?.retry(), options);
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, dialog[open]'))) return;
  const action = historyShortcut(event);
  if (!action) return;
  event.preventDefault();
  surface[action]();
}, options);

const urls = new Set<string>();
function downloadJson(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  urls.add(url);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Allow iPad's download UI time to consume the URL; keys/storage never leave
  // the browser. A downloaded backup is independent of IndexedDB and its origin.
  setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 60000);
}
attachFixtureRecorder(required<HTMLButtonElement>('#record-fixture'), surface.snapshot, downloadJson, events.signal);
attachQuickLabel(required<HTMLButtonElement>('#label-measure'), surface.snapshot, downloadJson, events.signal);
downloadButton.addEventListener('click', () => {
  const current = surface.snapshot();
  const text = serializeBackup(current);
  const exceedsImportLimits = new Blob([text]).size > config.maxBackupBytes ||
    current.strokes.length > config.maxStoredStrokes ||
    current.strokes.reduce((total, stroke) => total + stroke.points.length, 0) > config.maxStoredPoints;
  downloadJson(text, `sheetmusicomposer-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  backupStatus.textContent = exceedsImportLimits
    ? 'Full backup download requested, but it exceeds this build’s import safety limits. Keep the file; raise the corresponding configured limits before restoring it.'
    : 'Backup download requested. Keep the JSON file somewhere safe.';
}, options);
restoreButton.addEventListener('click', () => fileInput.click(), options);
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  restoreButton.disabled = true;
  // Do not let a slow file read unexpectedly replace a newly started page.
  newButton.disabled = true;
  void (async () => {
    try {
      if (file.size > config.maxBackupBytes) throw new Error('Backup exceeds the 10 MiB import limit');
      const restored = parseBackup(await file.text());
      if (disposed) return;
      if ((lastDocument.strokes.length > 0 || (lastDocument.measures?.length ?? 0) > 0) && !confirm('Replace the current sketch with this backup? You can Undo this restore.')) {
        backupStatus.textContent = 'Restore canceled. Current sketch unchanged.';
        return;
      }
      surface.restore(restored);
      backupStatus.textContent = 'Backup restored. Undo returns to the previous sketch.' + (restored.measures === undefined ? '' : musicNotice);
    } catch (error) {
      if (!disposed) backupStatus.textContent = `Restore failed: ${errorMessage(error)}. Current sketch unchanged.`;
    } finally {
      if (!disposed) {
        restoreButton.disabled = false;
        newButton.disabled = false;
      }
    }
  })();
}, options);

keepButton.hidden = typeof navigator.storage?.persist !== 'function';
keepButton.addEventListener('click', () => {
  keepButton.disabled = true;
  void navigator.storage.persist().then((granted) => {
    if (!disposed) storageNote.textContent = granted
      ? 'Persistent storage granted. Clearing website data can still delete sketches; keep backups.'
      : 'Persistent storage not granted. Keep downloaded backups in case browser data is evicted.';
  }).catch(() => {
    if (!disposed) storageNote.textContent = 'Could not request persistent storage. Keep downloaded backups.';
  }).finally(() => { if (!disposed) keepButton.disabled = false; });
}, options);

const flush = (): void => { surface.snapshot(); void autosave?.flush(); };
window.addEventListener('pagehide', flush, options);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); }, options);
window.addEventListener('beforeunload', (event) => {
  if (isDrawing || saveState.kind !== 'saved' || (loadError && changed)) {
    event.preventDefault();
    event.returnValue = '';
  }
}, options);

if (import.meta.hot) import.meta.hot.dispose(() => {
  surface.dispose();
  disposed = true;
  events.abort();
  panel.remove();
  for (const url of urls) URL.revokeObjectURL(url);
  templateRepository?.close();
  void autosave?.flush().then(() => store?.close());
  if (!autosave) store?.close();
});
