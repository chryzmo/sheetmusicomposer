import { expect, it } from 'vitest';
import { config } from '../config';
import type { Stroke } from '../ink/types';
import { groupStrokes } from './group';
import type { GroupLocation, ObservedStroke } from './group';

const location: GroupLocation = { measureId: 'a', beatId: '1' };
function ink(id: string, xy: readonly (readonly [number, number])[], completion: Stroke['completion'] = 'complete'): Stroke {
  return { id, completion, points: xy.map(([x, y], i) => ({ x, y, t: 100 - i, pressure: 0.63, tiltX: -12, tiltY: 18 })) };
}
const outline = (id = 'outline', x = 4): Stroke => ink(id, [[x, 3.7], [x - 0.5, 4], [x, 4.3], [x + 0.5, 4], [x, 3.7]]);
const left = (id = 'left'): Stroke => ink(id, [[4, 3.7], [3.5, 4], [4, 4.3]]);
const right = (id = 'right'): Stroke => ink(id, [[4, 4.3], [4.5, 4], [4, 3.7]]);
const fill = (id = 'fill'): Stroke => ink(id, [[3.8, 3.9], [4.2, 4.1], [3.8, 4.2]]);
const observe = (stroke: Stroke, startedAt = 0, endedAt = startedAt + 40, at: GroupLocation = location): ObservedStroke => ({ stroke, startedAt, endedAt, location: at });
const ids = (result: ReturnType<typeof groupStrokes>): readonly (readonly string[])[] => [...result.closed, ...(result.pending ? [result.pending] : [])].map((g) => g.strokeIds);

it('accepts an empty window and optional current/active location', () => {
  expect(groupStrokes([], { now: 0 })).toEqual({ closed: [], pending: null, readyMeasureIds: [] });
  expect(groupStrokes([], { now: 10, active: { startedAt: 5, location } })).toEqual({ closed: [], pending: null, readyMeasureIds: [] });
});

it.each([0, config.groupPauseMs - 0.001, config.groupPauseMs])('closes a pending group at the inclusive idle timeout (%s ms)', (elapsed) => {
  const result = groupStrokes([observe(outline())], { now: 40 + elapsed });
  expect(result.closed).toHaveLength(elapsed >= config.groupPauseMs ? 1 : 0);
  expect(result.pending === null).toBe(elapsed >= config.groupPauseMs);
  if (elapsed >= config.groupPauseMs) expect(result.closed[0]?.closedBy).toBe('pause');
  expect(result.readyMeasureIds).toEqual([]); // A symbol pause is NOT measure completion.
});

it('explicitly finishes a measure without waiting for the pause', () => {
  const result = groupStrokes([observe(outline())], { now: 40, finishMeasure: true });
  expect(result.closed[0]?.closedBy).toBe('finish-measure');
  expect(result.readyMeasureIds).toEqual(['a']);
});

it('joins compatible compact outline fragments without using primitive labels', () => {
  const result = groupStrokes([observe(left()), observe(right(), 60)], { now: 100, finishMeasure: true });
  expect(ids(result)).toEqual([['left', 'right']]);
  expect(result.closed[0]?.bounds).toEqual({ x: 3.5, y: 3.7, width: 1, height: 0.5999999999999996 });
});

it('supports reversed fragment direction without reversing or sorting raw samples', () => {
  const a = left(), b = right();
  for (const strokes of [[a, b], [{ ...a, points: [...a.points].reverse() }, b], [b, a]]) {
    const result = groupStrokes(strokes.map((s, i) => observe(s, i * 100)), { now: 140, finishMeasure: true });
    expect(ids(result)).toEqual([strokes.map((s) => s.id)]);
  }
});

it('extends an open chain through one unambiguous endpoint link', () => {
  const a = ink('a', [[3.5, 4], [3.7, 3.7], [4, 3.7]]);
  const b = ink('b', [[4, 3.7], [4.3, 3.8], [4.5, 4]]);
  const c = ink('c', [[4.5, 4], [4.2, 4.3], [3.5, 4]]);
  expect(ids(groupStrokes([a, b, c].map((s, i) => observe(s, i * 100)), { now: 240, finishMeasure: true }))).toEqual([['a', 'b', 'c']]);
});

it.each([false, true])('joins substantial inset fill/retracing with an outline in either order (fill first=%s)', (fillFirst) => {
  const strokes = fillFirst ? [fill(), outline()] : [outline(), fill()];
  expect(ids(groupStrokes(strokes.map((s, i) => observe(s, i * 100)), { now: 140, finishMeasure: true }))).toEqual([strokes.map((s) => s.id)]);
});

it.each([config.groupPauseMs - 0.001, config.groupPauseMs])('never joins across an inclusive pause boundary (%s)', (gap) => {
  const result = groupStrokes([observe(outline()), observe(fill(), 40 + gap)], { now: 80 + gap, finishMeasure: true });
  expect(result.closed).toHaveLength(gap >= config.groupPauseMs ? 2 : 1);
  if (gap >= config.groupPauseMs) expect(result.closed[0]?.closedBy).toBe('pause');
});

it('separates head and attached stem instead of treating a whole note glyph as one primitive', () => {
  const result = groupStrokes([observe(outline()), observe(ink('stem', [[4.5, 1], [4.5, 4]]), 100)], { now: 140, finishMeasure: true });
  expect(ids(result)).toEqual([['outline'], ['stem']]);
  expect(result.closed.map((g) => g.closedBy)).toEqual(['spatial-separation', 'isolated']);
});

it.each(([
  [[4.6, 4]], // augmentation-like tap
  [[4.5, 3.9], [4.6, 4], [4.5, 4.1]], // small dot
  [[3.5, 4], [4.5, 4]], // horizontal ledger/fill stroke
  [[4.5, 3.7], [4.5, 4.3]], // thin vertical fragment
] as const).map((xy) => ({ xy })))('keeps tiny/dot/axis-line ink separate even when it touches a head (%j)', ({ xy }) => {
  const result = groupStrokes([observe(outline()), observe(ink('extra', xy), 100)], { now: 140, finishMeasure: true });
  expect(ids(result)).toEqual([['outline'], ['extra']]);
  expect(result.closed[1]?.closedBy).toBe('isolated');
});

it('does not merge nearby closed heads, distant pieces, oversized unions, or unconnected open paths', () => {
  const pairs = [
    [outline(), outline('other', 4.8)],
    [left(), ink('other', [[5, 4.3], [5.5, 4], [5, 3.7]])],
    [ink('wide', [[3, 4], [3.8, 3.7], [4.6, 4]]), ink('other', [[4.6, 4], [5.2, 4.3], [6, 4]])],
    [left(), ink('other', [[3.7, 3.9], [4.2, 4], [3.7, 4.1]])],
  ];
  for (const pair of pairs) {
    expect(ids(groupStrokes(pair.map((s, i) => observe(s, i * 100)), { now: 140, finishMeasure: true }))).toEqual(pair.map((s) => [s.id]));
  }
});

it('rejects competing endpoint pairings instead of choosing nearest', () => {
  const a = ink('a', [[4, 4], [3.5, 3.7], [4.12, 4]]);
  const b = ink('b', [[4.06, 4], [4.5, 4.3], [4.06, 4.12]]);
  expect(ids(groupStrokes([observe(a), observe(b, 100)], { now: 140, finishMeasure: true }))).toEqual([['a'], ['b']]);
});

it('leaves interrupted strokes isolated and never joins them to a complete fragment', () => {
  const result = groupStrokes([observe(left()), observe({ ...right(), completion: 'interrupted' }, 100), observe(fill(), 200)], { now: 240, finishMeasure: true });
  expect(ids(result)).toEqual([['left'], ['right'], ['fill']]);
  expect(result.closed.map((g) => g.closedBy)).toEqual(['interrupted', 'interrupted', 'finish-measure']);
});

it.each([
  [{ measureId: 'a', beatId: '2' }, 'beat-change', []],
  [{ measureId: 'b', beatId: '1' }, 'measure-change', ['a']],
] as const)('closes on supplied region changes with or without a next stroke (%j)', (next, reason, ready) => {
  const beforePenUp = groupStrokes([observe(outline())], { now: 60, location: next });
  expect(beforePenUp.closed[0]?.closedBy).toBe(reason);
  expect(beforePenUp.readyMeasureIds).toEqual(ready);
  const afterPenUp = groupStrokes([observe(outline()), observe(fill(), 100, 140, next)], { now: 140 });
  expect(ids(afterPenUp)).toEqual([['outline'], ['fill']]);
  expect(afterPenUp.closed[0]?.closedBy).toBe(reason);
  expect(afterPenUp.readyMeasureIds).toEqual(ready);
});

it('does not combine null/unmapped beat regions with mapped ones', () => {
  const result = groupStrokes([observe(left(), 0, 40, { ...location, beatId: null }), observe(right(), 100)], { now: 140 });
  expect(ids(result)).toEqual([['left'], ['right']]);
  expect(result.closed[0]?.closedBy).toBe('beat-change');
});

it('removes a revisited measure from the ready snapshot', () => {
  const observations = [observe(outline('first-a')), observe(outline('b'), 100, 140, { measureId: 'b', beatId: '1' }), observe(outline('last-a'), 200)];
  const result = groupStrokes(observations, { now: 240 });
  expect(result.readyMeasureIds).toEqual(['b']);
  expect(result.pending?.strokeIds).toEqual(['last-a']);
  expect(groupStrokes(observations, { now: 240, finishMeasure: true }).readyMeasureIds).toEqual(['a', 'b']);
});

it('holds an idle timeout during a stroke observed before the deadline, including long pen contact', () => {
  const result = groupStrokes([observe(left())], { now: 10000, active: { startedAt: 100, location } });
  expect(result.closed).toEqual([]);
  expect(result.pending?.strokeIds).toEqual(['left']);
  expect(result.readyMeasureIds).toEqual([]);
  const completed = groupStrokes([observe(left()), observe(right(), 100, 10000)], { now: 10000, finishMeasure: true });
  expect(ids(completed)).toEqual([['left', 'right']]);
});

it('does not reopen an expired group for an active stroke that started at/after its deadline', () => {
  const result = groupStrokes([observe(outline())], { now: 10000, active: { startedAt: 40 + config.groupPauseMs, location } });
  expect(result.pending).toBeNull();
  expect(result.closed[0]?.closedBy).toBe('pause');
});

it('can mark the previous measure ready when active ink starts in another measure', () => {
  const result = groupStrokes([observe(outline())], { now: 1000, active: { startedAt: 100, location: { measureId: 'b', beatId: null } } });
  expect(result.closed[0]?.closedBy).toBe('measure-change');
  expect(result.readyMeasureIds).toEqual(['a']);
});

it('caps groups without silently dropping or duplicating strokes', () => {
  const observations = [outline(), ...Array.from({ length: config.groupMaxStrokesPerGroup }, (_, i) => fill(`fill-${i}`))].map((s, i) => observe(s, i * 100));
  const result = groupStrokes(observations, { now: observations.at(-1)!.endedAt, finishMeasure: true });
  expect(result.closed.map((g) => g.strokeIds.length)).toEqual([config.groupMaxStrokesPerGroup, 1]);
  expect(result.closed[0]?.closedBy).toBe('group-limit');
  expect(result.closed.flatMap((g) => g.strokeIds)).toEqual(observations.map((o) => o.stroke.id));
});

it('preserves raw metadata, sample order, IDs, locations, and bounds; returns a recomputed snapshot, not deltas', () => {
  const observations = [observe(left()), observe(right(), 100), observe(outline('next', 12), 200)];
  const before = structuredClone(observations);
  const first = groupStrokes(observations, { now: 240 });
  const second = groupStrokes(observations, { now: 240 + config.groupPauseMs });
  expect(first.closed[0]).toEqual(second.closed[0]);
  expect(observations).toEqual(before);
  expect(first.closed[0]?.location).not.toBe(observations[0]?.location);
  expect([...first.closed.flatMap((g) => g.strokeIds), ...first.pending!.strokeIds]).toEqual(['left', 'right', 'next']);
});

it.each([NaN, Infinity, -1])('rejects invalid clocks (%s) instead of using raw timestamps', (value) => {
  expect(() => groupStrokes([], { now: value })).toThrow('observation clock');
  expect(() => groupStrokes([{ ...observe(outline()), startedAt: value }], { now: 100 })).toThrow();
  expect(() => groupStrokes([{ ...observe(outline()), endedAt: value }], { now: 100 })).toThrow();
});

it('rejects clock inversions, overlapping observed strokes, future completion, invalid active clocks, and finishing during contact', () => {
  expect(() => groupStrokes([observe(outline(), 40, 20)], { now: 100 })).toThrow('ordering');
  expect(() => groupStrokes([observe(left()), observe(right(), 20)], { now: 100 })).toThrow('ordering');
  expect(() => groupStrokes([observe(outline())], { now: 20 })).toThrow('ordering');
  for (const startedAt of [20, 101, NaN]) expect(() => groupStrokes([observe(outline())], { now: 100, active: { startedAt, location } })).toThrow();
  expect(() => groupStrokes([observe(outline())], { now: 100, active: { startedAt: 50, location }, finishMeasure: true })).toThrow('active ink');
  expect(() => groupStrokes([], { now: 100, location, active: { startedAt: 50, location: { measureId: 'b', beatId: null } } })).toThrow('Conflicting');
});

it('rejects invalid locations, IDs, empty/invalid strokes, nonfinite points, and overflowing bounds', () => {
  for (const at of [{ measureId: '', beatId: '1' }, { measureId: 'a', beatId: ' ' }]) {
    expect(() => groupStrokes([observe(outline(), 0, 40, at)], { now: 100 })).toThrow('location');
    expect(() => groupStrokes([], { now: 100, location: at })).toThrow('location');
  }
  for (const stroke of [ink('', [[0, 0]]), ink('x', []), ink('x', [[NaN, 0]]), ink('x', [[0, Infinity]]),
    ink('x', [[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 1]]), { ...outline(), completion: 'bad' } as unknown as Stroke]) {
    expect(() => groupStrokes([observe(stroke)], { now: 40 })).toThrow();
  }
  expect(() => groupStrokes([observe(outline()), observe(outline(), 100)], { now: 140 })).toThrow('Invalid grouping stroke');
});

it.each([config.groupEndpointMaxGap, config.groupEndpointMaxGap + 0.001])('checks the inclusive endpoint join radius (%s)', (gap) => {
  const a = ink('a', [[0, 0], [-0.5, 0.5], [0, 1]]);
  const b = ink('b', [[gap, 1], [0.5 + gap, 0.5], [gap, 0]]);
  const result = groupStrokes([observe(a), observe(b, 100)], { now: 140, finishMeasure: true });
  expect(result.closed).toHaveLength(gap <= config.groupEndpointMaxGap ? 1 : 2);
});

it.each([config.groupLoopMaxGap, config.groupLoopMaxGap + 0.001])('checks the inclusive closed-path radius (%s)', (gap) => {
  const a = ink('a', [[0, 0], [-0.5, 0.3], [0.5, 0.6], [gap, 0]]);
  const b = ink('b', [[-0.2, 0.15], [0.2, 0.3], [-0.2, 0.45]]);
  expect(groupStrokes([observe(a), observe(b, 100)], { now: 140, finishMeasure: true }).closed).toHaveLength(gap <= config.groupLoopMaxGap ? 1 : 2);
});

it.each([0, 0.001])('checks containment padding rather than swallowing nearby outside ink (excess=%s)', (excess) => {
  const x = 3.5 - config.groupContainmentPadding - excess;
  const b = ink('b', [[x, 3.9], [x + 0.4, 4.2], [x, 4.1]]);
  expect(groupStrokes([observe(outline()), observe(b, 100)], { now: 140, finishMeasure: true }).closed).toHaveLength(excess === 0 ? 1 : 2);
});

it.each([
  [0.2, 0.3, true], [0.199, 0.3, false], [0.3, 0.2, true], [0.3, 0.199, false],
  [0.25, 0.25, false], [1.8, 1.2, true], [1.801, 1.2, false], [1.8, 1.201, false],
] as const)('checks compact fragment dimensions %s × %s (eligible=%s)', (width, height, eligible) => {
  const result = groupStrokes([observe(ink('s', [[0, 0], [width, height], [width, 0]]))], { now: 40 });
  expect(result.pending !== null).toBe(eligible);
  expect(result.closed).toHaveLength(eligible ? 0 : 1);
});

it('uses no raw time/pressure/tilt fields as a substitute for observation metadata', () => {
  const observations = [observe(left()), observe(right(), 100)];
  const variant = observations.map((o) => ({ ...o, stroke: { ...o.stroke,
    points: o.stroke.points.map((p, i) => ({ ...p, t: i % 2 ? 0 : 9000, pressure: 1, tiltX: 89, tiltY: -89 })) } }));
  expect(groupStrokes(variant, { now: 140, finishMeasure: true })).toEqual(groupStrokes(observations, { now: 140, finishMeasure: true }));
});

it('rejects excessive point counts before scanning geometry', () => {
  const p = outline().points[0]!;
  const stroke: Stroke = { ...outline(), points: Array.from({ length: config.maxStoredPoints + 1 }, () => p) };
  expect(() => groupStrokes([observe(stroke)], { now: 40 })).toThrow('point limit');
});

it('accepts the inclusive input work limit without losing isolated ink', () => {
  const observations = Array.from({ length: config.groupMaxInputStrokes }, (_, i) => observe(ink(`s-${i}`, [[i, 0]]), i * 100));
  const result = groupStrokes(observations, { now: observations.at(-1)!.endedAt });
  expect(result.closed).toHaveLength(config.groupMaxInputStrokes);
  expect(result.closed.flatMap((g) => g.strokeIds)).toEqual(observations.map((o) => o.stroke.id));
});

it('bounds snapshot work', () => {
  expect(() => groupStrokes(Array.from({ length: config.groupMaxInputStrokes + 1 }, () => observe(outline())), { now: 100 })).toThrow('work limit');
});
