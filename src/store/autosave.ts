export type SaveState =
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Browser storage failed';
}

/** Coalesce pending immutable snapshots and allow only one write in flight. */
export function createAutosave<Document>(
  save: (document: Document) => Promise<void>, onState: (state: SaveState) => void,
) {
  let latest: Document;
  let hasLatest = false;
  let dirty = false;
  let failed = false;
  let running: Promise<void> | null = null;

  const start = (): void => {
    if (running || failed || !dirty) return;
    onState({ kind: 'saving' });
    running = (async () => {
      // Start outside the command that enqueued the snapshot.
      await Promise.resolve();
      while (dirty && !failed) {
        const snapshot = latest;
        dirty = false;
        try {
          await save(snapshot);
        } catch (error) {
          dirty = true;
          failed = true;
          onState({ kind: 'error', message: errorMessage(error) });
        }
      }
      if (!failed) onState({ kind: 'saved' });
      running = null;
    })();
  };

  return {
    enqueue: (document: Document): void => {
      latest = document;
      hasLatest = true;
      dirty = true;
      start();
    },
    retry: (): void => {
      if (!hasLatest) return;
      failed = false;
      start();
    },
    flush: async (): Promise<void> => { await running; },
  };
}
