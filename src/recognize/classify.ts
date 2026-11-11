import { config } from '../config';
import type { Stroke } from '../ink/types';
import type { SimplePrimitive } from './primitives';
import { preparePointCloud, rankPointCloud } from './templates';
import type { PointCloudTemplate, PreparedCloud, TemplateCandidate } from './templates';

export type GeometryRejection = 'head-size' | 'head-aspect' | 'stem-size' | 'stem-aspect' | 'stem-strokes' | 'stem-straightness';
export type PrimitiveRejection = 'interrupted' | 'no-templates' | 'geometry' | 'distance' | 'missing-alternative' | 'margin';
export interface PrimitiveCandidate extends TemplateCandidate<SimplePrimitive> {
  readonly geometryRejections: readonly GeometryRejection[];
}
interface ClassificationDetails {
  readonly strokeIds: readonly string[];
  readonly bounds: PreparedCloud['bounds'];
  /** Full best-per-label ranking, including geometrically ineligible labels. */
  readonly candidates: readonly PrimitiveCandidate[];
  /** Runner-up distance minus best distance; null without a second label. */
  readonly margin: number | null;
}
export type PrimitiveClassification = ClassificationDetails & (
  | { readonly label: SimplePrimitive; readonly rejection: null }
  | { readonly label: 'unknown'; readonly rejection: PrimitiveRejection }
);

function geometryRejections(label: SimplePrimitive, strokes: readonly Stroke[], bounds: PreparedCloud['bounds']): GeometryRejection[] {
  const { width, height } = bounds;
  const aspect = height > 0 ? width / height : Infinity;
  const reasons: GeometryRejection[] = [];
  // These bounds/ratios are conservative guesses, not learned handwriting
  // statistics. Synthetic safety fixtures exercise their rejection behavior.
  if (label !== 'stem') {
    if (width < config.primitiveHeadMinWidth || width > config.primitiveHeadMaxWidth ||
        height < config.primitiveHeadMinHeight || height > config.primitiveHeadMaxHeight) reasons.push('head-size');
    if (aspect < config.primitiveHeadMinAspect || aspect > config.primitiveHeadMaxAspect) reasons.push('head-aspect');
    return reasons;
  }
  if (height < config.primitiveStemMinHeight || height > config.primitiveStemMaxHeight || width > config.primitiveStemMaxWidth) reasons.push('stem-size');
  if (aspect > config.primitiveStemMaxAspect) reasons.push('stem-aspect');
  if (strokes.length > config.primitiveStemMaxStrokes) reasons.push('stem-strokes');
  // A shape cloud forgets traversal. Check the raw pen-down path too so an
  // up/down scribble cannot become a stem merely by having a narrow cloud.
  const stroke = strokes[0]!;
  let length = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1]!, b = stroke.points[i]!;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const first = stroke.points[0]!, last = stroke.points.at(-1)!;
  const straightness = length > 0 ? Math.hypot(last.x - first.x, last.y - first.y) / length : 0;
  if (straightness < config.primitiveStemMinStraightness) reasons.push('stem-straightness');
  return reasons;
}

/** Experimental, DOM-free classifier for an ALREADY GROUPED staff-space input.
 * No grouping, timing assumptions, confidence probabilities, or model edits.
 * Complete but unsupported/uncertain groups return unknown with all alternatives.
 * Invalid typed inputs/template banks throw, rather than hiding programmer or
 * decoder errors as ordinary low-confidence handwriting. Never pass unvalidated
 * persisted data here. The template bank is explicit; there is no hidden training.
 */
export function classifyPrimitive(strokes: readonly Stroke[], templates: readonly PointCloudTemplate<SimplePrimitive>[]): PrimitiveClassification {
  const cloud = preparePointCloud(strokes);
  const candidates = rankPointCloud(cloud, templates).map((candidate): PrimitiveCandidate => ({
    ...candidate, geometryRejections: geometryRejections(candidate.label, strokes, cloud.bounds),
  }));
  const best = candidates[0], second = candidates[1];
  const margin = best && second ? second.distance - best.distance : null;
  // Do NOT discard ineligible labels and promote a farther-away match. Also
  // require a distinct runner-up; a one-label bank supplies no ambiguity check.
  const rejection: PrimitiveRejection | null = strokes.some((stroke) => stroke.completion !== 'complete') ? 'interrupted'
    : !best ? 'no-templates'
    : best.geometryRejections.length > 0 ? 'geometry'
    : best.distance > config.primitiveMaxDistance ? 'distance'
    : margin === null ? 'missing-alternative'
    : margin < config.primitiveMinMargin ? 'margin'
    : null;
  const details: ClassificationDetails = { strokeIds: cloud.strokeIds, bounds: cloud.bounds, candidates, margin };
  return rejection === null
    ? { ...details, label: best!.label, rejection: null }
    : { ...details, label: 'unknown', rejection };
}
