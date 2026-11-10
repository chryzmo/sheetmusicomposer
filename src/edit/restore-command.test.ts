import { expect, it } from 'vitest';
import { createDocument } from '../model/document';
import { createHistory, executeCommand, redo, undo } from './history';
import { addStrokeCommand } from './stroke-command';
import { restoreCommand } from './restore-command';

it('restores a backup in one undo step, preserving earlier history and allowing redo', () => {
  const history = createHistory(createDocument());
  executeCommand(history, addStrokeCommand({ id: 'a', completion: 'interrupted', points: [
    { x: 0, y: 0, t: 1, pressure: 0.5, tiltX: 0, tiltY: 0 },
  ] }));
  const before = history.document;
  const restored = createDocument();
  executeCommand(history, restoreCommand(before, restored));
  expect(history.document).toBe(restored);
  undo(history);
  expect(history.document).toBe(before);
  undo(history);
  expect(history.document.strokes).toEqual([]);
  redo(history);
  redo(history);
  expect(history.document).toBe(restored);
});
