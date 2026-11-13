import { config } from '../config';
import { createHistory, executeCommand, redo, undo } from '../edit/history';
import type { Command } from '../edit/history';
import { noteAnchors, noteAt } from '../edit/note-anchors';
import type { NoteAnchor } from '../edit/note-anchors';
import { nextDuration, setDurationCommand } from '../edit/duration-command';
import { repitchCommand } from '../edit/repitch-command';
import { addStrokeCommand } from '../edit/stroke-command';
import { restoreCommand } from '../edit/restore-command';
import { newPageCommand } from '../edit/new-page-command';
import { createDocument } from '../model/document';
import type { SketchDocument } from '../model/document';
import type { Duration, Pitch } from '../model/music';
import { pitchAtStaffY, staffYFromPitch } from '../staff/pitch';
import type { ViewTransform } from '../staff/coordinates';
import { appendPoints, beginStroke, createInkState, discardStroke, finishStroke } from './capture';
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

export interface InkSurfaceCallbacks {
  /** A drag committed a new pitch for a kept note (one undoable step). */
  onNoteMoved?: (change: { from: Pitch; to: Pitch }) => void;
  /** A tap on a kept note committed a new duration (one undoable step). */
  onDurationChanged?: (change: { pitch: Pitch; from: Duration; to: Duration }) => void;
}

export interface InkSurface {
  dispose: () => void;
  fitStaff: () => void;
  undo: () => void;
  redo: () => void;
  snapshot: () => SketchDocument;
  /** Read committed state without interrupting active ink. */
  currentDocument: () => SketchDocument;
  /** Opt-in reviewed commands must NEVER finalize active pen contact. */
  applyReview: (command: Command<SketchDocument>) => void;
  restore: (document: SketchDocument) => void;
  newPage: () => void;
}

export function attachInkSurface(
  canvas: HTMLCanvasElement, onChange: (status: InkSurfaceStatus) => void,
  onDiagnostic: (message: string) => void = () => {},
  initialDocument: SketchDocument = createDocument(),
  callbacks: InkSurfaceCallbacks = {},
): InkSurface {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ink = createInkState();
  const history = createHistory(initialDocument);
  // Long-press-then-drag on a kept note. `hold` is a pen contact that landed on a
  // note and has not yet moved or timed out (its stroke is still being captured);
  // `grab` is the drag after the hold succeeded (the stroke was discarded).
  let hold: { pointerId: number; x: number; y: number; anchor: NoteAnchor; timer: ReturnType<typeof setTimeout> } | null = null;
  let grab: { pointerId: number; anchor: NoteAnchor; pressY: number; pitch: Pitch } | null = null;
  let anchorCache: { document: SketchDocument; anchors: readonly NoteAnchor[] } | null = null;
  const anchors = (): readonly NoteAnchor[] => {
    if (anchorCache?.document !== history.document) anchorCache = { document: history.document, anchors: noteAnchors(history.document) };
    return anchorCache.anchors;
  };
  const notify = (): void => onChange({
    document: history.document,
    isDrawing: ink.active !== null || grab !== null,
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
      renderSurface(canvas, context, view, history.document, ink, {
        anchors: anchors(),
        grab: grab ? { eventId: grab.anchor.eventId, pitch: grab.pitch, y: staffYFromPitch(grab.pitch) } : null,
      });
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
  const clearHold = (): void => {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  };
  const cancelGrab = (): void => {
    if (!grab) return;
    const id = grab.pointerId;
    grab = null;
    release(id);
    notify();
    scheduleRender();
  };
  const finish = (completion: 'complete' | 'interrupted'): void => {
    clearHold();
    cancelGrab();
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
    finish('interrupted');
    resize();
    suppressTouches(navigation);
    const start = samples(event);
    if (!beginStroke(ink, event.pointerType, event.pointerId, crypto.randomUUID(), start)) return;
    capture(event.pointerId);
    const first = start[0]!, target = noteAt(anchors(), first, config.noteGrabRadius);
    if (target) {
      const pointerId = event.pointerId;
      hold = { pointerId, x: first.x, y: first.y, anchor: target, timer: setTimeout(() => {
        const active = ink.active;
        if (!hold || !active || active.pointerId !== pointerId) return;
        // Held in place on a note: this contact is a drag, not ink. Discard the
        // partial stroke (never committed) and press at the last pen position.
        const pressY = active.stroke.points.at(-1)?.y ?? hold.y;
        grab = { pointerId, anchor: hold.anchor, pressY, pitch: hold.anchor.pitch };
        hold = null;
        discardStroke(ink, pointerId);
        notify();
        scheduleRender();
      }, config.noteGrabHoldMs) };
    }
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
    if (event.pointerType === 'pen' && grab?.pointerId === event.pointerId) {
      event.preventDefault();
      if (event.buttons === 0) { cancelGrab(); return; }
      const point = samples(event).at(-1)!;
      // Keep the offset from the press so the marker does not jump to the pen.
      const pitch = pitchAtStaffY(grab.anchor.y + point.y - grab.pressY);
      if (pitch && (pitch.step !== grab.pitch.step || pitch.octave !== grab.pitch.octave)) {
        grab = { ...grab, pitch };
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
    const moved = samples(event);
    appendPoints(ink, event.pointerId, moved);
    if (hold && moved.some((p) => Math.hypot(p.x - hold!.x, p.y - hold!.y) > config.noteGrabHoldTolerance)) clearHold();
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
    if (event.pointerType === 'pen' && grab?.pointerId === event.pointerId) {
      event.preventDefault();
      const { anchor, pitch, pointerId } = grab;
      grab = null;
      release(pointerId);
      if (pitch.step !== anchor.pitch.step || pitch.octave !== anchor.pitch.octave) {
        executeCommand(history, repitchCommand(history.document, anchor.eventId, pitch));
        callbacks.onNoteMoved?.({ from: anchor.pitch, to: pitch });
      }
      notify();
      scheduleRender();
      return;
    }
    if (!isActivePen(event)) return;
    event.preventDefault();
    appendPoints(ink, event.pointerId, samples(event));
    if (hold?.pointerId === event.pointerId) {
      // Lifted before the hold elapsed and without leaving the tolerance: a tap
      // on a kept note, not ink. Discard the stroke and step its duration.
      const { anchor, pointerId } = hold;
      clearHold();
      discardStroke(ink, pointerId);
      release(pointerId);
      const target = history.document.measures?.flatMap((m) => m.events).find((e) => e.id === anchor.eventId);
      if (target) {
        const to = nextDuration(target.duration);
        executeCommand(history, setDurationCommand(history.document, anchor.eventId, to));
        callbacks.onDurationChanged?.({ pitch: anchor.pitch, from: target.duration, to });
      }
      notify();
      scheduleRender();
      return;
    }
    finish('complete');
  }, options);
  canvas.addEventListener('pointercancel', (event) => {
    onDiagnostic(`cancel ${event.pointerType} pointer=${event.pointerId}`);
    if (endNavigationContact(event)) return;
    if (grab?.pointerId === event.pointerId) cancelGrab();
    else if (isActivePen(event)) finish('interrupted');
  }, options);
  canvas.addEventListener('lostpointercapture', (event) => {
    onDiagnostic(`capture lost pointer=${event.pointerId}`);
    if (endNavigationContact(event)) return;
    if (grab?.pointerId === event.pointerId) cancelGrab();
    else if (ink.active?.pointerId === event.pointerId) finish('interrupted');
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
      if (history.document.strokes.length > 0 || history.document.measures !== undefined) {
        executeCommand(history, newPageCommand(history.document));
      }
      resize();
      fit();
      notify();
      scheduleRender();
    },
    currentDocument: () => history.document,
    applyReview: (command) => {
      if (ink.active || grab) throw new Error('Lift the Pencil before keeping a review');
      executeCommand(history, command);
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
      // Undo during a drag only abandons the drag, never an older command.
      if (grab) { cancelGrab(); return; }
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
      if (ink.active || grab) return;
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
