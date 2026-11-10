import { config } from '../config';
import { createHistory, executeCommand, redo, undo } from '../edit/history';
import { addStrokeCommand } from '../edit/stroke-command';
import { restoreCommand } from '../edit/restore-command';
import { newPageCommand } from '../edit/new-page-command';
import { createDocument } from '../model/document';
import type { SketchDocument } from '../model/document';
import type { ViewTransform } from '../staff/coordinates';
import { appendPoints, beginStroke, createInkState, finishStroke } from './capture';
import { createNavigationState, endTouch, moveTouch, startTouch, suppressTouches } from './navigation';
import { renderSurface } from './render';
import { collectSamples } from './samples';

export interface InkSurfaceStatus {
  document: SketchDocument;
  isDrawing: boolean;
  strokeCount: number;
  canUndo: boolean;
  canRedo: boolean;
}

export interface InkSurface {
  dispose: () => void;
  fitStaff: () => void;
  undo: () => void;
  redo: () => void;
  snapshot: () => SketchDocument;
  restore: (document: SketchDocument) => void;
  newPage: () => void;
}

export function attachInkSurface(
  canvas: HTMLCanvasElement, onChange: (status: InkSurfaceStatus) => void,
  onDiagnostic: (message: string) => void = () => {},
  initialDocument: SketchDocument = createDocument(),
): InkSurface {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ink = createInkState();
  const history = createHistory(initialDocument);
  const notify = (): void => onChange({
    document: history.document,
    isDrawing: ink.active !== null,
    strokeCount: history.document.strokes.length,
    canUndo: ink.active !== null || history.undoStack.length > 0,
    canRedo: ink.active === null && history.redoStack.length > 0,
  });
  const navigation = createNavigationState();
  let view: ViewTransform = { offsetX: 0, offsetY: 0, pixelsPerSpace: config.initialSpaceSize };
  let frame: number | null = null;
  let width = 0;
  let height = 0;
  const events = new AbortController();
  const options = { signal: events.signal };

  const scheduleRender = (): void => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      renderSurface(canvas, context, view, history.document, ink);
    });
  };
  const release = (id: number): void => {
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const capture = (id: number): void => {
    try {
      canvas.setPointerCapture(id);
    } catch (error) {
      // Synthetic events have no active native pointer. Do not hide other failures.
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
    }
  };
  const finish = (completion: 'complete' | 'interrupted'): void => {
    const pointerId = ink.active?.pointerId;
    if (pointerId === undefined) return;
    onDiagnostic(`finish pointer=${pointerId} ${completion}`);
    const stroke = finishStroke(ink, pointerId, completion);
    if (stroke) executeCommand(history, addStrokeCommand(stroke));
    release(pointerId);
    notify();
    scheduleRender();
  };
  const clearNavigation = (): void => {
    const ids = [...navigation.contacts.keys()];
    navigation.contacts.clear();
    for (const id of ids) release(id);
  };
  const fit = (): void => {
    if (width <= 0 || height <= 0) return;
    const scale = Math.min(config.initialSpaceSize, width / (config.staffWidth + 2 * config.viewPadding));
    view = {
      pixelsPerSpace: scale,
      offsetX: (width - config.staffWidth * scale) / 2,
      offsetY: (height - 4 * scale) / 2,
    };
  };
  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width !== width || bounds.height !== height) {
      finish('interrupted');
      clearNavigation();
      const initial = width === 0 || height === 0;
      // Keep the same document point at the viewport center on resize, without
      // throwing away an intentional pan or zoom. Fit is explicit after startup.
      view = { ...view,
        offsetX: view.offsetX + (bounds.width - width) / 2,
        offsetY: view.offsetY + (bounds.height - height) / 2,
      };
      width = bounds.width;
      height = bounds.height;
      if (initial) fit();
    }
    scheduleRender();
  };
  const localPosition = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const samples = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return collectSamples(event, { x: rect.left, y: rect.top }, view);
  };
  const isActivePen = (event: PointerEvent): boolean =>
    event.pointerType === 'pen' && ink.active?.pointerId === event.pointerId;

  // Keep the inter-stroke compatibility fix: native Touch Events never draw or
  // navigate. All application gestures use Pointer Events, without sniffing UA.
  const suppressNativeGesture = (event: TouchEvent): void => {
    if (event.cancelable) event.preventDefault();
  };
  canvas.addEventListener('touchstart', suppressNativeGesture, { ...options, passive: false });
  canvas.addEventListener('touchmove', suppressNativeGesture, { ...options, passive: false });

  canvas.addEventListener('pointerdown', (event) => {
    onDiagnostic(`down ${event.pointerType} pointer=${event.pointerId} button=${event.button} buttons=${event.buttons}`);
    if (event.pointerType === 'touch') {
      event.preventDefault();
      resize();
      startTouch(navigation, event.pointerId, localPosition(event), ink.active !== null);
      capture(event.pointerId);
      return;
    }
    if (event.pointerType !== 'pen' || event.button !== 0) return;
    event.preventDefault();
    if (ink.active) finish('interrupted');
    resize();
    suppressTouches(navigation);
    if (!beginStroke(ink, event.pointerType, event.pointerId, crypto.randomUUID(), samples(event))) return;
    capture(event.pointerId);
    notify();
    scheduleRender();
  }, options);
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' && navigation.contacts.has(event.pointerId)) {
      event.preventDefault();
      if (ink.active) suppressTouches(navigation);
      const next = moveTouch(navigation, event.pointerId, localPosition(event), view);
      if (next !== view) {
        view = next;
        scheduleRender();
      }
      return;
    }
    if (!isActivePen(event)) return;
    event.preventDefault();
    if (event.buttons === 0) {
      onDiagnostic('move with no contact');
      finish('interrupted');
      return;
    }
    appendPoints(ink, event.pointerId, samples(event));
    scheduleRender();
  }, options);
  const endNavigationContact = (event: PointerEvent): boolean => {
    if (!navigation.contacts.has(event.pointerId)) return false;
    endTouch(navigation, event.pointerId);
    release(event.pointerId);
    return true;
  };
  canvas.addEventListener('pointerup', (event) => {
    onDiagnostic(`up ${event.pointerType} pointer=${event.pointerId}`);
    if (event.pointerType === 'touch') {
      endNavigationContact(event);
      return;
    }
    if (!isActivePen(event)) return;
    event.preventDefault();
    appendPoints(ink, event.pointerId, samples(event));
    finish('complete');
  }, options);
  canvas.addEventListener('pointercancel', (event) => {
    onDiagnostic(`cancel ${event.pointerType} pointer=${event.pointerId}`);
    if (!endNavigationContact(event) && isActivePen(event)) finish('interrupted');
  }, options);
  canvas.addEventListener('lostpointercapture', (event) => {
    onDiagnostic(`capture lost pointer=${event.pointerId}`);
    if (!endNavigationContact(event) && ink.active?.pointerId === event.pointerId) finish('interrupted');
  }, options);
  const interrupt = (): void => {
    finish('interrupted');
    clearNavigation();
  };
  window.addEventListener('blur', interrupt, options);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) interrupt();
  }, options);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener('resize', resize, options);
  resize();
  notify();

  return {
    newPage: () => {
      interrupt();
      if (history.document.strokes.length > 0) {
        executeCommand(history, newPageCommand(history.document));
      }
      resize();
      fit();
      notify();
      scheduleRender();
    },
    snapshot: () => {
      interrupt();
      return history.document;
    },
    restore: (document) => {
      interrupt();
      executeCommand(history, restoreCommand(history.document, document));
      notify();
      scheduleRender();
    },
    undo: () => {
      // Finalize active ink first so Undo removes the partial current stroke,
      // not an older completed stroke. Its raw samples remain available to Redo.
      interrupt();
      if (undo(history)) {
        notify();
        scheduleRender();
      }
    },
    redo: () => {
      // Drawing a new stroke takes precedence; do not mutate it via Redo.
      if (ink.active) return;
      clearNavigation();
      if (redo(history)) {
        notify();
        scheduleRender();
      }
    },
    fitStaff: () => {
      interrupt();
      resize();
      fit();
      scheduleRender();
    },
    dispose: () => {
      interrupt();
      events.abort();
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    },
  };
}
