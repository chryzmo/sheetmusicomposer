import { config } from '../config';
import type { SketchDocument } from '../model/document';
import type { Pitch } from '../model/music';
import { staffYFromPitch } from '../staff/pitch';

/** Where a kept note sits on the page, in staff spaces. */
export interface NoteAnchor {
  readonly eventId: string;
  readonly pitch: Pitch;
  /** Head center: x from the note's own ink, y from its written pitch. */
  readonly x: number;
  readonly y: number;
}

export function pitchName(pitch: Pitch): string {
  return `${pitch.step}${pitch.octave}`;
}

/** Anchors for every kept note. The model does not record which stroke is the
 * head, so x comes from the note's ink minus a stem: when a note has several
 * strokes, the tallest is treated as the stem if it is at least stem height.
 * y deliberately follows the written pitch, not the ink, so a corrected note's
 * marker moves while the original ink stays where it was drawn.
 */
export function noteAnchors(document: SketchDocument): readonly NoteAnchor[] {
  const strokes = new Map(document.strokes.map((s) => [s.id, s]));
  return (document.measures ?? []).flatMap((measure) => measure.events.flatMap((event): NoteAnchor[] => {
    if (event.kind !== 'note') return [];
    const boxes = event.strokeIds.flatMap((id) => {
      const points = strokes.get(id)?.points ?? [];
      if (points.length === 0) return [];
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      return [{ left: Math.min(...xs), right: Math.max(...xs), height: Math.max(...ys) - Math.min(...ys) }];
    });
    if (boxes.length === 0) return [];
    const stem = boxes.length > 1 ? boxes.reduce((a, b) => (b.height > a.height ? b : a)) : null;
    const head = stem && stem.height >= config.primitiveStemMinHeight ? boxes.filter((b) => b !== stem) : boxes;
    const x = (Math.min(...head.map((b) => b.left)) + Math.max(...head.map((b) => b.right))) / 2;
    return [{ eventId: event.id, pitch: event.pitch, x, y: staffYFromPitch(event.pitch) }];
  }));
}

/** Nearest note within `radius` staff spaces of a point, else null. */
export function noteAt(anchors: readonly NoteAnchor[], point: { x: number; y: number }, radius: number): NoteAnchor | null {
  let best: NoteAnchor | null = null, bestDistance = radius;
  for (const anchor of anchors) {
    const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
    if (distance <= bestDistance) { best = anchor; bestDistance = distance; }
  }
  return best;
}
