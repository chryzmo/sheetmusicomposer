import { config } from '../config';
import { staffLines } from '../staff/geometry';
import type { ViewTransform } from '../staff/coordinates';
import type { InkState } from './capture';
import type { SketchDocument } from '../model/document';
import type { Stroke } from './types';
import type { NoteAnchor } from '../edit/note-anchors';
import { pitchName } from '../edit/note-anchors';
import type { Pitch } from '../model/music';

/** Markers for kept notes; `grab` is the note being dragged and its snapped pitch. */
export interface NoteOverlay {
  readonly anchors: readonly NoteAnchor[];
  readonly grab: { readonly eventId: string; readonly pitch: Pitch; readonly y: number } | null;
}

// Not near-black: tests find ink by dark pixels, and markers are not ink.
const markerColor = '#c2570c';

function drawNoteMarkers(context: CanvasRenderingContext2D, overlay: NoteOverlay): void {
  context.strokeStyle = markerColor;
  context.fillStyle = markerColor;
  context.lineWidth = 0.08;
  for (const anchor of overlay.anchors) {
    const grabbed = overlay.grab?.eventId === anchor.eventId;
    const y = grabbed ? overlay.grab!.y : anchor.y;
    context.globalAlpha = grabbed ? 0.35 : 0.7;
    context.beginPath();
    context.ellipse(anchor.x, y, grabbed ? 0.8 : 0.65, grabbed ? 0.62 : 0.5, 0, 0, Math.PI * 2);
    if (grabbed) context.fill();
    context.globalAlpha = 0.9;
    context.stroke();
    if (grabbed) {
      context.font = '0.9px sans-serif';
      context.textBaseline = 'middle';
      context.fillText(pitchName(overlay.grab!.pitch), anchor.x + 1.1, y);
    }
  }
  context.globalAlpha = 1;
}

function drawStroke(context: CanvasRenderingContext2D, stroke: Pick<Stroke, 'points'>): void {
  const first = stroke.points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < stroke.points.length; index++) {
    const point = stroke.points[index];
    if (point) context.lineTo(point.x, point.y);
  }
  context.stroke();
  // A tap or stationary stroke must be visible too.
  context.beginPath();
  context.arc(first.x, first.y, config.inkWidth / 2, 0, Math.PI * 2);
  context.fill();
}

export function renderSurface(
  canvas: HTMLCanvasElement, context: CanvasRenderingContext2D,
  view: ViewTransform, document: SketchDocument, ink: InkState, notes?: NoteOverlay,
): void {
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(
    ratio * view.pixelsPerSpace, 0, 0, ratio * view.pixelsPerSpace,
    ratio * view.offsetX, ratio * view.offsetY,
  );
  context.strokeStyle = '#7e8981';
  context.lineWidth = 1 / view.pixelsPerSpace;
  context.beginPath();
  for (const line of staffLines(config.staffWidth)) {
    context.moveTo(line.x1, line.y);
    context.lineTo(line.x2, line.y);
  }
  context.stroke();

  context.strokeStyle = '#172f28';
  context.fillStyle = '#172f28';
  context.lineWidth = config.inkWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of document.strokes) drawStroke(context, stroke);
  if (ink.active) drawStroke(context, ink.active.stroke);
  if (notes) drawNoteMarkers(context, notes);
}
