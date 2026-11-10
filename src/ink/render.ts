import { config } from '../config';
import { staffLines } from '../staff/geometry';
import type { ViewTransform } from '../staff/coordinates';
import type { InkState } from './capture';
import type { SketchDocument } from '../model/document';
import type { Stroke } from './types';

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
  view: ViewTransform, document: SketchDocument, ink: InkState,
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
}
