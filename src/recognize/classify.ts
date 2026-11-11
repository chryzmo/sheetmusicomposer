import { config } from '../config';
import type { Stroke } from '../ink/types';
import type { SimplePrimitive } from './primitives';
import { cloudLinearityRatio } from './geometry';
import { preparePointCloud, rankPointCloud } from './templates';
import type { PointCloudTemplate, PreparedCloud, TemplateCandidate } from './templates';

export type GeometryRejection = 'head-size' | 'head-aspect' | 'stem-size' | 'stem-aspect' | 'stem-strokes' | 'stem-linearity';
export type PrimitiveRejection = 'interrupted' | 'no-templates' | 'geometry' | 'distance' | 'missing-alternative' | 'margin';
export interface PrimitiveCandidate extends TemplateCandidate<SimplePrimitive> {
  readonly geometryRejections: readonly GeometryRejection[];
}
interface ClassificationDetails {
  readonly strokeIds: readonly string[];
  readonly bounds: PreparedCloud['bounds'];
  /** Geometric line-fit descriptor, not confidence; 0 is collinear, 1 isotropic. */
  readonly linearityRatio: number;
  /** Full best-per-label ranking, including geometrically ineligible labels. */
  readonly candidates: readonly PrimitiveCandidate[];
  /** Runner-up distance minus best distance; null without a second label. */
  readonly margin: number | null;
}
export type PrimitiveClassification = ClassificationDetails & (
  | { readonly label: SimplePrimitive; readonly rejection: null }
  | { readonly label: 'unknown'; readonly rejection: PrimitiveRejection }
);

function geometryRejections(label: SimplePrimitive, strokes: readonly Stroke[], bounds: PreparedCloud['bounds'], linearityRatio: number): GeometryRejection[] {
  const { width, height } = bounds;
  const aspect = height > 0 ? width / height : Infinity;
  const reasons: GeometryRejection[] = [];
  // These bounds/ratios remain experimental guesses, with slanted-stem
  // allowances informed by development data, not held-out handwriting.
  if (label !== 'stem') {
    if (width < config.primitiveHeadMinWidth || width > config.primitiveHeadMaxWidth ||
        height < config.primitiveHeadMinHeight || height > config.primitiveHeadMaxHeight) reasons.push('head-size');
    if (aspect < config.primitiveHeadMinAspect || aspect > config.primitiveHeadMaxAspect) reasons.push('head-aspect');
    return reasons;
  }
  if (height < config.primitiveStemMinHeight || height > config.primitiveStemMaxHeight || width > config.primitiveStemMaxWidth) reasons.push('stem-size');
  if (aspect > config.primitiveStemMaxAspect) reasons.push('stem-aspect');
  if (strokes.length > config.primitiveStemMaxStrokes) reasons.push('stem-strokes');
  // Fit the derived body, not total raw travel: natural jitter and retracing
  // must not fail just because the pen revisits earlier positions. This does
  // NOT distinguish a retraced stem from a straight scribble/delete gesture;
  // gesture interpretation and attachment still need separate context.
  if (linearityRatio > config.primitiveStemMaxLinearityRatio) reasons.push('stem-linearity');
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
  const linearityRatio = cloudLinearityRatio(cloud.points);
  const candidates = rankPointCloud(cloud, templates).map((candidate): PrimitiveCandidate => ({
    ...candidate, geometryRejections: geometryRejections(candidate.label, strokes, cloud.bounds, linearityRatio),
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
  const details: ClassificationDetails = { strokeIds: cloud.strokeIds, bounds: cloud.bounds, linearityRatio, candidates, margin };
  return rejection === null
    ? { ...details, label: best!.label, rejection: null }
    : { ...details, label: 'unknown', rejection };
}
