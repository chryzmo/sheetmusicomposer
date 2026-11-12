import { config } from '../config';
import { attachInkSurface } from '../ink/surface';
import type { InkSurface, InkSurfaceStatus } from '../ink/surface';
import type { Stroke } from '../ink/types';
import type { SimplePrimitive } from '../recognize/primitives';
import { userTemplateLabels } from '../recognize/user-templates';
import { errorMessage } from '../store/autosave';
import type { TemplateRepository } from '../store/template-store';
import { buildScript, nextPrompt, shapeProgress } from './script';
import type { Prompt } from './script';
import { labelNames, sampleProblem } from './validate';

const promptsPerShape = 8;

export interface GuidedTraining { open: () => void }

interface Entry { readonly label: SimplePrimitive | null; sampleId: string | null; promptIndex: number }

/** Guided shape training. The app names what to draw, so every stroke is labeled
 * by its prompt and nothing is annotated afterwards. Strokes go on the trainer's
 * own canvas (never the sketch) and are saved one at a time under the same
 * rules as the Personal templates screen. Labels are what the user was asked to
 * draw, never recognizer output.
 */
export function attachGuidedTraining(repository: TemplateRepository | null, onClosed: () => void, signal: AbortSignal): GuidedTraining {
  const dialog = document.createElement('dialog');
  dialog.id = 'guided-training';
  dialog.setAttribute('aria-labelledby', 'guided-heading');
  dialog.innerHTML = `
    <h2 id="guided-heading">Guided training</h2>
    <p>Draw what each prompt asks for on the staff below. Each stroke is saved as a personal sample for the shape in the prompt, so there is nothing to label afterwards.
      A stroke that does not look like that shape is not saved, and says why. Samples are used by Review notes. Vary your hand as the prompts suggest: your own music will not look like careful copying.</p>
    <p id="guided-prompt" class="guided-prompt" aria-live="polite"></p>
    <p id="guided-progress"></p>
    <div class="guided-workspace"><canvas id="guided-canvas" aria-label="Training ink surface" aria-describedby="guided-prompt" aria-disabled="true"></canvas></div>
    <output id="guided-status" role="status"></output>
    <p id="guided-counts"></p>
    <div class="tools guided-actions">
      <button type="button" id="guided-undo" disabled>Undo last</button>
      <button type="button" id="guided-skip" disabled>Skip this prompt</button>
      <button type="button" id="guided-clear" disabled>Clear drawing area</button>
      <button type="button" id="guided-again" hidden>Another round</button>
      <button type="button" id="guided-done">Done</button>
    </div>`;
  document.body.append(dialog);
  const get = <T extends Element>(selector: string): T => {
    const element = dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing guided control: ${selector}`);
    return element;
  };
  const promptText = get<HTMLParagraphElement>('#guided-prompt'), progress = get<HTMLParagraphElement>('#guided-progress');
  const statusText = get<HTMLOutputElement>('#guided-status'), countsText = get<HTMLParagraphElement>('#guided-counts');
  const undoButton = get<HTMLButtonElement>('#guided-undo'), skipButton = get<HTMLButtonElement>('#guided-skip');
  const clearButton = get<HTMLButtonElement>('#guided-clear'), againButton = get<HTMLButtonElement>('#guided-again');
  const canvas = get<HTMLCanvasElement>('#guided-canvas');
  const listen = (element: Element, action: () => void): void => element.addEventListener('click', action, { signal });

  let surface: InkSurface | null = null;
  let script: Prompt[] = [], index: number | null = 0, round = 0, savedThisSession = 0;
  let counts: Record<SimplePrimitive, number> = { noteheadFilled: 0, noteheadHollow: 0, stem: 0 };
  let entries: Entry[] = [];
  let handled = 0, pending = 0, drawing = false;
  let queue: Promise<void> = Promise.resolve();

  const render = (): void => {
    const prompt = index === null ? null : script[index];
    if (prompt) {
      promptText.textContent = `Draw a ${labelNames[prompt.label].toLowerCase()}. ${prompt.hint}`;
      const { current, total } = shapeProgress(script, index!, prompt.label);
      progress.textContent = `${labelNames[prompt.label]} ${current} of ${total} in this round · ${savedThisSession} saved this session`;
    } else {
      const full = userTemplateLabels.every((label) => counts[label] >= config.maxUserTemplatesPerLabel);
      promptText.textContent = full ? 'Every shape is at its limit. Delete some samples to add more.' : 'This round is finished. Start another round for more variety, or press Done.';
      progress.textContent = `${savedThisSession} saved this session`;
    }
    countsText.textContent = 'Saved so far: ' + userTemplateLabels.map((label) => `${labelNames[label]} ${counts[label]} of ${config.maxUserTemplatesPerLabel}`).join(' · ');
    const busy = pending > 0 || repository === null;
    undoButton.disabled = busy || entries.length === 0;
    skipButton.disabled = busy || index === null;
    clearButton.disabled = busy || entries.length === 0;
    againButton.hidden = index !== null || userTemplateLabels.every((label) => counts[label] >= config.maxUserTemplatesPerLabel);
  };

  async function process(stroke: Stroke, entry: Entry): Promise<void> {
    const prompt = index === null ? null : script[index];
    if (!repository || !prompt) { statusText.textContent = 'Nothing was asked for, so this stroke was not saved. Start another round, or press Undo last.'; return; }
    const problem = sampleProblem(stroke, prompt.label);
    if (problem) {
      statusText.textContent = `${problem} Try the same prompt again.`;
      // Remove the refused ink so what is on the canvas matches what was saved,
      // unless the user has already started the next stroke.
      if (!drawing && entries.at(-1) === entry) { entries.pop(); surface?.undo(); }
      return;
    }
    try {
      const sample = { id: crypto.randomUUID(), label: prompt.label, createdAt: Date.now(), strokes: [stroke] };
      await repository.add([sample]);
      Object.assign(entry, { label: prompt.label, sampleId: sample.id, promptIndex: index! });
      counts = { ...counts, [prompt.label]: counts[prompt.label] + 1 };
      savedThisSession++;
      index = nextPrompt(script, index! + 1, counts);
      statusText.textContent = `Saved as ${labelNames[prompt.label].toLowerCase()}.`;
    } catch (error) {
      statusText.textContent = `Not saved: ${errorMessage(error)}`;
      if (!drawing && entries.at(-1) === entry) { entries.pop(); surface?.undo(); }
    }
  }

  const onChange = (status: InkSurfaceStatus): void => {
    drawing = status.isDrawing;
    const strokes = status.document.strokes;
    if (strokes.length < handled) handled = strokes.length;
    while (!status.isDrawing && handled < strokes.length) {
      const stroke = strokes[handled++]!;
      const entry: Entry = { label: null, sampleId: null, promptIndex: -1 };
      entries.push(entry);
      pending++;
      queue = queue.then(() => process(stroke, entry)).finally(() => { pending--; render(); });
    }
    render();
  };

  const reset = async (): Promise<void> => {
    script = buildScript(promptsPerShape, round);
    entries = []; handled = 0; savedThisSession = 0; pending = 0; queue = Promise.resolve();
    statusText.textContent = '';
    if (!repository) { index = null; promptText.textContent = ''; render(); return; }
    try {
      const { samples } = await repository.load();
      counts = { noteheadFilled: 0, noteheadHollow: 0, stem: 0 };
      for (const { label } of samples) counts[label]++;
      index = nextPrompt(script, 0, counts);
    } catch (error) {
      index = null;
      statusText.textContent = `Could not read personal templates: ${errorMessage(error)}`;
    }
    render();
  };

  listen(undoButton, () => {
    if (pending > 0 || !surface) return;
    const entry = entries.pop();
    if (!entry) return;
    pending++; render();
    void (async () => {
      try {
        if (entry.sampleId && entry.label && repository) {
          await repository.remove([entry.sampleId]);
          counts = { ...counts, [entry.label]: counts[entry.label] - 1 };
          savedThisSession--; index = entry.promptIndex;
          statusText.textContent = 'Last sample removed.';
        } else statusText.textContent = 'Last stroke removed.';
        surface?.undo();
      } catch (error) {
        entries.push(entry);
        statusText.textContent = `Not removed: ${errorMessage(error)}`;
      } finally { pending--; render(); }
    })();
  });
  listen(skipButton, () => {
    if (pending > 0 || index === null) return;
    index = nextPrompt(script, index + 1, counts);
    statusText.textContent = 'Skipped.';
    render();
  });
  listen(clearButton, () => {
    if (pending > 0 || !surface) return;
    entries = []; surface.newPage();
    statusText.textContent = 'Drawing area cleared. Saved samples are kept; use Undo last to remove one.';
  });
  listen(againButton, () => {
    round++; script = buildScript(promptsPerShape, round);
    index = nextPrompt(script, 0, counts);
    statusText.textContent = 'Another round started.';
    render();
  });
  listen(get('#guided-done'), () => dialog.close());
  dialog.addEventListener('close', () => {
    surface?.dispose(); surface = null; entries = []; round = 0;
    canvas.setAttribute('aria-disabled', 'true');
    onClosed();
  }, { signal });
  signal.addEventListener('abort', () => { surface?.dispose(); dialog.remove(); }, { once: true });

  return {
    open: () => {
      if (dialog.open) return;
      round = 0;
      dialog.showModal();
      surface = attachInkSurface(canvas, onChange);
      canvas.setAttribute('aria-disabled', 'false');
      void reset();
    },
  };
}
