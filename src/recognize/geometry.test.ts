import { expect, it } from 'vitest';
import { config } from '../config';
import { cloudInkDensity, cloudLinearityRatio } from './geometry';
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

const stroke = (points: readonly (readonly [number, number])[]) => [{ id: 's', points: points.map(([x, y]) => ({ x, y })) }];

it('measures ink density as the resampled path length with the largest side normalized to one', () => {
  // A straight line of any length is one unit long once normalized.
  expect(cloudInkDensity(preparePointCloud(stroke([[0, 0], [0, 5]])).points)).toBeCloseTo(1, 6);
  // An open loop is about pi; retracing it three times is about three times as dense.
  const loop = Array.from({ length: 65 }, (_, i): [number, number] => [Math.cos(i / 64 * 2 * Math.PI), Math.sin(i / 64 * 2 * Math.PI)]);
  const once = cloudInkDensity(preparePointCloud(stroke(loop)).points);
  expect(once).toBeGreaterThan(2.9);
  expect(once).toBeLessThan(3.2);
  const thrice = cloudInkDensity(preparePointCloud(stroke([...loop, ...loop, ...loop])).points);
  expect(thrice / once).toBeGreaterThan(2.7);
});

it('does not depend on scale, position, or how finely the pen sampled the path', () => {
  const coarse = Array.from({ length: 17 }, (_, i): [number, number] => [Math.cos(i / 16 * 2 * Math.PI), 0.7 * Math.sin(i / 16 * 2 * Math.PI)]);
  const fine = Array.from({ length: 401 }, (_, i): [number, number] => [Math.cos(i / 400 * 2 * Math.PI), 0.7 * Math.sin(i / 400 * 2 * Math.PI)]);
  const moved = fine.map(([x, y]): [number, number] => [x * 37 + 500, y * 37 - 20]);
  const a = cloudInkDensity(preparePointCloud(stroke(coarse)).points);
  const b = cloudInkDensity(preparePointCloud(stroke(fine)).points);
  const c = cloudInkDensity(preparePointCloud(stroke(moved)).points);
  expect(Math.abs(b - c)).toBeLessThan(1e-9);
  expect(Math.abs(a - b)).toBeLessThan(0.15);
});

it('rejects a cloud it cannot measure', () => {
  expect(() => cloudInkDensity([])).toThrow(RangeError);
  expect(() => cloudInkDensity([{ x: 0, y: 0 }])).toThrow(RangeError);
  expect(() => cloudInkDensity([{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }])).toThrow(RangeError);
});
