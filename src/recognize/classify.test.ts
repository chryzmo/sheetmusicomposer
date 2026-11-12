import { expect, it } from 'vitest';
import { config } from '../config';
import type { Stroke } from '../ink/types';
import { createBuiltinTemplates } from './builtins';
import { classifyPrimitive, sampleGeometryRejections } from './classify';
import type { SimplePrimitive } from './primitives';
import { preparePointCloud, prepareTemplate } from './templates';
import { cloudLinearityRatio } from './geometry';

const bank = createBuiltinTemplates();
const ink = (points: readonly (readonly [number, number])[], id = 'source'): Stroke => ({
  id, completion: 'complete', points: points.map(([x, y], i) => ({ x, y, t: i % 2 ? 0 : 100, pressure: 0.6, tiltX: 10, tiltY: -5 })),
});
const line = (height = 3, width = 0): Stroke => ink([[0, 0], [width, height]]);
const diamond = (width = 1, height = 0.7): Stroke => ink([[0, height / 2], [width / 2, 0], [width, height / 2], [width / 2, height], [0, height / 2]]);
const example = (label: SimplePrimitive, strokes: readonly Stroke[]) => prepareTemplate(strokes, {
  id: `test-${label}`, label, source: { kind: 'builtin', sampleId: `test/adversarial/${label}` },
});

it.each(bank)('accepts a clear seed-derived $label input without treating it as held-out accuracy', ({ label, cloud }) => {
  // Deliberate seed-derived algorithm checks, not independent handwriting data.
  const scale = label === 'stem' ? 3 : 1;
  const stroke = ink(cloud.points.map(({ x, y }) => [x * scale, y * scale]));
  const result = classifyPrimitive([stroke], bank);
  expect(result.label).toBe(label);
  expect(result.rejection).toBeNull();
  expect(result.candidates).toHaveLength(3);
  expect(result.margin).toBeGreaterThanOrEqual(config.primitiveMinMargin);
  expect(result.candidates[0]?.source.kind).toBe('builtin');
});

it('keeps original staff-space bounds and IDs while leaving frozen raw ink/metadata untouched', () => {
  const strokes = [line()];
  const before = structuredClone(strokes);
  for (const stroke of strokes) {
    stroke.points.forEach(Object.freeze); Object.freeze(stroke.points); Object.freeze(stroke);
  }
  Object.freeze(strokes);
  const result = classifyPrimitive(strokes, bank);
  expect(result.label).toBe('stem');
  expect(result.strokeIds).toEqual(['source']);
  expect(result.bounds).toEqual({ x: 0, y: 0, width: 0, height: 3 });
  expect(strokes).toEqual(before);
  expect(result).not.toHaveProperty('confidence');
});

it('rejects interrupted ink even when the shape is an exact stem match', () => {
  const result = classifyPrimitive([{ ...line(), completion: 'interrupted' }], bank);
  expect(result.label).toBe('unknown');
  expect(result.rejection).toBe('interrupted');
  expect(result.candidates[0]?.label).toBe('stem');
  expect(result.candidates[0]?.distance).toBeCloseTo(0, 12);
});

it('returns unknown for an empty bank, and requires a distinct competing label', () => {
  expect(classifyPrimitive([line()], [])).toMatchObject({ label: 'unknown', rejection: 'no-templates', candidates: [], margin: null });
  const stem = bank.find(({ label }) => label === 'stem')!;
  expect(classifyPrimitive([line()], [stem, { ...stem, id: 'another-stem' }])).toMatchObject({
    label: 'unknown', rejection: 'missing-alternative', margin: null,
  });
});

it('rejects a distant nearest label, not just ambiguous close matches', () => {
  const result = classifyPrimitive([diamond()], [example('noteheadFilled', [line()]), example('noteheadHollow', [line()])]);
  expect(result.candidates[0]?.distance).toBeGreaterThan(config.primitiveMaxDistance);
  expect(result).toMatchObject({ label: 'unknown', rejection: 'distance' });
});

it('rejects an ambiguous label tie deterministically, including a geometrically ineligible runner-up', () => {
  const stroke = diamond();
  for (const competitor of ['noteheadHollow', 'stem'] as const) {
    const templates = [example('noteheadFilled', [stroke]), example(competitor, [stroke])];
    const result = classifyPrimitive([stroke], templates);
    expect(result).toMatchObject({ label: 'unknown', rejection: 'margin', margin: 0 });
    expect(result).toEqual(classifyPrimitive([stroke], templates.toReversed()));
    expect(result.candidates.map(({ label }) => label)).toEqual(['noteheadFilled', competitor]);
    if (competitor === 'stem') expect(result.candidates[1]?.geometryRejections).not.toHaveLength(0);
  }
});

it('does not promote a weaker eligible label when the nearest match fails geometry', () => {
  const result = classifyPrimitive([line()], [example('noteheadFilled', [line()]), example('stem', [line(3, 0.2)])]);
  expect(result).toMatchObject({ label: 'unknown', rejection: 'geometry' });
  expect(result.candidates[0]).toMatchObject({ label: 'noteheadFilled', distance: 0 });
  expect(result.candidates[1]).toMatchObject({ label: 'stem', geometryRejections: [] });
});

it.each([
  { name: 'short stem', stroke: line(0.4), label: 'stem', reason: 'stem-size' },
  { name: 'long stem', stroke: line(6), label: 'stem', reason: 'stem-size' },
  { name: 'over-wide stem', stroke: line(4, 2), label: 'stem', reason: 'stem-size' },
  { name: 'over-leaning stem', stroke: line(1.5, 1.1), label: 'stem', reason: 'stem-aspect' },
  { name: 'bent stem', stroke: ink([[0, 0], [1, 1.5], [0, 3]]), label: 'stem', reason: 'stem-linearity' },
  { name: 'tiny head', stroke: diamond(0.2, 0.12), label: 'noteheadHollow', reason: 'head-size' },
  { name: 'large head', stroke: diamond(2, 1.4), label: 'noteheadHollow', reason: 'head-size' },
  { name: 'narrow head', stroke: diamond(0.4, 1.1), label: 'noteheadHollow', reason: 'head-aspect' },
  { name: 'flat head', stroke: diamond(1.4, 0.3), label: 'noteheadHollow', reason: 'head-aspect' },
] as const)('exposes the geometry gate for $name', ({ stroke, label, reason }) => {
  const result = classifyPrimitive([stroke], bank);
  expect(result.label).toBe('unknown');
  expect(result.candidates.find((candidate) => candidate.label === label)?.geometryRejections).toContain(reason);
});

it('rejects multi-stroke/disconnected stems and retains all source IDs and alternatives', () => {
  const strokes = [ink([[0, 0], [0, 1]], 'first'), ink([[0, 2], [0, 3]], 'second')];
  const result = classifyPrimitive(strokes, bank);
  expect(result).toMatchObject({ label: 'unknown', rejection: 'geometry', strokeIds: ['first', 'second'] });
  expect(result.candidates.find(({ label }) => label === 'stem')?.geometryRejections).toContain('stem-strokes');
});

it.each([config.primitiveStemMinHeight, config.primitiveStemMaxHeight])('accepts a straight stem at the inclusive height boundary %s', (height) => {
  expect(classifyPrimitive([line(height)], bank).label).toBe('stem');
});

it('uses staff-space geometry, not scale-normalized matching distance, for size rejection', () => {
  const normal = classifyPrimitive([line(3)], bank), tiny = classifyPrimitive([line(0.1)], bank);
  expect(normal.label).toBe('stem');
  expect(tiny).toMatchObject({ label: 'unknown', rejection: 'geometry' });
  expect(tiny.candidates[0]?.distance).toBeCloseTo(normal.candidates[0]!.distance, 12);
});

it.each([-1, 1])('checks the distance cutoff on either side of the experimental boundary (%s)', (side) => {
  const stem = bank.find(({ label }) => label === 'stem')!;
  // Adversarial typed clouds with an x-offset give a controlled distance on
  // this vertical query: sum(weights) * offset. Not training/handwriting data.
  const offset = config.primitiveMaxDistance * (1 + side * 1e-8) / ((config.pointCloudSampleCount + 1) / 2);
  const shifted = { ...stem, cloud: { ...stem.cloud, points: stem.cloud.points.map(({ x, y }) => ({ x: x + offset, y })) } };
  const competitor = { ...stem, id: 'competitor', label: 'noteheadFilled' as const,
    cloud: { ...stem.cloud, points: stem.cloud.points.map(({ x, y }) => ({ x: x + 0.4, y })) } };
  const result = classifyPrimitive([line()], [shifted, competitor]);
  expect(result.rejection).toBe(side < 0 ? null : 'distance');
});

it.each([-1, 1])('checks the label margin on either side of the experimental boundary (%s)', (side) => {
  const stem = bank.find(({ label }) => label === 'stem')!;
  const offset = config.primitiveMinMargin * (1 + side * 1e-8) / ((config.pointCloudSampleCount + 1) / 2);
  const competitor = { ...stem, id: 'competitor', label: 'noteheadFilled' as const,
    cloud: { ...stem.cloud, points: stem.cloud.points.map(({ x, y }) => ({ x: x + offset, y })) } };
  const result = classifyPrimitive([line()], [stem, competitor]);
  expect(result.rejection).toBe(side < 0 ? 'margin' : null);
});

it.each([-1, 1])('checks stem linearity around its experimental boundary (%s)', (side) => {
  const bend = (width: number): Stroke => ink([[0, 0], [width, 1.5], [0, 3]]);
  // Symmetric V paths have zero xy covariance and minor variance proportional
  // to width squared. Construct cutoff neighbors, not handwriting samples.
  const unitRatio = cloudLinearityRatio(preparePointCloud([bend(1)]).points);
  const width = Math.sqrt(config.primitiveStemMaxLinearityRatio / unitRatio) * (1 + side * 1e-8);
  const result = classifyPrimitive([bend(width)], bank);
  const reasons = result.candidates.find(({ label }) => label === 'stem')!.geometryRejections;
  expect(reasons.includes('stem-linearity')).toBe(side > 0);
});

it('accepts a retraced straight stem candidate without mistaking traversal for curvature', () => {
  const result = classifyPrimitive([ink([[0, 0], [0, 3], [0, 1], [0, 3]])], bank);
  expect(result.label).toBe('stem');
  expect(result.linearityRatio).toBe(0);
});

it('permits the development-informed slant without rotating templates or promoting a weaker label', () => {
  const stroke = line(3, 1.5);
  const result = classifyPrimitive([stroke], [example('stem', [stroke]), ...bank.filter(({ label }) => label !== 'stem')]);
  expect(result.label).toBe('stem');
  expect(result.bounds).toEqual({ x: 0, y: 0, width: 1.5, height: 3 });
  expect(result.candidates[0]?.geometryRejections).toEqual([]);
});

it('is independent of timestamp order and stem traversal direction', () => {
  const stroke = line();
  const reverse = { ...stroke, points: stroke.points.toReversed() };
  expect(classifyPrimitive([reverse], bank).label).toBe('stem');
  expect(classifyPrimitive([{ ...stroke, points: stroke.points.map((point) => ({ ...point, t: 0 })) }], bank)).toEqual(classifyPrimitive([stroke], bank));
});

it('fails explicitly for invalid typed input or incompatible template clouds', () => {
  expect(() => classifyPrimitive([], bank)).toThrow(RangeError);
  expect(() => classifyPrimitive([{ ...line(), points: [] }], bank)).toThrow(RangeError);
  expect(() => classifyPrimitive([ink([[NaN, 0]])], bank)).toThrow(RangeError);
  expect(() => classifyPrimitive([line(), line()], bank)).toThrow(RangeError);
  expect(() => classifyPrimitive([line()], createBuiltinTemplates(8))).toThrow('equal sample counts');
  expect(() => classifyPrimitive([line()], [bank[0]!, bank[0]!])).toThrow('unique');
});

it('reports a sample\'s own geometry problems for the label it would be saved under', () => {
  expect(sampleGeometryRejections('stem', [line(3)])).toEqual([]);
  expect(sampleGeometryRejections('noteheadHollow', [diamond()])).toEqual([]);
  expect(sampleGeometryRejections('noteheadFilled', [diamond(0.1, 0.1)])).toContain('head-size');
  expect(sampleGeometryRejections('stem', [line(0.5)])).toContain('stem-size');
  expect(sampleGeometryRejections('stem', [diamond()])).toContain('stem-size');
  // A stem must be one stroke, and a tilted stem past the slant limit is refused.
  expect(sampleGeometryRejections('stem', [line(3), line(3)].map((stroke, i) => ({ ...stroke, id: `s${i}` })))).toContain('stem-strokes');
  expect(sampleGeometryRejections('stem', [line(3, 3)])).toContain('stem-aspect');
  // Agrees with classification: a candidate flagged here is rejected there.
  expect(classifyPrimitive([line(0.5)], bank).label).toBe('unknown');
});
