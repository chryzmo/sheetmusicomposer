import { expect, it } from 'vitest';
import { distanceHeadroom } from './review';

it.each([
  [[0], 1], [[0.75], 0.5], [[1.5], 0], [[0, 1.5], 0], [[0.75, 0.3], 0.5], [[0.3, 0.75], 0.5],
])('defines weakest-constituent support for %j, not calibrated confidence', (values, expected) => {
  expect(distanceHeadroom(values)).toBe(expected);
});
it.each([[], [-0.1], [1.50001], [NaN], [Infinity], [-Infinity], [0, 0, 0], Array<number>(1)].map((values) => ({ values })))('rejects unaccepted/invalid distance inputs $values', ({ values }) => {
  expect(() => distanceHeadroom(values)).toThrow();
});
