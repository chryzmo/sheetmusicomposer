import { expect, expectTypeOf, it } from 'vitest';
import { isPitch, pitchSteps } from './music';
import type { Measure, MusicEvent, NoteEvent, Pitch, RestEvent } from './music';

it('accepts the written C0–B9 domain for every diatonic step', () => {
  for (let octave = 0; octave <= 9; octave++) {
    for (const step of pitchSteps) expect(isPitch({ step, octave })).toBe(true);
  }
});

it.each([
  null, undefined, [], 'C4', 4,
  { step: 'c', octave: 4 }, { step: 'H', octave: 4 },
  { step: 0, octave: 4 }, { octave: 4 }, { step: 'C' },
  { step: 'C', octave: -1 }, { step: 'C', octave: 10 },
  { step: 'C', octave: 4.5 }, { step: 'C', octave: '4' },
  { step: 'C', octave: NaN }, { step: 'C', octave: Infinity },
])('rejects malformed/out-of-domain pitch %j', (value: unknown) => {
  expect(isPitch(value)).toBe(false);
});

it('narrows untrusted data to a written pitch without changing it', () => {
  const input: unknown = { step: 'E', octave: 4 };
  expect(isPitch(input)).toBe(true);
  if (!isPitch(input)) throw new Error('Expected a valid pitch');
  expectTypeOf(input).toEqualTypeOf<Pitch>();
  expect(input).toEqual({ step: 'E', octave: 4 });
});

it('defines a single-voice measure with ordered events and original ink references', () => {
  const note: NoteEvent = {
    id: 'note-1', kind: 'note', pitch: { step: 'E', octave: 4 },
    duration: 'quarter', dots: 0, accidental: null,
    strokeIds: ['head', 'stem'], confidence: 0.8,
  };
  const rest: RestEvent = {
    id: 'rest-1', kind: 'rest', duration: 'half', dots: 0,
    strokeIds: ['rest'], confidence: 0.9,
  };
  const measure: Measure = {
    id: 'measure-1', clef: 'treble', timeSignature: '4/4',
    events: [note, rest], unresolvedStrokeIds: ['unsupported-mark'],
  };
  expect(measure.events.map((event) => event.id)).toEqual(['note-1', 'rest-1']);
  expect(measure.events[0]?.strokeIds).toEqual(['head', 'stem']);
  expectTypeOf<Extract<MusicEvent, { kind: 'note' }>>().toEqualTypeOf<NoteEvent>();
  expectTypeOf<Extract<MusicEvent, { kind: 'rest' }>>().toEqualTypeOf<RestEvent>();
});
