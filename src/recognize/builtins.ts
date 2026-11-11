import { config } from '../config';
import type { SimplePrimitive } from './primitives';
import { prepareTemplate } from './templates';
import type { CloudPoint, PointCloudTemplate } from './templates';

/** Hand-authored synthetic geometry, NOT recorded ink or HOMUS data. This tiny
 * seed bank is for bootstrapping experiments, not a handwriting baseline.
 * Template coordinates describe examples, not recognition thresholds. No
 * upstream demo gesture samples or held-out fixture strokes are reused here.
 */
export function createBuiltinTemplates(count: number = config.pointCloudSampleCount): PointCloudTemplate<SimplePrimitive>[] {
  // A modest upward-right slant is one authored writing style, not a rule that
  // all noteheads must have it. Future reviewed templates must cover variation.
  const slant = -0.25;
  const tilt = (x: number, y: number): CloudPoint => ({
    x: x * Math.cos(slant) - y * Math.sin(slant),
    y: x * Math.sin(slant) + y * Math.cos(slant),
  });
  const hollow = Array.from({ length: 49 }, (_, i) => {
    const angle = 2 * Math.PI * i / 48;
    return tilt(0.55 * Math.cos(angle), 0.35 * Math.sin(angle));
  });
  const filled: CloudPoint[] = [];
  for (let i = 0; i <= 12; i++) {
    const y = -1 + i / 6;
    const extent = 0.55 * Math.sqrt(Math.max(0, 1 - y * y));
    filled.push(tilt(i % 2 ? extent : -extent, 0.35 * y), tilt(i % 2 ? -extent : extent, 0.35 * y));
  }
  const examples: { label: SimplePrimitive; points: readonly CloudPoint[]; sampleId: string }[] = [
    { label: 'noteheadFilled', points: filled, sampleId: 'synthetic/filled-zigzag-v1' },
    { label: 'noteheadHollow', points: hollow, sampleId: 'synthetic/hollow-ellipse-v1' },
    { label: 'stem', points: [{ x: 0, y: 0 }, { x: 0, y: 3 }], sampleId: 'synthetic/vertical-stem-v1' },
  ];
  return examples.map(({ label, points, sampleId }) => prepareTemplate([{ id: sampleId, points }], {
    id: `builtin-${label}-v1`, label, source: { kind: 'builtin', sampleId },
  }, count));
}
