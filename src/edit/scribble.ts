import { config } from '../config';
import type { InkPoint } from '../ink/types';
import type { NoteAnchor } from './note-anchors';

/** Direction changes along one axis, ignoring moves back smaller than `hysteresis`. */
function reversals(values: readonly number[], hysteresis: number): number {
  let count = 0, direction = 0, extreme = values[0] ?? 0;
  for (const value of values) {
    if (direction >= 0 && value > extreme) { extreme = value; if (direction === 0) direction = 1; }
    else if (direction <= 0 && value < extreme) { extreme = value; if (direction === 0) direction = -1; }
    else if (direction > 0 && extreme - value > hysteresis) { count++; direction = -1; extreme = value; }
    else if (direction < 0 && value - extreme > hysteresis) { count++; direction = 1; extreme = value; }
  }
  return count;
}

export interface ScribbleBounds { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

/** Bounds of a stroke if it reads as a back-and-forth scribble, else null. A
 * heuristic over shape alone: it cannot tell a deliberate delete from a large
 * scribbled-in mark, which is why the caller also needs a kept note under it.
 */
export function scribbleBounds(points: readonly Pick<InkPoint, 'x' | 'y'>[]): ScribbleBounds | null {
  if (points.length < 4) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const bounds = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
  if (Math.max(width, height) < config.scribbleMinSize) return null;
  const turns = (values: readonly number[], extent: number): number =>
    reversals(values, Math.max(0.15, extent * config.scribbleReversalFraction));
  return Math.max(turns(xs, width), turns(ys, height)) >= config.scribbleMinReversals ? bounds : null;
}

/** IDs of kept notes whose head center a scribble covers. Empty if not a scribble. */
export function scribbleTargets(points: readonly Pick<InkPoint, 'x' | 'y'>[], anchors: readonly NoteAnchor[]): string[] {
  const b = scribbleBounds(points);
  if (!b) return [];
  return anchors.filter((a) => a.x >= b.left && a.x <= b.right && a.y >= b.top && a.y <= b.bottom).map((a) => a.eventId);
}
