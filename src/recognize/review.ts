import { config } from '../config';
import { replaceMeasuresCommand } from '../edit/music-command';
import type { Command } from '../edit/history';
import type { SketchDocument } from '../model/document';
import type { TimeSignature } from '../model/music';
import { assembleSimpleNotes } from './assemble';
import type { SimpleAssembly, SimpleNoteCandidate } from './assemble';
import { classifyPrimitive } from './classify';
import type { PrimitiveClassification } from './classify';
import type { RuntimeBank } from './runtime-bank';

export interface ReviewGroup { readonly strokeIds: readonly string[] }
export interface ReviewCandidate {
  readonly note: SimpleNoteCandidate;
  /** Weakest constituent's normalized distance headroom. NOT probability,
   * calibrated confidence, handwriting accuracy, or musical correctness.
   */
  readonly shapeSupport: number;
  readonly evidence: readonly PrimitiveClassification[];
}
export interface MusicReview {
  /** Immutable validated base; command application requires this exact object. */
  readonly base: SketchDocument;
  readonly bankId: RuntimeBank['id'];
  readonly grouping: 'explicit-partition' | 'singleton-fallback';
  readonly supportPolicy: { readonly id: 'distance-headroom-v1'; readonly maxDistance: number; readonly sampleCount: number };
  readonly classifications: readonly PrimitiveClassification[];
  readonly assembly: SimpleAssembly;
  readonly candidates: readonly ReviewCandidate[];
}

/** Explicit heuristic, NOT an empirically calibrated confidence conversion.
 * One constituent for whole notes, head+stem for half/quarter. At the accepted
 * distance ceiling support is zero; a self-match is one (not certainty).
 * This guess is for opt-in reviewed proposals only, never automatic acceptance.
 */
export function distanceHeadroom(distances: readonly number[]): number {
  const values = [...distances];
  if (!(config.primitiveMaxDistance > 0) || !Number.isFinite(config.primitiveMaxDistance) ||
      values.length < 1 || values.length > 2 || values.some((d) => !Number.isFinite(d) || d < 0 || d > config.primitiveMaxDistance)) {
    throw new Error('Shape support requires one or two accepted finite distances');
  }
  return 1 - Math.max(...values) / config.primitiveMaxDistance;
}

/** Pure one-measure review, not a live coordinator or persistence decoder.
 * Supply a complete explicit partition (e.g. FINISHED grouping output), or omit
 * it for honest singleton fallback when old ink lacks observation clocks. No
 * inferred clocks, automatic joins, dropped strokes, template merges, or edits.
 * The caller owns active-contact, region readiness, policy-generation, and
 * asynchronous scheduling guards. Bases/banks/results follow immutable contracts.
 */
export function prepareMusicReview(base: SketchDocument, bank: RuntimeBank, groups?: readonly ReviewGroup[]): MusicReview {
  if ((base.measures?.length ?? 0) > 1) throw new Error('Review supports one-measure pages only');
  const partition = groups ?? base.strokes.map((s) => ({ strokeIds: [s.id] }));
  if (partition.length > config.assemblyMaxPrimitives) throw new Error('Review exceeds primitive work limit');
  if (base.strokes.reduce((sum, s) => sum + s.points.length, 0) > config.reviewMaxPoints) throw new Error('Review exceeds point work limit');
  const byId = new Map(base.strokes.map((s) => [s.id, s]));
  if (byId.size !== base.strokes.length) throw new Error('Review source IDs must be unique');
  const assigned = new Set<string>();
  // Validate the complete partition BEFORE any matching, including unknown ink.
  const inputs = Array.from(partition, (group) => {
    if (group.strokeIds.length === 0) throw new Error('Review groups must be nonempty');
    const selected = group.strokeIds.map((id) => {
      const stroke = byId.get(id);
      if (!stroke || assigned.has(id)) throw new Error('Review groups need known disjoint source IDs');
      assigned.add(id);
      return stroke;
    });
    // Geometry/classification must see original capture order, not caller ID order.
    const ids = new Set(selected.map((s) => s.id));
    return base.strokes.filter((s) => ids.has(s.id));
  });
  if (assigned.size !== base.strokes.length) throw new Error('Review groups must cover every source stroke');
  const classifications = inputs.map((strokes) => classifyPrimitive(strokes, bank.templates));
  const assembly = assembleSimpleNotes(base.strokes, classifications);
  const candidates = assembly.notes.map((note): ReviewCandidate => {
    const evidence = note.primitiveIndices.map((i) => classifications[i]!);
    if (evidence.some((p) => p.label === 'unknown' || p.rejection !== null || p.candidates[0]?.label !== p.label)) throw new Error('Assembly references rejected classification');
    return { note, evidence, shapeSupport: distanceHeadroom(evidence.map((p) => p.candidates[0]!.distance)) };
  });
  return { base, bankId: bank.id, grouping: groups === undefined ? 'singleton-fallback' : 'explicit-partition',
    supportPolicy: { id: 'distance-headroom-v1', maxDistance: config.primitiveMaxDistance, sampleCount: config.pointCloudSampleCount },
    classifications, assembly, candidates };
}

/** An explicitly reviewed selection only. IDs come from the caller ONCE, not
 * generated during redo. Unselected candidates and unknown ink stay unresolved
 * in original capture order. The generic model confidence field stores the
 * documented bounded support heuristic, never a probability. Full diagnostics
 * and policy metadata stay in the transient review, not the score-only v2 file.
 * This helper is not proof of a human action; UI must require a deliberate click.
 */
export function reviewedMusicCommand(review: MusicReview, decision: {
  readonly kind: 'user-reviewed';
  readonly measureId: string;
  readonly timeSignature: TimeSignature;
  readonly selected: readonly { readonly candidateIndex: number; readonly eventId: string }[];
}): Command<SketchDocument> {
  if (decision.kind !== 'user-reviewed') throw new Error('Explicit reviewed decision required');
  const indices = new Set<number>();
  const selected = [...decision.selected].sort((a, b) => a.candidateIndex - b.candidateIndex);
  const events = selected.map(({ candidateIndex, eventId }) => {
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= review.candidates.length || indices.has(candidateIndex)) throw new Error('Invalid/duplicate review selection');
    indices.add(candidateIndex);
    const { note, shapeSupport } = review.candidates[candidateIndex]!;
    return { id: eventId, kind: note.kind, pitch: note.pitch, duration: note.duration, dots: note.dots,
      accidental: note.accidental, strokeIds: note.strokeIds, confidence: shapeSupport };
  });
  const consumed = new Set(events.flatMap((event) => event.strokeIds));
  return replaceMeasuresCommand(review.base, [{ id: decision.measureId, clef: 'treble', timeSignature: decision.timeSignature,
    events, unresolvedStrokeIds: review.base.strokes.filter((s) => !consumed.has(s.id)).map((s) => s.id) }]);
}
