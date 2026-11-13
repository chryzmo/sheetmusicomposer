import { config } from '../config';
import type { Stroke } from '../ink/types';
import type { SketchDocument } from '../model/document';
import { noteAnchors } from './note-anchors';

interface Box { left: number; right: number; top: number; bottom: number }

function bounds(points: readonly { x: number; y: number }[]): Box | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** IDs of kept events a new stroke could change: those whose region, padded by
 * the invalidation margin, its bounding box touches. An event's region is its
 * own ink plus, for a note, its written head position (which moves when the
 * pitch is corrected). Overlap is conservative: a long stroke touches every
 * note its box reaches. Ink elsewhere cannot alter a note, so it keeps it.
 */
export function touchedEventIds(document: SketchDocument, stroke: Pick<Stroke, 'points'>): ReadonlySet<string> {
  const touched = new Set<string>();
  const box = bounds(stroke.points);
  if (!box || !document.measures) return touched;
  const strokes = new Map(document.strokes.map((s) => [s.id, s]));
  const heads = new Map(noteAnchors(document).map((a) => [a.eventId, a]));
  const margin = config.inkInvalidationMargin;
  for (const measure of document.measures) {
    for (const event of measure.events) {
      const head = heads.get(event.id);
      const region = bounds([...event.strokeIds.flatMap((id) => strokes.get(id)?.points ?? []), ...(head ? [head] : [])]);
      if (!region) continue;
      if (box.right >= region.left - margin && box.left <= region.right + margin &&
          box.bottom >= region.top - margin && box.top <= region.bottom + margin) touched.add(event.id);
    }
  }
  return touched;
}
