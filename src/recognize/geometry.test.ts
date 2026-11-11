import { expect, it } from 'vitest';
import { config } from '../config';
import { cloudLinearityRatio } from './geometry';
import { preparePointCloud } from './templates';
import type { CloudPoint } from './templates';

it.each([
  [{ x: 0, y: -1 }, { x: 0, y: 1 }],
  [{ x: -1, y: 0 }, { x: 1, y: 0 }],
  [{ x: -0.5, y: -1 }, { x: 0, y: 0 }, { x: 0.5, y: 1 }],
].map((points) => ({ points })))('returns zero for collinear normalized geometry %#', ({ points }) => {
  expect(cloudLinearityRatio(points)).toBeCloseTo(0, 14);
});

it('returns one for isotropic or degenerate geometry, never NaN', () => {
  expect(cloudLinearityRatio([{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }])).toBe(1);
  expect(cloudLinearityRatio([{ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }])).toBe(1);
  expect(cloudLinearityRatio([{ x: 0, y: 0 }, { x: 0, y: Number.MIN_VALUE }])).toBe(1);
});

it('measures the expected minor/major variance ratio', () => {
  const ratio = 0.01;
  const points = [{ x: 0.5, y: 0 }, { x: -0.5, y: 0 }, { x: 0, y: 0.5 * Math.sqrt(ratio) }, { x: 0, y: -0.5 * Math.sqrt(ratio) }];
  expect(cloudLinearityRatio(points)).toBeCloseTo(ratio, 14);
});

it('is invariant to translation, uniform scale, rotation, point order, and equal duplication', () => {
  const points = [{ x: -0.4, y: -0.3 }, { x: 0.2, y: 0.3 }, { x: 0.1, y: 0.2 }];
  const original = structuredClone(points);
  const expected = cloudLinearityRatio(points);
  const variants = [
    points.toReversed(), [...points, ...points],
    points.map(({ x, y }) => ({ x: 0.1 - 0.5 * y, y: -0.2 + 0.5 * x })),
  ];
  for (const variant of variants) expect(cloudLinearityRatio(variant)).toBeCloseTo(expected, 14);
  expect(points).toEqual(original);
});

it('describes shape rather than total pen travel after immutable resampling', () => {
  const cloud = preparePointCloud([{ id: 'retraced', points: [{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 0, y: 1 }, { x: 0, y: 3 }] }]);
  expect(cloudLinearityRatio(cloud.points)).toBe(0);
  const bend = preparePointCloud([{ id: 'bend', points: [{ x: 0, y: 0 }, { x: 1, y: 1.5 }, { x: 0, y: 3 }] }]);
  expect(cloudLinearityRatio(bend.points)).toBeGreaterThan(config.primitiveStemMaxLinearityRatio);
});

it.each([
  [], [{ x: 0, y: 0 }], Array<CloudPoint>(config.maxPointCloudSampleCount + 1).fill({ x: 0, y: 0 }),
  [{ x: NaN, y: 0 }, { x: 0, y: 1 }], [{ x: 0, y: Infinity }, { x: 0, y: 1 }],
  [{ x: 2, y: 0 }, { x: 0, y: 1 }],
].map((points) => ({ points })))('rejects invalid or unbounded cloud input %#', ({ points }) => {
  expect(() => cloudLinearityRatio(points)).toThrow(RangeError);
});
