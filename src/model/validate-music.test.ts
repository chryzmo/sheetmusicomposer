import { expect, it } from 'vitest';
import { config } from '../config';
import { decodeMeasures } from './validate-music';
import { musicalDocument } from '../../tests/helpers/music';

const doc = musicalDocument();
const measure = doc.measures![0]!;
const event = measure.events[0]!;
const decodeEvent = (e: unknown) => decodeMeasures([{ ...measure, events: [e] }], doc.strokes);

it('copies validated musical data without touching raw ink or inventing evidence', () => {
  const before = structuredClone(doc);
  const result = decodeMeasures(doc.measures, doc.strokes);
  expect(result).toEqual(doc.measures);
  expect(result).not.toBe(doc.measures);
  expect(result[0]?.events[0]?.strokeIds).not.toBe(event.strokeIds);
  expect(doc).toEqual(before);
  expect(result[0]?.events[0]?.confidence).toBe(0.42);
  expect(result[1]?.events[0]?.confidence).toBe(0);
});

it('allows empty/partial measures and raw ink not yet assigned to any measure', () => {
  expect(decodeMeasures([], doc.strokes)).toEqual([]);
  expect(decodeMeasures([{ ...measure, events: [], unresolvedStrokeIds: [] }], doc.strokes)).toHaveLength(1);
});

it.each([0, 0.5, 1])('accepts explicit finite bounded evidence %s without calibration claims', (confidence) => {
  expect(decodeEvent({ ...event, confidence })[0]?.events[0]?.confidence).toBe(confidence);
});
it.each([undefined, null, NaN, Infinity, -0.01, 1.01, '0.5'])('rejects missing/invalid evidence %s', (confidence) => {
  expect(() => decodeEvent({ ...event, confidence })).toThrow('confidence');
});
it.each([0, 1, 2])('accepts bounded integral dots %s', (dots) => {
  expect(decodeEvent({ ...event, dots })[0]?.events[0]?.dots).toBe(dots);
});
it.each([-1, 3, 0.5, NaN, undefined, '1'])('rejects invalid dots %s', (dots) => {
  expect(() => decodeEvent({ ...event, dots })).toThrow('dots');
});
it.each(['whole', 'half', 'quarter', 'eighth', 'sixteenth'])('validates vocabulary duration %s without claiming its recognition', (duration) => {
  expect(decodeEvent({ ...event, duration })[0]?.events[0]?.duration).toBe(duration);
});
it.each([null, 'sharp', 'flat', 'natural'])('accepts written accidental %s', (accidental) => {
  expect(decodeEvent({ ...event, accidental })[0]?.events[0]).toMatchObject({ accidental });
});
it.each([{ step: 'C', octave: 0 }, { step: 'B', octave: 9 }])('accepts written pitch domain endpoints %j', (pitch) => {
  expect(decodeEvent({ ...event, pitch })[0]?.events[0]).toMatchObject({ pitch });
});
it.each([
  { kind: 'chord' }, { pitch: null }, { pitch: { step: 'H', octave: 4 } }, { pitch: { step: 'C', octave: 10 } },
  { pitch: { step: 'C', octave: -1 } }, { pitch: { step: 'C', octave: 4.5 } }, { accidental: undefined },
  { accidental: 'doubleSharp' }, { duration: 'tuplet' },
])('rejects invalid event vocabulary %j', (patch) => {
  expect(() => decodeEvent({ ...event, ...patch })).toThrow();
});
it.each(['pitch', 'accidental'])('rejects %s on a rest even when its value is undefined', (field) => {
  const rest = doc.measures![1]!.events[0]!;
  expect(() => decodeEvent({ ...rest, [field]: undefined })).toThrow('Rest');
});
it.each([undefined, [], ['missing'], ['h', 'h'], ['u']].map((strokeIds) => ({ strokeIds })))('rejects missing, foreign, duplicate, or interrupted event sources %j', ({ strokeIds }) => {
  expect(() => decodeEvent({ ...event, strokeIds })).toThrow();
});
it('enforces disjoint references across events, unresolved lists, and measures', () => {
  expect(() => decodeMeasures([{ ...measure, events: [event, { ...event, id: 'other' }] }], doc.strokes)).toThrow('repeated');
  expect(() => decodeMeasures([{ ...measure, unresolvedStrokeIds: ['h'] }], doc.strokes)).toThrow('repeated');
  expect(() => decodeMeasures([{ ...measure, events: [], unresolvedStrokeIds: ['u', 'u'] }], doc.strokes)).toThrow('repeated');
  expect(() => decodeMeasures([measure, { ...measure, id: 'other', events: [], unresolvedStrokeIds: ['s'] }], doc.strokes)).toThrow('repeated');
  expect(() => decodeMeasures([{ ...measure, unresolvedStrokeIds: ['missing'] }], doc.strokes)).toThrow('Unknown');
});
it('enforces unique measure and global event IDs', () => {
  expect(() => decodeMeasures([measure, { ...measure, events: [], unresolvedStrokeIds: [] }], doc.strokes)).toThrow('measure ID');
  expect(() => decodeMeasures([measure, { ...doc.measures![1]!, events: [{ ...doc.measures![1]!.events[0]!, id: event.id }] }], doc.strokes)).toThrow('event ID');
});
it.each(['', ' ', 'x'.repeat(config.maxMusicIdLength + 1)])('rejects invalid music identity (%s)', (id) => {
  expect(() => decodeMeasures([{ ...measure, id }], doc.strokes)).toThrow('ID');
  expect(() => decodeEvent({ ...event, id })).toThrow('ID');
});
it.each(['4/4', '3/4', '2/4', '6/8'])('supports time signature %s without duration resolution', (timeSignature) => {
  expect(decodeMeasures([{ ...measure, timeSignature }], doc.strokes)[0]?.timeSignature).toBe(timeSignature);
});
it.each([null, {}, [{ ...measure, clef: 'bass' }], [{ ...measure, timeSignature: '5/4' }],
  [{ ...measure, events: null }], [{ ...measure, unresolvedStrokeIds: null }]].map((value) => ({ value })))('rejects malformed measure data', ({ value }) => {
  expect(() => decodeMeasures(value, doc.strokes)).toThrow();
});
it('bounds measure and per-measure event/reference allocation', () => {
  expect(() => decodeMeasures(Array.from({ length: config.maxMusicMeasures + 1 }, () => null), doc.strokes)).toThrow('measure list');
  expect(() => decodeMeasures([{ ...measure, events: Array.from({ length: config.maxStoredStrokes + 1 }, () => null) }], doc.strokes)).toThrow('event list');
  expect(() => decodeEvent({ ...event, strokeIds: Array.from({ length: config.maxStoredStrokes + 1 }, () => 'h') })).toThrow('references');
});
