import { config } from '../config';
import type { Stroke } from '../ink/types';
import type { Pitch } from '../model/music';
import { pitchAtStaffY } from '../staff/pitch';
import { primitiveLabels } from './primitives';
import type { PrimitiveLabel } from './primitives';

/** A complete partition of one finished measure's ink. Classifier results fit
 * structurally; manual labels may also be used for isolated assembly tests.
 * This is NOT a decoder, classifier, grouping algorithm, or gesture detector.
 */
export interface AssemblyPrimitive {
  readonly label: PrimitiveLabel;
  readonly strokeIds: readonly string[];
}
export interface SimpleNoteCandidate {
  readonly kind: 'note';
  readonly pitch: Pitch;
  readonly duration: 'whole' | 'half' | 'quarter';
  readonly dots: 0;
  readonly accidental: null;
  readonly headCenter: { readonly x: number; readonly y: number };
  /** Original capture order, independent of primitive/drawing order. */
  readonly strokeIds: readonly string[];
  /** Head then optional stem: retain the original classifications/diagnostics
   * at these input indices. No distance-to-confidence conversion or event ID.
   */
  readonly primitiveIndices: readonly number[];
}
export type AssemblyRejection = 'interrupted' | 'unsupported' | 'degenerate-geometry' |
  'overlapping-heads' | 'ambiguous-attachment' | 'missing-stem' | 'unused-stem' | 'nearby-ink' | 'pitch-range';
export interface SimpleAssembly {
  readonly notes: readonly SimpleNoteCandidate[];
  readonly unresolved: readonly {
    readonly primitiveIndex: number;
    readonly strokeIds: readonly string[];
    readonly reason: AssemblyRejection;
  }[];
  readonly unresolvedStrokeIds: readonly string[];
}
interface Point { readonly x: number; readonly y: number }
interface Bounds { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
interface Geometry {
  readonly bounds: Bounds;
  readonly center: Point;
  readonly tips: readonly Point[];
  readonly complete: boolean;
}
const isHead = (p: AssemblyPrimitive): boolean => p.label === 'noteheadFilled' || p.label === 'noteheadHollow';

function geometry(strokes: readonly Stroke[]): Geometry {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  let topLeft = Infinity, topRight = -Infinity, bottomLeft = Infinity, bottomRight = -Infinity;
  for (const stroke of strokes) {
    for (const { x, y } of stroke.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Assembly requires finite staff-space points');
      left = Math.min(left, x); right = Math.max(right, x);
      if (y < top) { top = y; topLeft = x; topRight = x; }
      else if (y === top) { topLeft = Math.min(topLeft, x); topRight = Math.max(topRight, x); }
      if (y > bottom) { bottom = y; bottomLeft = x; bottomRight = x; }
      else if (y === bottom) { bottomLeft = Math.min(bottomLeft, x); bottomRight = Math.max(bottomRight, x); }
    }
  }
  if (!Number.isFinite(right - left) || !Number.isFinite(bottom - top)) throw new RangeError('Assembly bounds overflow');
  // Actual vertical extrema, NOT bounding-box corners or raw first/last points:
  // retracing/drawing direction must not hide an end or invent a slanted tip.
  return { bounds: { left, right, top, bottom }, center: { x: left + (right - left) / 2, y: top + (bottom - top) / 2 },
    tips: [{ x: topLeft + (topRight - topLeft) / 2, y: top }, { x: bottomLeft + (bottomRight - bottomLeft) / 2, y: bottom }],
    complete: strokes.every((s) => s.completion === 'complete') };
}
function tipDistance(p: Point, b: Bounds): number {
  return Math.hypot(Math.max(0, b.left - p.x, p.x - b.right), Math.max(0, b.top - p.y, p.y - b.bottom));
}
function near(a: Bounds, b: Bounds): boolean {
  return Math.max(0, a.left - b.right, b.left - a.right) <= config.assemblyInkClearance &&
    Math.max(0, a.top - b.bottom, b.top - a.bottom) <= config.assemblyInkClearance;
}

/** Conservative, DOM-free whole/half/quarter candidates for one FINISHED measure.
 * Every source stroke must occur exactly once in primitives (unknown is valid).
 * Use original staff-space geometry, never normalized clouds or pointer times.
 * Reject all competing attachments, not just ties; never downgrade a blocked
 * half note to a whole. Extra nearby ink can be a flag/dot/accidental/gesture,
 * so withhold that entire note instead of silently dropping the extra symbol.
 * No edits, persistence, calibrated confidence, duration resolution, or UI.
 */
export function assembleSimpleNotes(strokes: readonly Stroke[], primitives: readonly AssemblyPrimitive[]): SimpleAssembly {
  if (strokes.length > config.maxStoredStrokes || primitives.length > config.assemblyMaxPrimitives) throw new RangeError('Assembly measure exceeds work limit');
  const source = new Map<string, Stroke>(), order = new Map<string, number>();
  let pointCount = 0;
  for (const [i, stroke] of strokes.entries()) {
    if (!stroke.id.trim() || source.has(stroke.id) || stroke.points.length === 0 ||
        (stroke.completion !== 'complete' && stroke.completion !== 'interrupted')) throw new Error('Invalid assembly stroke');
    pointCount += stroke.points.length;
    if (pointCount > config.maxStoredPoints) throw new RangeError('Assembly point limit exceeded');
    source.set(stroke.id, stroke); order.set(stroke.id, i);
  }
  const covered = new Set<string>();
  const shapes = primitives.map((p) => {
    if (!primitiveLabels.includes(p.label) || p.strokeIds.length === 0) throw new Error('Invalid assembly primitive');
    return geometry(p.strokeIds.map((id) => {
      const stroke = source.get(id);
      if (!stroke || covered.has(id)) throw new Error('Unknown or repeated assembly stroke reference');
      covered.add(id); return stroke;
    }));
  });
  if (covered.size !== strokes.length) throw new Error('Assembly primitives must cover every source stroke');
  const reasons = primitives.map((p, i): AssemblyRejection | null => {
    const g = shapes[i]!;
    return !g.complete ? 'interrupted' : !isHead(p) && p.label !== 'stem' ? 'unsupported'
      : g.bounds.bottom === g.bounds.top || (isHead(p) && g.bounds.left === g.bounds.right) ? 'degenerate-geometry' : null;
  });
  const heads = primitives.flatMap((p, i) => isHead(p) && reasons[i] === null ? [i] : []);
  const stems = primitives.flatMap((p, i) => p.label === 'stem' && reasons[i] === null ? [i] : []);
  const links = primitives.map((): number[] => []);
  for (const h of heads) {
    for (const s of stems) {
      for (const tip of shapes[s]!.tips) {
        if (tipDistance(tip, shapes[h]!.bounds) <= config.assemblyTipMaxGap) {
          // Two matching tips on the SAME stem/head are also ambiguous.
          links[h]!.push(s); links[s]!.push(h);
        }
      }
    }
  }
  const notes: SimpleNoteCandidate[] = [], used = new Set<number>();
  for (const h of heads) {
    const head = primitives[h]!, g = shapes[h]!, matches = links[h]!;
    const stem = matches[0];
    const own = stem === undefined ? [h] : [h, stem];
    let reason: AssemblyRejection | null = null;
    // Single voice only: overlapping head columns could be a chord, even when
    // vertically distant. Do not invent an arbitrary sequential ordering.
    if (heads.some((other) => other !== h && Math.max(0, shapes[other]!.bounds.left - g.bounds.right,
      g.bounds.left - shapes[other]!.bounds.right) <= config.assemblyHeadColumnClearance)) reason = 'overlapping-heads';
    else if (matches.length > 1 || (stem !== undefined && links[stem]!.length !== 1)) reason = 'ambiguous-attachment';
    else if (stem === undefined && head.label === 'noteheadFilled') reason = 'missing-stem';
    else if (shapes.some((other, i) => !own.includes(i) && own.some((index) => near(shapes[index]!.bounds, other.bounds)))) reason = 'nearby-ink';
    const pitch = pitchAtStaffY(g.center.y);
    if (!reason && !pitch) reason = 'pitch-range';
    if (reason) { reasons[h] = reason; continue; }
    const ids = own.flatMap((i) => primitives[i]!.strokeIds).sort((a, b) => order.get(a)! - order.get(b)!);
    notes.push({ kind: 'note', pitch: pitch!, duration: stem === undefined ? 'whole' : head.label === 'noteheadFilled' ? 'quarter' : 'half',
      dots: 0, accidental: null, headCenter: g.center, strokeIds: ids, primitiveIndices: own });
    own.forEach((i) => used.add(i));
  }
  notes.sort((a, b) => a.headCenter.x - b.headCenter.x);
  const unresolved = primitives.flatMap((p, i) => {
    if (used.has(i)) return [];
    const ambiguousStem = links[i]!.length > 0 && (links[i]!.length !== 1 || links[links[i]![0]!]!.length !== 1);
    return [{ primitiveIndex: i, strokeIds: [...p.strokeIds], reason: reasons[i] ?? (ambiguousStem ? 'ambiguous-attachment' : 'unused-stem') }];
  });
  const consumed = new Set(notes.flatMap((n) => n.strokeIds));
  return { notes, unresolved, unresolvedStrokeIds: strokes.filter((s) => !consumed.has(s.id)).map((s) => s.id) };
}
