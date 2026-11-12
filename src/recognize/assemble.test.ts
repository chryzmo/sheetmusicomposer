import { describe, expect, it } from 'vitest';
import { config } from '../config';
import type { Stroke } from '../ink/types';
import { assembleSimpleNotes } from './assemble';
import type { AssemblyPrimitive } from './assemble';

function ink(id: string, xy: readonly (readonly [number, number])[], completion: Stroke['completion'] = 'complete'): Stroke {
  return { id, completion, points: xy.map(([x, y], i) => ({ x, y, t: 100 - i, pressure: 0.67, tiltX: 12, tiltY: -15 })) };
}
const head = (id = 'h', x = 4, y = 4): Stroke => ink(id, [[x - 0.5, y], [x, y - 0.3], [x + 0.5, y], [x, y + 0.3], [x - 0.5, y]]);
const stem = (id = 's', x = 4.5, top = 1, bottom = 4): Stroke => ink(id, [[x, top], [x, bottom]]);
const group = (label: AssemblyPrimitive['label'], ...strokeIds: string[]): AssemblyPrimitive => ({ label, strokeIds });

it('accepts an empty finished measure', () => {
  expect(assembleSimpleNotes([], [])).toEqual({ notes: [], unresolved: [], unresolvedStrokeIds: [] });
});

it.each([
  ['noteheadFilled', 'quarter'], ['noteheadHollow', 'half'],
] as const)('assembles %s plus a uniquely attached stem as %s', (label, duration) => {
  const result = assembleSimpleNotes([head(), stem()], [group(label, 'h'), group('stem', 's')]);
  expect(result).toEqual({ notes: [{ kind: 'note', pitch: { step: 'E', octave: 4 }, duration, dots: 0, accidental: null,
    headCenter: { x: 4, y: 4 }, strokeIds: ['h', 's'], primitiveIndices: [0, 1] }], unresolved: [], unresolvedStrokeIds: [] });
  expect(result.notes[0]).not.toHaveProperty('confidence');
  expect(result.notes[0]).not.toHaveProperty('id');
});

it.each([[5, 'C', 4], [4.25, 'D', 4], [0, 'F', 5], [-1, 'A', 5]] as const)(
  'assembles an isolated hollow head at staff y=%s as a whole %s%s', (y, step, octave) => {
    const result = assembleSimpleNotes([head('h', 4, y)], [group('noteheadHollow', 'h')]);
    expect(result.notes[0]).toMatchObject({ duration: 'whole', pitch: { step, octave }, strokeIds: ['h'] });
  });

it('does not invent a quarter note from an isolated filled head', () => {
  const result = assembleSimpleNotes([head()], [group('noteheadFilled', 'h')]);
  expect(result.notes).toEqual([]);
  expect(result.unresolved[0]?.reason).toBe('missing-stem');
});

it('accepts downward/left-side stems and uses head pitch, not stem center', () => {
  const result = assembleSimpleNotes([head('h', 4, 0), stem('s', 3.5, 0, 3)], [group('stem', 's'), group('noteheadHollow', 'h')]);
  expect(result.notes[0]).toMatchObject({ duration: 'half', pitch: { step: 'F', octave: 5 }, primitiveIndices: [1, 0] });
});

it('uses actual extrema despite reversal and retracing, ignoring raw timestamp order', () => {
  const strokes = [head(), ink('s', [[4.5, 2], [4.5, 1], [4.5, 4], [4.5, 2]])];
  const groups = [group('noteheadFilled', 'h'), group('stem', 's')];
  const expected = assembleSimpleNotes(strokes, groups);
  expect(expected.notes).toHaveLength(1);
  expect(assembleSimpleNotes(strokes.map((s) => ({ ...s, points: [...s.points].reverse() })), groups)).toEqual(expected);
});

it('does not invent a slanted tip from a bounding-box corner or attach to the middle of a stem', () => {
  for (const s of [ink('s', [[6.5, 1], [8, 4]]), stem('s', 6.5, 1, 7)]) {
    const result = assembleSimpleNotes([head('h', 6, 4), s], [group('noteheadHollow', 'h'), group('stem', 's')]);
    expect(result.notes).toEqual([]);
    expect(result.unresolved[0]?.reason).toBe('nearby-ink');
    expect(result.unresolvedStrokeIds).toEqual(['h', 's']);
  }
});

it.each([0, config.assemblyTipMaxGap, config.assemblyTipMaxGap + 0.001])('checks the inclusive tip gap boundary (%s)', (gap) => {
  const result = assembleSimpleNotes([head(), stem('s', 4.5 + gap)], [group('noteheadHollow', 'h'), group('stem', 's')]);
  expect(result.notes).toHaveLength(gap <= config.assemblyTipMaxGap ? 1 : 0);
  if (gap > config.assemblyTipMaxGap) expect(result.unresolved[0]?.reason).toBe('nearby-ink');
});

it('rejects competing stems rather than choosing the nearest or downgrading a half to whole', () => {
  const result = assembleSimpleNotes([head(), stem('a', 4.5), stem('b', 3.5)],
    [group('noteheadHollow', 'h'), group('stem', 'a'), group('stem', 'b')]);
  expect(result.notes).toEqual([]);
  expect(result.unresolved.every((u) => u.reason === 'ambiguous-attachment')).toBe(true);
});

it('rejects one stem shared by two separated heads, regardless of input order', () => {
  const strokes = [head('a', 3, 1), head('b', 5, 4), ink('s', [[3.5, 1], [4.5, 4]])];
  const groups = [group('noteheadHollow', 'a'), group('noteheadFilled', 'b'), group('stem', 's')];
  for (const input of [groups, [...groups].reverse()]) {
    const result = assembleSimpleNotes(strokes, input);
    expect(result.notes).toEqual([]);
    expect(result.unresolved.every((u) => u.reason === 'ambiguous-attachment')).toBe(true);
  }
});

it('rejects both matching ends of a stub rather than silently picking one', () => {
  const result = assembleSimpleNotes([head(), stem('s', 4.5, 3.8, 4.2)], [group('noteheadHollow', 'h'), group('stem', 's')]);
  expect(result.notes).toEqual([]);
  expect(result.unresolved.every((u) => u.reason === 'ambiguous-attachment')).toBe(true);
});

it('does not order overlapping head columns as sequential notes or accept chords', () => {
  const result = assembleSimpleNotes([head('a', 4, 0), head('b', 4, 5)], [group('noteheadHollow', 'a'), group('noteheadHollow', 'b')]);
  expect(result.notes).toEqual([]);
  expect(result.unresolved.map((u) => u.reason)).toEqual(['overlapping-heads', 'overlapping-heads']);
});

it.each([config.assemblyHeadColumnClearance, config.assemblyHeadColumnClearance + 0.001])('checks head-column separation independently of vertical distance (%s)', (gap) => {
  const result = assembleSimpleNotes([head('a', 4, 0), head('b', 5 + gap, 5)], [group('noteheadHollow', 'a'), group('noteheadHollow', 'b')]);
  expect(result.notes).toHaveLength(gap <= config.assemblyHeadColumnClearance ? 0 : 2);
});

it.each(['unknown', 'flag', 'beam', 'dot', 'sharp', 'flat', 'natural', 'quarterRest'] as const)(
  'withholds an otherwise valid note when nearby %s ink could change its meaning', (label) => {
    const result = assembleSimpleNotes([head(), stem(), ink('extra', [[4.7, 1]])],
      [group('noteheadHollow', 'h'), group('stem', 's'), group(label, 'extra')]);
    expect(result.notes).toEqual([]);
    expect(result.unresolved[0]?.reason).toBe('nearby-ink');
    expect(result.unresolved[2]?.reason).toBe('unsupported');
    expect(result.unresolvedStrokeIds).toEqual(['h', 's', 'extra']);
  });

it.each([config.assemblyInkClearance, config.assemblyInkClearance + 0.001])('checks the inclusive extra-ink clearance (%s)', (gap) => {
  const result = assembleSimpleNotes([head(), ink('extra', [[4.5 + gap, 4]])], [group('noteheadHollow', 'h'), group('unknown', 'extra')]);
  expect(result.notes).toHaveLength(gap <= config.assemblyInkClearance ? 0 : 1);
  expect(result.unresolvedStrokeIds).toContain('extra');
});

it('retains interrupted source groups and blocks nearby whole-note fallback', () => {
  for (const interrupted of ['h', 's']) {
    const strokes = [head(), stem()].map((s): Stroke => s.id === interrupted ? { ...s, completion: 'interrupted' } : s);
    const result = assembleSimpleNotes(strokes, [group('noteheadHollow', 'h'), group('stem', 's')]);
    expect(result.notes).toEqual([]);
    expect(result.unresolved.find((u) => u.strokeIds.includes(interrupted))?.reason).toBe('interrupted');
    expect(result.unresolvedStrokeIds).toEqual(['h', 's']);
  }
});

it('keeps out-of-pitch-domain heads and unused stems as ink', () => {
  const result = assembleSimpleNotes([head('h', 4, 50), stem('s', 10)], [group('noteheadHollow', 'h'), group('stem', 's')]);
  expect(result.notes).toEqual([]);
  expect(result.unresolved.map((u) => u.reason)).toEqual(['pitch-range', 'unused-stem']);
});

it.each(['noteheadHollow', 'stem'] as const)('rejects degenerate geometry labeled %s', (label) => {
  const result = assembleSimpleNotes([ink('tap', [[4, 4]])], [group(label, 'tap')]);
  expect(result.notes).toEqual([]);
  expect(result.unresolved[0]?.reason).toBe('degenerate-geometry');
});

it('uses multi-stroke head bounds and retains original capture order without mutating any data', () => {
  const strokes = [stem(), ink('right', [[4, 3.7], [4.5, 4], [4, 4.3]]), ink('left', [[4, 4.3], [3.5, 4], [4, 3.7]])];
  const groups = [group('noteheadHollow', 'left', 'right'), group('stem', 's')];
  const before = structuredClone({ strokes, groups });
  const result = assembleSimpleNotes(strokes, groups);
  expect(result.notes[0]?.strokeIds).toEqual(['s', 'right', 'left']);
  expect({ strokes, groups }).toEqual(before);
  expect(result.notes[0]?.strokeIds).not.toBe(groups[0]?.strokeIds);
});

it('sorts notes left-to-right, not by stroke time or primitive order, and partitions every source exactly once', () => {
  const strokes = [head('right', 12), ink('extra', [[20, 2]]), head('left', 4)];
  const result = assembleSimpleNotes(strokes, [group('unknown', 'extra'), group('noteheadHollow', 'right'), group('noteheadHollow', 'left')]);
  expect(result.notes.map((n) => n.headCenter.x)).toEqual([4, 12]);
  expect(result.notes.map((n) => n.primitiveIndices)).toEqual([[2], [1]]);
  expect([...result.notes.flatMap((n) => n.strokeIds), ...result.unresolvedStrokeIds].sort()).toEqual(strokes.map((s) => s.id).sort());
});

describe('invalid typed input fails explicitly (persisted data must be decoded first)', () => {
  it('rejects missing, repeated, empty, and unrecognized primitive references/labels', () => {
    for (const groups of [[], [group('noteheadHollow')], [group('noteheadHollow', 'missing')],
      [group('noteheadHollow', 'h', 'h')], [group('noteheadHollow', 'h'), group('stem', 'h')],
      [{ label: 'not-a-primitive', strokeIds: ['h'] } as unknown as AssemblyPrimitive]]) {
      expect(() => assembleSimpleNotes([head()], groups)).toThrow();
    }
  });
  it('rejects bad stroke identity, empty points, completion, coordinates, and overflowing bounds', () => {
    for (const strokes of [[head('')], [head(), head()], [ink('h', [])],
      [{ ...head(), completion: 'lost' } as unknown as Stroke], [ink('h', [[NaN, 0]])],
      [ink('h', [[0, Infinity]])], [ink('h', [[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 1]])]]) {
      expect(() => assembleSimpleNotes(strokes, [group('noteheadHollow', strokes[0]!.id)])).toThrow();
    }
  });
  it('bounds quadratic work per measure', () => {
    expect(() => assembleSimpleNotes([], Array.from({ length: config.assemblyMaxPrimitives + 1 }, () => group('unknown', 'x')))).toThrow('work limit');
  });
});
