import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseFixture } from '../fixtures/schema';
import { config } from '../config';
import type { Stroke } from '../ink/types';
import { createBuiltinTemplates } from './builtins';
import { pointCloudDistance, preparePointCloud, prepareTemplate, rankPointCloud } from './templates';
import type { CloudStroke } from './templates';

function strokes(...paths: (readonly [number, number])[][]): CloudStroke[] {
  return paths.map((points, i) => ({ id: `stroke-${i}`, points: points.map(([x, y]) => ({ x, y })) }));
}
const vertical = strokes([[0, 0], [0, 3]]);
const horizontal = strokes([[0, 0], [3, 0]]);
const corner = strokes([[0, 0], [1, 0]], [[1, 0], [1, 2]]);
const box = strokes([[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]);
const oblique = strokes([[0.13, -0.2], [1.4, 0.3], [0.7, 1.2], [0.13, -0.2]]);
const template = (id: string, label: string, ink: readonly CloudStroke[]) => prepareTemplate(ink, {
  id, label, source: { kind: 'builtin', sampleId: `test/${id}` },
});

it('resamples, uniformly scales, and centers a line while retaining original geometry/IDs', () => {
  const cloud = preparePointCloud(strokes([[10, -5], [10, 7]]));
  expect(cloud.points).toHaveLength(32);
  expect(cloud.bounds).toEqual({ x: 10, y: -5, width: 0, height: 12 });
  expect(cloud.strokeIds).toEqual(['stroke-0']);
  expect(cloud.points[0]?.x).toBe(0);
  expect(cloud.points[0]?.y).toBeCloseTo(-0.5, 12);
  expect(cloud.points.at(-1)?.y).toBeCloseTo(0.5, 12);
  expect(cloud.points.reduce((sum, point) => sum + point.y, 0)).toBeCloseTo(0, 12);
});

// Goldens generated with the official July 14, 2018 pdollar.js, not this port.
// Source SHA-256 and full license are in public/third-party-notices.txt. Shapes
// are authored here; none of the upstream demo gesture samples are reused.
it.each([
  [vertical, horizontal, 4.525483774307485],
  [vertical, corner, 1.897279810058725],
  [vertical, box, 5.167081931930536],
  [horizontal, corner, 4.638553601039313],
  [horizontal, box, 3.728797572372799],
  [corner, box, 3.977760097541297],
  [oblique, vertical, 3.4349151644831246],
  [oblique, corner, 2.57036308376742],
] as const)('matches the upstream weighted-distance golden %#', (a, b, expected) => {
  expect(pointCloudDistance(preparePointCloud(a), preparePointCloud(b))).toBeCloseTo(expected, 10);
});

it('matches the upstream distance for real Pencil strokes without changing raw data', () => {
  const fixture = parseFixture(readFileSync(new URL('../../fixtures/recorded/quarter-e4.json', import.meta.url), 'utf8'));
  const before = structuredClone(fixture);
  const [head, stem] = fixture.document.strokes;
  if (!head || !stem) throw new Error('Expected the recorded head/stem input');
  // Algorithm parity only: this comparison is not a label/unknown decision.
  expect(pointCloudDistance(preparePointCloud([head]), preparePointCloud([stem]))).toBeCloseTo(3.1696689029110745, 10);
  expect(fixture).toEqual(before);
});

it('is translation/uniform-scale invariant without changing aspect or orientation', () => {
  const transformed = box.map((stroke) => ({ ...stroke, points: stroke.points.map(({ x, y }) => ({ x: 100 + 17 * x, y: -80 + 17 * y })) }));
  const cloud = preparePointCloud(box);
  expect(pointCloudDistance(cloud, preparePointCloud(transformed))).toBeCloseTo(0, 10);
  expect(pointCloudDistance(preparePointCloud(vertical), preparePointCloud(horizontal))).toBeGreaterThan(1);
  const square = strokes([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  expect(pointCloudDistance(cloud, preparePointCloud(square))).toBeGreaterThan(0.1);
});

it('keeps a multistroke shape a better match after order/direction changes', () => {
  const reversed = corner.toReversed().map((stroke) => ({ ...stroke, points: stroke.points.toReversed() }));
  const query = preparePointCloud(reversed);
  expect(pointCloudDistance(query, preparePointCloud(corner))).toBeLessThan(pointCloudDistance(query, preparePointCloud(horizontal)));
});

it('never interpolates the pen-up gap between disjoint strokes', () => {
  const cloud = preparePointCloud(strokes([[-100, 0], [-90, 0]], [[90, 0], [100, 0]]));
  expect(cloud.points.every(({ x }) => Math.abs(x) > 0.4)).toBe(true);
});

it('handles taps, repeated points, and disconnected zero-path taps without NaN or loops', () => {
  for (const ink of [strokes([[2, 3]]), strokes([[2, 3], [2, 3]]), strokes([[0, 0]], [[10, 0]])]) {
    const cloud = preparePointCloud(ink);
    expect(cloud.points).toHaveLength(32);
    expect(cloud.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(pointCloudDistance(cloud, cloud)).toBe(0);
  }
  const tap = preparePointCloud(strokes([[2, 3]]));
  expect(tap.points.every(({ x, y }) => x === 0 && y === 0)).toBe(true);
  const disconnected = preparePointCloud(strokes([[0, 0]], [[10, 0]]));
  expect(new Set(disconnected.points.map(({ x }) => x)).size).toBe(2);
});

it('handles repeated segments and extreme finite scales', () => {
  for (const size of [Number.MIN_VALUE, 1e-300, 1e300]) {
    const cloud = preparePointCloud(strokes([[0, 0], [0, 0], [0, size]]));
    expect(pointCloudDistance(cloud, preparePointCloud(vertical))).toBeCloseTo(0, 10);
  }
});

it('does not mutate frozen raw samples, including time, pressure, tilt, and completion', () => {
  const raw: readonly Stroke[] = [{ id: 'real-source', completion: 'interrupted', points: [100, 90, 0].map((t, i) => ({
    x: i, y: 4, t, pressure: 0.6, tiltX: 20, tiltY: -10,
  })) }];
  const original = structuredClone(raw);
  for (const stroke of raw) {
    stroke.points.forEach(Object.freeze);
    Object.freeze(stroke.points); Object.freeze(stroke);
  }
  Object.freeze(raw);
  const cloud = preparePointCloud(raw);
  expect(raw).toEqual(original);
  expect(cloud.strokeIds).toEqual(['real-source']);
  expect(cloud.points).not.toBe(raw[0]?.points);
});

it.each([0, 1, 3.5, NaN, Infinity, config.maxPointCloudSampleCount + 1])('rejects invalid sample count %s', (count) => {
  expect(() => preparePointCloud(vertical, count)).toThrow(RangeError);
});

const invalidInk: CloudStroke[][] = [
  [], [{ id: 'empty', points: [] }],
  strokes([[NaN, 0], [0, 1]]), strokes([[0, Infinity]]),
  strokes([[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0]]),
  [{ id: '', points: [{ x: 0, y: 0 }] }], [...vertical, ...vertical],
];
it.each(invalidInk.map((ink) => ({ ink })))('rejects empty/malformed or overflowing ink %#', ({ ink }) => {
  expect(() => preparePointCloud(ink)).toThrow(RangeError);
});

it('requires equally sized, finite normalized clouds', () => {
  const cloud = preparePointCloud(vertical);
  expect(() => pointCloudDistance(cloud, preparePointCloud(vertical, 8))).toThrow('equal sample counts');
  for (const x of [NaN, Infinity, 2]) {
    expect(() => pointCloudDistance(cloud, { ...cloud, points: cloud.points.map((point) => ({ ...point, x })) })).toThrow('normalized');
  }
});

it('ranks the best template per label, with meaningful runner-up distances and provenance', () => {
  const query = preparePointCloud(vertical);
  const bank = [template('horizontal', 'horizontal', horizontal), template('stem-z', 'stem', corner), template('stem-a', 'stem', vertical)];
  const before = structuredClone(bank);
  const candidates = rankPointCloud(query, bank);
  expect(candidates.map(({ label }) => label)).toEqual(['stem', 'horizontal']);
  expect(candidates[0]).toEqual({ label: 'stem', distance: 0, templateId: 'stem-a', source: { kind: 'builtin', sampleId: 'test/stem-a' } });
  expect(candidates[1]?.distance).toBeCloseTo(pointCloudDistance(query, bank[0]!.cloud), 12);
  expect(bank).toEqual(before);
});

it('has deterministic label/template ties independent of insertion order, and no forced empty-bank winner', () => {
  const cloud = preparePointCloud(vertical);
  const bank = [template('z', 'same', vertical), template('a', 'same', vertical), template('third', 'another', vertical)];
  expect(rankPointCloud(cloud, bank)).toEqual(rankPointCloud(cloud, bank.toReversed()));
  expect(rankPointCloud(cloud, bank).map(({ templateId }) => templateId)).toEqual(['third', 'a']);
  expect(rankPointCloud(cloud, [])).toEqual([]);
  expect(() => rankPointCloud(cloud, [bank[0]!, bank[0]!])).toThrow('unique');
});

it('rejects empty template identity/label/source metadata', () => {
  const metadata = { id: 'template', label: 'stem', source: { kind: 'builtin' as const, sampleId: 'sample' } };
  for (const bad of [{ ...metadata, id: '' }, { ...metadata, label: ' ' }, { ...metadata, source: { ...metadata.source, sampleId: '' } }]) {
    expect(() => prepareTemplate(vertical, bad)).toThrow('nonempty');
  }
});

it('provides three explicitly synthetic seed templates, not a measured handwriting baseline', () => {
  const bank = createBuiltinTemplates();
  expect(bank.map(({ label }) => label)).toEqual(['noteheadFilled', 'noteheadHollow', 'stem']);
  expect(bank.every(({ source }) => source.kind === 'builtin' && source.sampleId.startsWith('synthetic/'))).toBe(true);
  expect(rankPointCloud(preparePointCloud(vertical), bank)[0]?.label).toBe('stem');
  expect(createBuiltinTemplates(8).every(({ cloud }) => cloud.points.length === 8)).toBe(true);
});

it('breaks exact distance ties toward a user template, but never over a closer built-in one', () => {
  const strokes = [{ id: 's', points: [{ x: 0, y: 0 }, { x: 1, y: 0.2 }, { x: 2, y: 0 }, { x: 3, y: 1 }] }];
  const query = preparePointCloud(strokes);
  const mk = (id: string, label: 'a' | 'b', kind: 'builtin' | 'user', cloudStrokes = strokes) =>
    prepareTemplate(cloudStrokes, { id, label, source: { kind, sampleId: id } });
  // Built-in would win on label AND ID ordering, so only the source rule can put user first.
  const tie = rankPointCloud(query, [mk('a-builtin', 'a', 'builtin'), mk('z-user', 'b', 'user')]);
  expect(tie.map((c) => c.templateId)).toEqual(['z-user', 'a-builtin']);
  expect(tie[0]!.distance).toBe(tie[1]!.distance);
  // Same label: the user template is the reported best on an exact tie.
  expect(rankPointCloud(query, [mk('a-builtin', 'a', 'builtin'), mk('z-user', 'a', 'user')]).map((c) => c.templateId)).toEqual(['z-user']);
  // A slightly closer built-in still wins: this is a tie-break, not a bonus.
  const off = [{ id: 's', points: [{ x: 0, y: 0 }, { x: 1, y: 0.2 }, { x: 2, y: 0 }, { x: 3, y: 1.4 }] }];
  const closer = rankPointCloud(query, [mk('z-user', 'b', 'user', off), mk('a-builtin', 'a', 'builtin')]);
  expect(closer.map((c) => c.templateId)).toEqual(['a-builtin', 'z-user']);
});
