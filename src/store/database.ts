export const databaseName = 'sheetmusicomposer';
// Version 1: sketches. Version 2 adds the personal-template store. Opening an
// older database upgrades it in place and never touches existing sketch records.
export const databaseVersion = 2;
export const sketchStoreName = 'sketches';
export const templateStoreName = 'templates';

/** Opens the shared app database, creating any missing object store. Every
 * repository uses this so a single upgrade path defines the schema.
 */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    let abandoned = false;
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('Storage upgrade blocked by another tab. Close other app tabs and reload.'));
    };
    request.onerror = () => reject(request.error ?? new Error('Cannot open browser storage'));
    request.onupgradeneeded = () => {
      if (abandoned) { request.transaction?.abort(); return; }
      const db = request.result;
      for (const name of [sketchStoreName, templateStoreName]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
