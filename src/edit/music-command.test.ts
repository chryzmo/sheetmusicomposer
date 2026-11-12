import { expect, it } from 'vitest';
import { musicalDocument, testStroke } from '../../tests/helpers/music';
import type { SketchDocument } from '../model/document';
import { parseBackup, serializeBackup } from '../store/schema';
import { createHistory, executeCommand, redo, undo } from './history';
import { replaceMeasuresCommand } from './music-command';
import { addStrokeCommand } from './stroke-command';
import { newPageCommand } from './new-page-command';
import { restoreCommand } from './restore-command';

it('validates/copies supplied musical data and commits it as one ink-preserving undo step', () => {
  const source = musicalDocument(), before: SketchDocument = { strokes: source.strokes };
  const proposed = structuredClone(source.measures!);
  const command = replaceMeasuresCommand(before, proposed);
  // Mutating the caller's proposal cannot alter Apply/Undo/Redo.
  Reflect.set(proposed[0]!.events[0]!, 'confidence', 999);
  const history = createHistory(before);
  executeCommand(history, command);
  const after = history.document;
  expect(after.measures).toEqual(source.measures);
  expect(after.strokes).toBe(before.strokes);
  expect(history.undoStack).toHaveLength(1);
  expect(undo(history)).toBe(true);
  expect(history.document).toBe(before);
  expect(redo(history)).toBe(true);
  expect(history.document).toBe(after);
  expect(parseBackup(serializeBackup(after))).toEqual(after);
});

it('rejects invalid proposals before altering history', () => {
  const source = musicalDocument();
  const history = createHistory(source);
  executeCommand(history, newPageCommand(source));
  undo(history);
  expect(() => replaceMeasuresCommand(source, [{ ...source.measures![0]!, events: [{ ...source.measures![0]!.events[0]!, confidence: undefined }] }])).toThrow('confidence');
  expect(history.document).toBe(source);
  expect(history.redoStack).toHaveLength(1);
  expect(history.undoStack).toHaveLength(0);
});

it('rejects stale async results even for equal-looking replacement snapshots, preserving stacks', () => {
  const source = musicalDocument();
  const command = replaceMeasuresCommand(source, []);
  const history = createHistory(structuredClone(source));
  expect(() => executeCommand(history, command)).toThrow('Stale');
  expect(history.undoStack).toEqual([]);
  expect(history.redoStack).toEqual([]);
  expect(() => command.revert(source)).toThrow('out of order');
});

it('invalidates all events on new ink, preserving measure assignments, raw samples, and undo/redo identity', () => {
  const source = musicalDocument(), before = structuredClone(source);
  const history = createHistory(source);
  executeCommand(history, addStrokeCommand(testStroke('new')));
  const after = history.document;
  expect(after.measures?.map((m) => m.events)).toEqual([[], []]);
  expect(after.measures?.map((m) => m.unresolvedStrokeIds)).toEqual([['h', 's', 'u'], ['r']]);
  expect(after.strokes).toEqual([...source.strokes, testStroke('new')]);
  expect(after.strokes.at(-1)?.id).toBe('new'); // unassigned, never lost
  expect(parseBackup(serializeBackup(after))).toEqual(after);
  undo(history);
  expect(history.document).toBe(source);
  redo(history);
  expect(history.document).toBe(after);
  expect(source).toEqual(before);
});

it('preserves exact snapshots through mixed score, stroke, New, and Restore history', () => {
  const data = musicalDocument(), blank: SketchDocument = { strokes: data.strokes };
  const history = createHistory(blank);
  executeCommand(history, replaceMeasuresCommand(blank, data.measures));
  const music = history.document;
  executeCommand(history, addStrokeCommand(testStroke('new')));
  const ink = history.document;
  executeCommand(history, newPageCommand(ink));
  const fresh = history.document;
  executeCommand(history, restoreCommand(fresh, data));
  for (const expected of [fresh, ink, music, blank]) { expect(undo(history)).toBe(true); expect(history.document).toBe(expected); }
  for (const expected of [music, ink, fresh, data]) { expect(redo(history)).toBe(true); expect(history.document).toBe(expected); }
});

it('rejects a result after ink or music changed, but accepts the original snapshot restored by Undo', () => {
  const source = musicalDocument(), history = createHistory(source);
  const pending = replaceMeasuresCommand(source, []);
  executeCommand(history, addStrokeCommand(testStroke('new')));
  expect(() => executeCommand(history, pending)).toThrow('Stale');
  undo(history);
  executeCommand(history, pending);
  expect(history.document.measures).toEqual([]);
  const stale = replaceMeasuresCommand(source, source.measures);
  expect(() => executeCommand(history, stale)).toThrow('Stale');
});

it('also protects New/Restore from stale application and out-of-order undo', () => {
  const source = musicalDocument(), replacement: SketchDocument = { strokes: [] };
  const commands = [newPageCommand(source), restoreCommand(source, replacement)];
  for (const command of commands) {
    expect(() => command.apply(structuredClone(source))).toThrow('changed document');
    expect(() => command.revert(source)).toThrow('out of order');
    const after = command.apply(source);
    expect(command.revert(after)).toBe(source);
  }
});

it('does not erase music on a failed duplicate-stroke apply, and rejects out-of-order stroke undo/redo', () => {
  const source = musicalDocument(), history = createHistory(source);
  expect(() => executeCommand(history, addStrokeCommand(testStroke('h')))).toThrow('already exists');
  expect(history.document).toBe(source);
  const command = addStrokeCommand(testStroke('new'));
  executeCommand(history, command);
  expect(() => command.revert(structuredClone(history.document))).toThrow('out of order');
  expect(() => command.apply(structuredClone(source))).toThrow('changed document');
});
