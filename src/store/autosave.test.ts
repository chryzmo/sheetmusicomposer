import { describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave';
import type { SaveState } from './autosave';

function gate() {
  let release = (): void => { throw new Error('Gate not initialized'); };
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

describe('serialized autosave', () => {
  it('coalesces pending edits and never writes concurrently or reports saved too early', async () => {
    const first = gate();
    const last = gate();
    const states: SaveState[] = [];
    const save = vi.fn(async (value: string) => { await (value === 'a' ? first.promise : last.promise); });
    const autosave = createAutosave(save, (state) => states.push(state));
    autosave.enqueue('a');
    await Promise.resolve();
    autosave.enqueue('b');
    autosave.enqueue('c');
    expect(save.mock.calls).toEqual([['a']]);
    expect(states).toEqual([{ kind: 'saving' }]);
    first.release();
    await vi.waitFor(() => expect(save.mock.calls).toEqual([['a'], ['c']]));
    expect(states).toEqual([{ kind: 'saving' }]);
    last.release();
    await autosave.flush();
    expect(states.at(-1)).toEqual({ kind: 'saved' });
  });
  it('coalesces synchronous changes and flush waits for the committed snapshot', async () => {
    const save = vi.fn(async () => {});
    const autosave = createAutosave<string>(save, () => {});
    autosave.enqueue('a');
    autosave.enqueue('b');
    await autosave.flush();
    expect(save.mock.calls).toEqual([['b']]);
  });
  it('retains the latest snapshot after a failure and retries it explicitly', async () => {
    let fail = true;
    const states: SaveState[] = [];
    const save = vi.fn(async () => { if (fail) throw new Error('Quota exceeded'); });
    const autosave = createAutosave<string>(save, (state) => states.push(state));
    autosave.enqueue('a');
    await autosave.flush();
    expect(states.at(-1)).toEqual({ kind: 'error', message: 'Quota exceeded' });
    autosave.enqueue('b');
    await autosave.flush();
    expect(save).toHaveBeenCalledTimes(1);
    fail = false;
    autosave.retry();
    await autosave.flush();
    expect(save.mock.calls).toEqual([['a'], ['b']]);
    expect(states.at(-1)).toEqual({ kind: 'saved' });
  });
  it('flush and retry are harmless before the first edit', async () => {
    const save = vi.fn(async () => {});
    const autosave = createAutosave(save, () => {});
    autosave.retry();
    await autosave.flush();
    expect(save).not.toHaveBeenCalled();
  });
});
