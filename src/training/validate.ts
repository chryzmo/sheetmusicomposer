import type { Stroke } from '../ink/types';
import { sampleGeometryRejections } from '../recognize/classify';
import type { GeometryRejection } from '../recognize/classify';
import type { SimplePrimitive } from '../recognize/primitives';
import { decodeUserTemplateSample, encodeUserTemplateSample, userTemplates } from '../recognize/user-templates';
import { errorMessage } from '../store/autosave';

export const labelNames: Readonly<Record<SimplePrimitive, string>> = {
  noteheadFilled: 'Filled notehead', noteheadHollow: 'Hollow notehead', stem: 'Stem',
};

const problemText: Readonly<Record<GeometryRejection, string>> = {
  'head-size': 'Too small or too large for a notehead.', 'head-aspect': 'Too narrow or too flat for a notehead.',
  'stem-size': 'Too short or too long for a stem.', 'stem-aspect': 'Too slanted for a stem.',
  'stem-strokes': 'A stem must be one stroke.', 'stem-linearity': 'Not straight enough for a stem.',
};

/** Plain-language reason one stroke cannot be saved as a `label` sample, or ''
 * when it can. The same checks the Personal templates screen and the guided
 * trainer both apply: a valid complete stroke that passes the label's own geometry gates.
 */
export function sampleProblem(stroke: Stroke, label: SimplePrimitive): string {
  try {
    const sample = { id: 'check', label, createdAt: 0, strokes: [stroke] };
    decodeUserTemplateSample(encodeUserTemplateSample(sample));
    userTemplates([sample]);
    const rejections = sampleGeometryRejections(label, [stroke]);
    return rejections.length === 0 ? '' : `Not saved: ${rejections.map((r) => problemText[r]).join(' ')}`;
  } catch (error) {
    const message = errorMessage(error);
    return message.includes('complete') ? 'Not saved: this stroke was interrupted. Draw it again.' : `Not saved: ${message}.`;
  }
}
