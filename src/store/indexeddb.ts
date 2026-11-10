import type { SketchDocument } from '../model/document';
import { decodeSketch, object, sketchFile } from './schema';

export const databaseName = 'sheetmusicomposer';
const storeName = 'sketches';
const draftKey = 'current';

export interface StoredDraft {
  document: SketchDocument;
  revision: number;
}

function decodeDraft(value: unknown): StoredDraft {
  const record = object(value);
  if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 1) {
    throw new Error('Invalid saved revision');
  }
  return { document: decodeSketch(record.sketch), revision: record.revision };
}

export interface SketchRepository {
  load: () => Promise<StoredDraft | null>;
  save: (document: SketchDocument, expectedRevision: number) => Promise<number>;
  close: () => void;
}

export function openSketchRepository(): Promise<SketchRepository> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let abandoned = false;
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('Storage upgrade blocked by another tab. Close other app tabs and reload.'));
    };
    request.onerror = () => reject(request.error ?? new Error('Cannot open browser storage'));
    request.onupgradeneeded = () => {
      if (abandoned) { request.transaction?.abort(); return; }
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve({
        load: () => new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const read = transaction.objectStore(storeName).get(draftKey);
          let draft: StoredDraft | null = null;
          let failure: unknown;
          read.onsuccess = () => {
            try {
              const value: unknown = read.result;
              draft = value === undefined ? null : decodeDraft(value);
            } catch (error) { failure = error; transaction.abort(); }
          };
          transaction.oncomplete = () => resolve(draft);
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Loading sketch failed'));
          transaction.onerror = () => { /* onabort reports the transaction failure */ };
        }),
        save: (document, expectedRevision) => new Promise((resolve, reject) => {
          // Read/check/write within one transaction prevents silent last-writer
          // wins between tabs. Undo never rewinds this storage revision.
          const transaction = db.transaction(storeName, 'readwrite');
          const store = transaction.objectStore(storeName);
          const read = store.get(draftKey);
          let failure: unknown;
          read.onsuccess = () => {
            try {
              const value: unknown = read.result;
              const current = value === undefined ? null : decodeDraft(value);
              if ((current?.revision ?? 0) !== expectedRevision) {
                throw new Error('Another tab changed this sketch. Download a backup before reloading.');
              }
              // Never persist a document that this version cannot load again.
              const validated = decodeSketch(sketchFile(document));
              store.put({ revision: expectedRevision + 1, sketch: sketchFile(validated) }, draftKey);
            } catch (error) { failure = error; transaction.abort(); }
          };
          transaction.oncomplete = () => resolve(expectedRevision + 1);
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Saving sketch failed'));
          transaction.onerror = () => { /* onabort reports quota and write failures */ };
        }),
        close: () => db.close(),
      });
    };
  });
}
