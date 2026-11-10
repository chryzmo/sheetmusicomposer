import { describe, expect, it } from 'vitest';
import { historyShortcut } from './shortcuts';

const keys = { key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

describe('history shortcuts', () => {
  it('accepts Control-Z and Command-Z, including upper-case keys', () => {
    expect(historyShortcut({ ...keys, ctrlKey: true })).toBe('undo');
    expect(historyShortcut({ ...keys, key: 'Z', metaKey: true })).toBe('undo');
  });
  it('accepts Shift-Z and Control-Y for redo', () => {
    expect(historyShortcut({ ...keys, ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(historyShortcut({ ...keys, metaKey: true, shiftKey: true })).toBe('redo');
    expect(historyShortcut({ ...keys, key: 'y', ctrlKey: true })).toBe('redo');
  });
  it('ignores plain letters, Alt combinations, and unrelated keys', () => {
    expect(historyShortcut(keys)).toBeNull();
    expect(historyShortcut({ ...keys, ctrlKey: true, altKey: true })).toBeNull();
    expect(historyShortcut({ ...keys, key: 'a', ctrlKey: true })).toBeNull();
    expect(historyShortcut({ ...keys, key: 'y', metaKey: true })).toBeNull();
  });
});
