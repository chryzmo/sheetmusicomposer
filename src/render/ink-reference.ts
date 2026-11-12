import { config } from '../config';
import type { SketchDocument } from '../model/document';

/** Frozen original ink, not a replacement/normalized recognizer cloud. */
export function drawInkReference(svg: SVGSVGElement, source: SketchDocument, proposedIds: ReadonlySet<string>): Map<string, SVGPolylineElement> {
  const ns = 'http://www.w3.org/2000/svg';
  const paths = new Map<string, SVGPolylineElement>();
  svg.replaceChildren();
  let minX = 0, maxX: number = config.staffWidth, minY = 0, maxY = 4;
  for (const stroke of source.strokes) for (const point of stroke.points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX + 2, height = maxY - minY + 3;
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Original ink exceeds preview coordinate range');
  svg.setAttribute('viewBox', `${minX - 1} ${minY - 1} ${width} ${height}`);
  for (let y = 0; y < 5; y++) {
    const line = document.createElementNS(ns, 'line');
    for (const [k, v] of Object.entries({ x1: 0, x2: config.staffWidth, y1: y, y2: y, stroke: '#aaa', 'stroke-width': 0.04 })) line.setAttribute(k, String(v));
    svg.append(line);
  }
  source.strokes.forEach((stroke, index) => {
    const path = document.createElementNS(ns, 'polyline');
    const points = stroke.points.map((p) => `${p.x},${p.y}`);
    if (points.length === 1) points.push(points[0]!);
    path.setAttribute('points', points.join(' '));
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', proposedIds.has(stroke.id) ? '#26352f' : '#b12e21');
    path.setAttribute('stroke-width', String(config.inkWidth));
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    if (stroke.completion === 'interrupted') path.setAttribute('stroke-dasharray', '0.2 0.15');
    path.dataset.strokeNumber = String(index + 1);
    svg.append(path); paths.set(stroke.id, path);
    const first = stroke.points[0];
    if (first) {
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(first.x + 0.2)); text.setAttribute('y', String(first.y - 0.2));
      text.setAttribute('font-size', '0.7'); text.setAttribute('fill', '#b12e21'); text.textContent = String(index + 1); svg.append(text);
    }
  });
  return paths;
}
