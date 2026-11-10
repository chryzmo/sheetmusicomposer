import { describe, expect, it } from 'vitest';
import { config } from '../config';
import type { SketchDocument } from '../model/document';
import { decodeSketch, parseBackup, serializeBackup, sketchFile } from './schema';

const document: SketchDocument = { strokes: [{ id: 'a', completion: 'interrupted', points: [
  { x: -2.5, y: 10, t: 100, pressure: 0.6, tiltX: -90, tiltY: 90 },
  { x: 3, y: -1, t: 101, pressure: 0, tiltX: 0, tiltY: 0 },
] }] };

describe('versioned sketch validation', () => {
  it('round trips raw metadata, IDs, completion, and staff-space coordinates', () => {
    expect(parseBackup(serializeBackup(document))).toEqual(document);
    expect(decodeSketch(sketchFile({ strokes: [] }))).toEqual({ strokes: [] });
  });
  it('produces independent validated snapshots', () => {
    const decoded = decodeSketch(sketchFile(document));
    expect(decoded).not.toBe(document);
    expect(decoded.strokes[0]?.points).not.toBe(document.strokes[0]?.points);
  });
  it.each([null, [], {}, { format: 'other', version: 1 }, { format: 'sheetmusicomposer', version: 2 }])('rejects invalid envelope %j', (value) => {
    expect(() => decodeSketch(value)).toThrow();
  });
  it.each([
    { id: '', completion: 'complete', points: [] },
    { id: 'a', completion: 'bad', points: [] },
    { id: 'a', completion: 'complete', points: [] },
    { id: 'a', completion: 'complete', points: [null] },
  ])('rejects malformed stroke %j', (stroke) => {
    expect(() => decodeSketch({
      format: 'sheetmusicomposer', version: 1, document: { strokes: [stroke] },
    })).toThrow();
  });
  it('rejects duplicate IDs', () => {
    expect(() => decodeSketch(sketchFile({ strokes: [...document.strokes, ...document.strokes] }))).toThrow('duplicate');
  });
  it.each([
    ['x', Infinity], ['y', NaN], ['t', -1], ['t', NaN], ['t', Infinity], ['t', '100'], ['pressure', 1.1], ['pressure', -0.1],
    ['tiltX', -91], ['tiltY', 91], ['x', '12'],
  ])('rejects invalid point field %s=%s', (field, value) => {
    const file = { format: 'sheetmusicomposer', version: 1, document: { strokes: [
      { id: 'a', completion: 'complete', points: [{ x: 0, y: 0, t: 1, pressure: 0, tiltX: 0, tiltY: 0, [field]: value }] },
    ] } };
    expect(() => decodeSketch(file)).toThrow();
  });
  it('preserves decreasing, equal, and zero raw timestamps without reordering or clamping', () => {
    const times = [100, 120, 130, 110, 0, 0, 140];
    const captured: SketchDocument = { strokes: [{
      id: 'coalesced', completion: 'complete',
      points: times.map((t, x) => ({ x, y: 0, t, pressure: 0.5, tiltX: 0, tiltY: 0 })),
    }] };
    expect(decodeSketch(sketchFile(captured))).toEqual(captured);
    expect(parseBackup(serializeBackup(captured))).toEqual(captured);
  });
  it('rejects malformed JSON and oversized imports', () => {
    expect(() => parseBackup('{')).toThrow();
    expect(() => parseBackup(' '.repeat(config.maxBackupBytes + 1))).toThrow('10 MiB');
  });
  it('rejects oversized decoded stroke lists', () => {
    expect(() => decodeSketch({ format: 'sheetmusicomposer', version: 1, document: {
      strokes: Array.from({ length: config.maxStoredStrokes + 1 }, () => null),
    } })).toThrow('too many strokes');
  });
});
