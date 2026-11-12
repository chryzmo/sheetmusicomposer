import { config } from '../config';
import type { Stroke } from '../ink/types';
import type { Duration, Pitch } from '../model/music';
import { pitchAtStaffY, staffYFromPitch } from '../staff/pitch';
import type { ExpectedEvent, ExpectedPrimitive } from './schema';

/** Tap-to-label for FREE-DRAWN test measures. The user says which strokes make up
 * each note, how long it is, and (by confirming or nudging a suggestion) its pitch.
 * Nothing here recognizes anything: labels are the user's intent, never recognizer
 * output. Pure and DOM-free so the mapping to fixture truth is unit-tested.
 */
export type QuickDuration = Extract<Duration, 'whole' | 'half' | 'quarter'>;

export interface QuickNote {
  readonly id: string;
  readonly duration: QuickDuration;
  /** One or more strokes forming the notehead (a scribbled head may have several). */
  readonly headStrokeIds: readonly string[];
  /** Exactly one stroke for half and quarter notes; null for a whole note. */
  readonly stemStrokeId: string | null;
  readonly pitch: Pitch;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The stroke closest to a tap (staff-space coordinates), within `maxDistance`,
 * or null. Strokes in `avoid` (already labeled or selected) lose to any other
 * stroke within tolerance, so a stem beside the next note's head, or one outline
 * over another, can still be reached; if nothing else is near, the nearest
 * avoided stroke is returned so the caller can explain it. On an exact tie the
 * later-drawn stroke wins (it is drawn on top).
 */
export function nearestStroke(strokes: readonly Stroke[], x: number, y: number, maxDistance: number = config.quickLabelTapDistance,
  avoid: ReadonlySet<string> = new Set()): string | null {
  let best: { id: string; distance: number } | null = null, bestAvoided: { id: string; distance: number } | null = null;
  for (const stroke of strokes) {
    const { points } = stroke;
    let distance = Infinity;
    if (points.length === 1) distance = Math.hypot(x - points[0]!.x, y - points[0]!.y);
    for (let i = 1; i < points.length; i++) distance = Math.min(distance, distanceToSegment(x, y, points[i - 1]!.x, points[i - 1]!.y, points[i]!.x, points[i]!.y));
    if (distance > maxDistance) continue;
    if (avoid.has(stroke.id)) { if (bestAvoided === null || distance <= bestAvoided.distance) bestAvoided = { id: stroke.id, distance }; }
    else if (best === null || distance <= best.distance) best = { id: stroke.id, distance };
  }
  return (best ?? bestAvoided)?.id ?? null;
}

/** Center of the notehead strokes' bounding box, as the assembler measures it. */
export function headCenter(strokes: readonly Stroke[]): { x: number; y: number } {
  const points = strokes.flatMap((s) => s.points);
  if (points.length === 0) throw new RangeError('A notehead needs ink');
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Suggested pitch from where the head sits, using the SAME snapping rule as
 * recognition. Because it is the same rule, a suggestion can never show a
 * snapping error by itself: the labeler must correct it when they meant another
 * note. Null when the position is outside C0-B9.
 */
export function suggestPitch(headStrokes: readonly Stroke[]): Pitch | null {
  return pitchAtStaffY(headCenter(headStrokes).y);
}

/** One written line/space up (positive) or down (negative); null outside C0-B9. */
export function nudgePitch(pitch: Pitch, steps: number): Pitch | null {
  return pitchAtStaffY(staffYFromPitch(pitch) - steps / 2);
}

export interface QuickLabels { readonly primitives: ExpectedPrimitive[]; readonly events: ExpectedEvent[] }

/** Fixture ground truth from the labeled notes. Events run left to right by
 * notehead (the order music is written), primitives follow drawing order, and
 * every stroke no note claimed becomes its own `unknown` primitive with no event,
 * as the fixture format asks for ambiguous or unsupported ink.
 */
export function toExpected(strokes: readonly Stroke[], notes: readonly QuickNote[]): QuickLabels {
  const byId = new Map(strokes.map((s, i) => [s.id, { stroke: s, order: i }]));
  const claimed = new Set<string>();
  const claim = (id: string): Stroke => {
    const entry = byId.get(id);
    if (!entry) throw new Error('A labeled stroke is not part of this measure');
    if (claimed.has(id)) throw new Error('A stroke cannot belong to two notes');
    claimed.add(id);
    return entry.stroke;
  };
  const rows: { order: number; primitive: ExpectedPrimitive }[] = [];
  const events: { x: number; event: ExpectedEvent }[] = [];
  for (const note of notes) {
    if (note.headStrokeIds.length === 0) throw new Error('A note needs a notehead');
    const wantsStem = note.duration !== 'whole';
    if (wantsStem !== (note.stemStrokeId !== null)) throw new Error(wantsStem ? 'A half or quarter note needs its stem' : 'A whole note has no stem');
    const head = note.headStrokeIds.map(claim);
    const order = (s: Stroke): number => byId.get(s.id)!.order;
    rows.push({ order: Math.min(...head.map(order)), primitive: { label: note.duration === 'quarter' ? 'noteheadFilled' : 'noteheadHollow', strokeIds: head.map((s) => s.id) } });
    const ids = [...head.map((s) => s.id)];
    if (note.stemStrokeId !== null) {
      const stem = claim(note.stemStrokeId);
      rows.push({ order: order(stem), primitive: { label: 'stem', strokeIds: [stem.id] } });
      ids.push(stem.id);
    }
    events.push({ x: headCenter(head).x, event: { kind: 'note', duration: note.duration, dots: 0, accidental: null, pitch: note.pitch,
      strokeIds: ids.sort((a, b) => byId.get(a)!.order - byId.get(b)!.order) } });
  }
  for (const [id, { order }] of byId) if (!claimed.has(id)) rows.push({ order, primitive: { label: 'unknown', strokeIds: [id] } });
  rows.sort((a, b) => a.order - b.order);
  events.sort((a, b) => a.x - b.x);
  return { primitives: rows.map((r) => r.primitive), events: events.map((e) => e.event) };
}
