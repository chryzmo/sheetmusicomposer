import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { config } from '../config';
import type { Stroke } from '../ink/types';
import { headCenter, nearestStroke, nudgePitch, suggestPitch, toExpected } from './quick-label';
import type { QuickDuration, QuickNote } from './quick-label';
import { parseFixture, serializeFixture } from './schema';
import type { InkFixture } from './schema';

const load = (name: string): InkFixture => parseFixture(readFileSync(new URL(`../../fixtures/recorded/${name}.json`, import.meta.url), 'utf8'));
const line = (id: string, points: readonly (readonly [number, number])[]): Stroke => ({
  id, completion: 'complete', points: points.map(([x, y], i) => ({ x, y, t: i, pressure: 0.5, tiltX: 0, tiltY: 0 })),
});
const pitchOf = (step: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B', octave: number) => ({ step, octave });

it('selects the nearest stroke within the tap tolerance, and nothing farther away', () => {
  const a = line('a', [[0, 0], [10, 0]]), b = line('b', [[0, 1], [10, 1]]), dot = line('dot', [[20, 5]]);
  expect(nearestStroke([a, b, dot], 5, 0.2)).toBe('a');
  expect(nearestStroke([a, b, dot], 5, 0.8)).toBe('b');
  expect(nearestStroke([a, b, dot], 5, 3)).toBeNull();
  expect(nearestStroke([a, b, dot], 20.3, 5.2)).toBe('dot');
  expect(nearestStroke([a, b, dot], 5, 0.2 + config.quickLabelTapDistance + 0.01)).toBe('b');
  expect(nearestStroke([], 0, 0)).toBeNull();
});

it('prefers an unlabeled stroke over an avoided one that is nearer, and falls back when nothing else is near', () => {
  const stem = line('stem', [[0, 0], [0, 3]]), nextHead = line('head', [[0.5, 1], [1.5, 1.4]]);
  // A tap on the stem's side is nearer the stem, but the stem already belongs to a note.
  expect(nearestStroke([stem, nextHead], 0.1, 1.1, 0.8)).toBe('stem');
  expect(nearestStroke([stem, nextHead], 0.1, 1.1, 0.8, new Set(['stem']))).toBe('head');
  // With nothing else in tolerance, the avoided stroke is returned so the caller can explain it.
  expect(nearestStroke([stem, nextHead], 0, 2.5, 0.3, new Set(['stem']))).toBe('stem');
  expect(nearestStroke([stem, nextHead], 5, 5, 0.8, new Set(['stem']))).toBeNull();
});

it('lets the later-drawn stroke win an exact tie, as it is drawn on top', () => {
  const first = line('first', [[0, 0], [0, 4]]), second = line('second', [[2, 0], [2, 4]]);
  expect(nearestStroke([first, second], 1, 2, 1)).toBe('second');
});

it('suggests pitch from the head center with the recognizer\'s own snapping, and nudges by one line or space', () => {
  // Top line F5 is y=0; bottom line E4 is y=4; each step is half a staff space.
  expect(suggestPitch([line('h', [[0, 3.8], [1, 4.2]])])).toEqual(pitchOf('E', 4));
  expect(suggestPitch([line('h', [[0, -0.1], [1, 0.1]])])).toEqual(pitchOf('F', 5));
  expect(suggestPitch([line('h', [[0, 4.9], [1, 5.1]])])).toEqual(pitchOf('C', 4));
  expect(suggestPitch([line('h', [[0, 5.9], [1, 6.1]])])).toEqual(pitchOf('A', 3));
  expect(headCenter([line('h1', [[0, 0], [2, 2]]), line('h2', [[4, 2], [6, 6]])])).toEqual({ x: 3, y: 3 });
  expect(nudgePitch(pitchOf('E', 4), 1)).toEqual(pitchOf('F', 4));
  expect(nudgePitch(pitchOf('B', 4), 1)).toEqual(pitchOf('C', 5));
  expect(nudgePitch(pitchOf('C', 5), -1)).toEqual(pitchOf('B', 4));
  expect(nudgePitch(pitchOf('C', 0), -1)).toBeNull();
  expect(nudgePitch(pitchOf('B', 9), 1)).toBeNull();
});

it('builds primitives and left-to-right events, with unclaimed ink saved as unknown', () => {
  const strokes = [line('stem2', [[10, 0], [10, 3]]), line('head1', [[0, 3.8], [1, 4.2]]), line('stem1', [[1, 0], [1, 3.8]]),
    line('stray', [[5, 1], [5.2, 1.2]]), line('head2', [[9, 0.8], [10, 1.2]])];
  const notes: QuickNote[] = [
    { id: 'b', duration: 'half', headStrokeIds: ['head2'], stemStrokeId: 'stem2', pitch: pitchOf('D', 5) },
    { id: 'a', duration: 'quarter', headStrokeIds: ['head1'], stemStrokeId: 'stem1', pitch: pitchOf('E', 4) },
  ];
  const result = toExpected(strokes, notes);
  expect(result.primitives).toEqual([
    { label: 'stem', strokeIds: ['stem2'] },
    { label: 'noteheadFilled', strokeIds: ['head1'] },
    { label: 'stem', strokeIds: ['stem1'] },
    { label: 'unknown', strokeIds: ['stray'] },
    { label: 'noteheadHollow', strokeIds: ['head2'] },
  ]);
  // Left to right by notehead, not the order they were labeled.
  expect(result.events.map((e) => e.kind === 'note' && `${e.pitch.step}${e.pitch.octave} ${e.duration}`)).toEqual(['E4 quarter', 'D5 half']);
  expect(result.events[0]!.strokeIds).toEqual(['head1', 'stem1']);
  expect(result.events[1]!.strokeIds).toEqual(['stem2', 'head2']);
});

it.each<[string, QuickNote[], string]>([
  ['a stroke in two notes', [
    { id: 'a', duration: 'whole', headStrokeIds: ['h'], stemStrokeId: null, pitch: pitchOf('E', 4) },
    { id: 'b', duration: 'whole', headStrokeIds: ['h'], stemStrokeId: null, pitch: pitchOf('E', 4) }], 'cannot belong to two notes'],
  ['a half note with no stem', [{ id: 'a', duration: 'half', headStrokeIds: ['h'], stemStrokeId: null, pitch: pitchOf('E', 4) }], 'needs its stem'],
  ['a whole note with a stem', [{ id: 'a', duration: 'whole', headStrokeIds: ['h'], stemStrokeId: 's', pitch: pitchOf('E', 4) }], 'has no stem'],
  ['a note with no head', [{ id: 'a', duration: 'whole', headStrokeIds: [], stemStrokeId: null, pitch: pitchOf('E', 4) }], 'needs a notehead'],
  ['an unknown stroke', [{ id: 'a', duration: 'whole', headStrokeIds: ['nope'], stemStrokeId: null, pitch: pitchOf('E', 4) }], 'not part of this measure'],
])('refuses %s', (_name, notes, message) => {
  expect(() => toExpected([line('h', [[0, 0], [1, 1]]), line('s', [[2, 0], [2, 3]])], notes)).toThrow(message);
});

// The strongest check available without a device: rebuild each recorded measure from its own
// hand-entered labels and require the quick-label output to be the same fixture truth. Also
// records how the suggested pitch compares with the pitch entered by hand (mechanics, not accuracy).
it.each(['sample-fail', 'a4-whole-x4', 'c5-quarters-half-whole', 'e4-seven-notes'])('reproduces the hand-entered labels of recorded fixture %s', (name) => {
  const fixture = load(name);
  const label = new Map(fixture.expected.primitives.map((p) => [p.strokeIds.join(), p.label]));
  const strokes = fixture.document.strokes;
  const notes: QuickNote[] = fixture.expected.events.map((event, i) => {
    if (event.kind !== 'note') throw new Error('Quick labeling covers notes only');
    return { id: `n${i}`, duration: event.duration as QuickDuration, pitch: event.pitch,
      headStrokeIds: event.strokeIds.filter((id) => label.get(id)?.startsWith('notehead')),
      stemStrokeId: event.strokeIds.find((id) => label.get(id) === 'stem') ?? null };
  });
  const rebuilt = toExpected(strokes, notes);
  expect(rebuilt.primitives).toEqual(fixture.expected.primitives);
  expect(rebuilt.events).toEqual(fixture.expected.events);
  // The suggestion alone reproduces the hand-entered pitch for these writer-labeled notes.
  for (const note of notes) {
    expect(suggestPitch(note.headStrokeIds.map((id) => strokes.find((s) => s.id === id)!))).toEqual(note.pitch);
  }
  // And the result is a valid fixture that round-trips.
  const exported: InkFixture = { ...fixture, expected: rebuilt };
  expect(parseFixture(serializeFixture(exported))).toEqual(exported);
});
