import { describe, expect, it } from 'vitest';
import { createDocument } from '../model/document';
import type { Stroke } from '../ink/types';
import { createHistory, executeCommand, redo, undo } from './history';
import type { Command } from './history';
import { addStrokeCommand } from './stroke-command';

function stroke(id: string, completion: Stroke['completion'] = 'complete'): Stroke {
  return { id, completion, points: [
    { x: 1.25, y: -0.5, t: 100, pressure: 0.6, tiltX: 12, tiltY: -4 },
    { x: 2, y: 0, t: 110, pressure: 0, tiltX: 15, tiltY: -2 },
  ] };
}

describe('command history and stroke commands', () => {
  it('makes empty undo/redo no-ops', () => {
    const original = createDocument();
    const history = createHistory(original);
    expect(undo(history)).toBe(false);
    expect(redo(history)).toBe(false);
    expect(history.document).toBe(original);
  });

  it('adds strokes without mutating previous document snapshots', () => {
    const original = createDocument();
    const history = createHistory(original);
    executeCommand(history, addStrokeCommand(stroke('a')));
    expect(history.document.strokes).toEqual([stroke('a')]);
    expect(original.strokes).toEqual([]);
    expect(history.undoStack).toHaveLength(1);
    expect(history.redoStack).toHaveLength(0);
  });

  it('undoes in reverse order and redoes in original order with exact raw metadata', () => {
    const history = createHistory(createDocument());
    const strokes = [stroke('a'), stroke('b', 'interrupted'), stroke('c')];
    for (const item of strokes) executeCommand(history, addStrokeCommand(item));
    const completeDocument = history.document;
    for (let count = 2; count >= 0; count--) {
      expect(undo(history)).toBe(true);
      expect(history.document.strokes).toEqual(strokes.slice(0, count));
    }
    for (let count = 1; count <= 3; count++) {
      expect(redo(history)).toBe(true);
      expect(history.document.strokes).toEqual(strokes.slice(0, count));
    }
    expect(history.document).toEqual(completeDocument);
    expect(redo(history)).toBe(false);
  });

  it('invalidates redo after a new command, keeping previous undo steps', () => {
    const history = createHistory(createDocument());
    executeCommand(history, addStrokeCommand(stroke('a')));
    executeCommand(history, addStrokeCommand(stroke('b')));
    undo(history);
    executeCommand(history, addStrokeCommand(stroke('c')));
    expect(redo(history)).toBe(false);
    expect(history.document.strokes.map((item) => item.id)).toEqual(['a', 'c']);
    undo(history);
    expect(history.document.strokes).toEqual([stroke('a')]);
  });

  it('snapshots points when constructing a command', () => {
    const point = { x: 1, y: 2, t: 3, pressure: 0.5, tiltX: 4, tiltY: 5 };
    const points = [point];
    const command = addStrokeCommand({ id: 'a', points, completion: 'complete' });
    point.x = 999;
    points.push({ x: 2, y: 3, t: 4, pressure: 0, tiltX: 0, tiltY: 0 });
    const history = createHistory(createDocument());
    executeCommand(history, command);
    undo(history);
    redo(history);
    expect(history.document.strokes[0]?.points).toEqual([
      { x: 1, y: 2, t: 3, pressure: 0.5, tiltX: 4, tiltY: 5 },
    ]);
  });

  it('rejects duplicate stroke IDs without changing document or history', () => {
    const history = createHistory(createDocument());
    executeCommand(history, addStrokeCommand(stroke('a')));
    const original = history.document;
    expect(() => executeCommand(history, addStrokeCommand(stroke('a')))).toThrow('already exists');
    expect(history.document).toBe(original);
    expect(history.undoStack).toHaveLength(1);
  });

  it('rejects out-of-order removal rather than deleting unrelated ink', () => {
    const command = addStrokeCommand(stroke('a'));
    expect(() => command.revert({ strokes: [stroke('b')] })).toThrow('out of order');
  });

  it('does not alter redo history when applying a new command fails', () => {
    const history = createHistory(0);
    const good: Command<number> = { label: 'Increment', apply: (n) => n + 1, revert: (n) => n - 1 };
    executeCommand(history, good);
    undo(history);
    const failing: Command<number> = { ...good, apply: () => { throw new Error('failed'); } };
    expect(() => executeCommand(history, failing)).toThrow('failed');
    expect(history.document).toBe(0);
    expect(history.undoStack).toHaveLength(0);
    expect(history.redoStack).toEqual([good]);
  });

  it('keeps history stacks intact if undo or redo fails', () => {
    const history = createHistory(0);
    let failApply = false;
    let failRevert = true;
    const command: Command<number> = {
      label: 'Increment',
      apply: (n) => { if (failApply) throw new Error('apply'); return n + 1; },
      revert: (n) => { if (failRevert) throw new Error('revert'); return n - 1; },
    };
    executeCommand(history, command);
    expect(() => undo(history)).toThrow('revert');
    expect(history.document).toBe(1);
    expect(history.undoStack).toEqual([command]);
    expect(history.redoStack).toEqual([]);
    failRevert = false;
    undo(history);
    failApply = true;
    expect(() => redo(history)).toThrow('apply');
    expect(history.document).toBe(0);
    expect(history.undoStack).toEqual([]);
    expect(history.redoStack).toEqual([command]);
  });
});
