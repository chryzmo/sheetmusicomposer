import { checkCanAdd, decodeUserTemplateRecords, encodeUserTemplateSample } from '../recognize/user-templates';
import type { SkippedTemplateRecord, UserTemplateSample } from '../recognize/user-templates';
import { openDatabase, templateStoreName as storeName } from './database';

export interface LoadedTemplates {
  readonly samples: readonly UserTemplateSample[];
  /** Damaged, unsupported, duplicate, or over-limit records. Never thrown. */
  readonly skipped: readonly SkippedTemplateRecord[];
}

export interface TemplateRepository {
  load: () => Promise<LoadedTemplates>;
  /** All-or-nothing: if any sample is invalid or would exceed a limit, none is saved. */
  add: (samples: readonly UserTemplateSample[]) => Promise<void>;
  /** Deletes by record key (a sample ID, or the key of a skipped record). */
  remove: (keys: readonly string[]) => Promise<void>;
  clear: () => Promise<void>;
  close: () => void;
}

function readAll(store: IDBObjectStore, done: (records: [string, unknown][]) => void, fail: (error: unknown) => void): void {
  const keys = store.getAllKeys(), values = store.getAll();
  values.onsuccess = () => {
    try {
      const names = keys.result, found: unknown[] = values.result;
      done(found.map((value, i): [string, unknown] => [String(names[i]), value]));
    } catch (error) { fail(error); }
  };
}

export async function openTemplateRepository(): Promise<TemplateRepository> {
  const db = await openDatabase();
  return {
    load: () => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      let loaded: LoadedTemplates | null = null, failure: unknown;
      readAll(transaction.objectStore(storeName), (records) => { loaded = decodeUserTemplateRecords(records); },
        (error) => { failure = error; transaction.abort(); });
      transaction.oncomplete = () => loaded ? resolve(loaded) : reject(new Error('Loading personal templates failed'));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Loading personal templates failed'));
      transaction.onerror = () => { /* onabort reports the transaction failure */ };
    }),
    add: (samples) => new Promise((resolve, reject) => {
      // Read, check limits, and write in ONE transaction so two tabs cannot both
      // pass a limit check, and a failure leaves the stored set untouched.
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      let failure: unknown;
      readAll(store, (records) => {
        try {
          const existing = [...decodeUserTemplateRecords(records).samples];
          for (const sample of samples) {
            checkCanAdd(existing, sample);
            existing.push(sample);
            store.put(encodeUserTemplateSample(sample), sample.id);
          }
        } catch (error) { failure = error; transaction.abort(); }
      }, (error) => { failure = error; transaction.abort(); });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Saving personal templates failed'));
      transaction.onerror = () => { /* onabort reports quota and write failures */ };
    }),
    remove: (keys) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      for (const key of keys) transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Deleting personal templates failed'));
      transaction.onerror = () => { /* onabort reports the transaction failure */ };
    }),
    clear: () => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).clear();
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Clearing personal templates failed'));
      transaction.onerror = () => { /* onabort reports the transaction failure */ };
    }),
    close: () => db.close(),
  };
}
