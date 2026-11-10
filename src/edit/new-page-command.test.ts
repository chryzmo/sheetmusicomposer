import { expect, it } from 'vitest';
import { createDocument } from '../model/document';
import type { SketchDocument } from '../model/document';
import type { Stroke } from '../ink/types';
import { createHistory, executeCommand, redo, undo } from './history';
import { newPageCommand } from './new-page-command';
import { addStrokeCommand } from './stroke-command';

const stroke: Stroke = { id: 'a', completion: 'interrupted', points: [
  { x: 1, y: -2, t: 100, pressure: 0.7, tiltX: 10, tiltY: -20 },
  { x: 2, y: 0, t: 90, pressure: 0.2, tiltX: 0, tiltY: 0 },
] };

it('starts a blank page in one undo step without modifying the previous ink', () => {
  const before: SketchDocument = { strokes: [stroke] };
  const history = createHistory(before);
  executeCommand(history, newPageCommand(before));
  expect(history.document.strokes).toEqual([]);
  expect(before.strokes).toEqual([stroke]);
  undo(history);
  expect(history.document).toBe(before);
  expect(history.document.strokes[0]).toBe(stroke);
  redo(history);
  expect(history.document.strokes).toEqual([]);
});

it('keeps earlier stroke history and clears the old redo branch', () => {
  const history = createHistory(createDocument());
  executeCommand(history, addStrokeCommand(stroke));
  executeCommand(history, addStrokeCommand({ ...stroke, id: 'b' }));
  undo(history);
  executeCommand(history, newPageCommand(history.document));
  expect(redo(history)).toBe(false);
  undo(history);
  expect(history.document.strokes).toEqual([stroke]);
  undo(history);
  expect(history.document.strokes).toEqual([]);
  redo(history);
  redo(history);
  expect(history.document.strokes).toEqual([]);
});

it('new ink after a blank page has its own undo step', () => {
  const history = createHistory<SketchDocument>({ strokes: [stroke] });
  executeCommand(history, newPageCommand(history.document));
  executeCommand(history, addStrokeCommand({ ...stroke, id: 'new' }));
  undo(history);
  expect(history.document.strokes).toEqual([]);
  undo(history);
  expect(history.document.strokes).toEqual([stroke]);
});
