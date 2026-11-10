import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseBackup, sketchFile } from '../../src/store/schema';
import { databaseName } from '../../src/store/indexeddb';
import { expectSaved, expectStrokes, hasInk, openSketch, pointer } from './ink-helpers';

async function draw(page: Page, x = 100): Promise<void> {
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', x, 100);
  await pointer(canvas, 'pointermove', x + 20, 110);
  await pointer(canvas, 'pointerup', x + 40, 120);
}

async function readDraft(page: Page): Promise<unknown> {
  return page.evaluate((name) => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('sketches', 'readonly');
      const read = transaction.objectStore('sketches').get('current');
      let value: unknown;
      read.onsuccess = () => { value = read.result; };
      transaction.oncomplete = () => { db.close(); resolve(value); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), databaseName);
}

async function writeDraft(page: Page, value: unknown): Promise<void> {
  await page.evaluate(({ name, value }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('sketches', 'readwrite');
      transaction.objectStore('sketches').put(value, 'current');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }), { name: databaseName, value });
}

async function downloadBackup(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error('No downloaded backup path');
  return parseBackup(await readFile(path, 'utf8'));
}

const imported = sketchFile({ strokes: [1, 2].map((id) => ({
  id: `imported-${id}`, completion: 'interrupted', points: [
    { x: id * 5, y: 1, t: 100, pressure: 0.7, tiltX: 10, tiltY: -5 },
  ],
})) });

async function upload(page: Page, text: string): Promise<void> {
  await page.getByLabel('Choose sketch backup').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}

test('autosaves exact ink and reloads with a fresh undo history', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await expectSaved(page);
  const original = await readDraft(page);
  const originalBackup = await downloadBackup(page);
  await page.reload();
  await expectStrokes(page, 1);
  await expectSaved(page);
  await expect.poll(() => hasInk(page.getByLabel('Music ink surface'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await readDraft(page)).toEqual(original);
  const backup = await downloadBackup(page);
  expect(backup.strokes).toHaveLength(1);
  // WebKit normalizes synthetic pressure/tilt; compare the samples actually
  // captured before reload rather than the PointerEvent constructor arguments.
  expect(backup).toEqual(originalBackup);
  expect(backup.strokes[0]?.points[0]?.pressure).toBeCloseTo(0.6);
});

test('coalesced timestamps can decrease without blocking autosave or changing raw samples', async ({ page }) => {
  await openSketch(page);
  await page.getByLabel('Music ink surface').evaluate((canvas) => {
    const box = canvas.getBoundingClientRect();
    const sample = (type: string, x: number, t: number) => {
      const event = new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 1,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: box.left + x, clientY: box.top + 100, pressure: 0.5,
      });
      Object.defineProperty(event, 'timeStamp', { value: t });
      return event;
    };
    canvas.dispatchEvent(sample('pointerdown', 100, 100));
    const move = sample('pointermove', 130, 110);
    Object.defineProperty(move, 'getCoalescedEvents', { value: () => [
      sample('pointermove', 110, 120), sample('pointermove', 120, 130),
    ] });
    canvas.dispatchEvent(move);
    canvas.dispatchEvent(sample('pointerup', 140, 140));
  });
  await expectSaved(page);
  const backup = await downloadBackup(page);
  expect(backup.strokes[0]?.points.map((point) => point.t)).toEqual([100, 120, 130, 110, 140]);
  await page.reload();
  await expectStrokes(page, 1);
  await expectSaved(page);
  expect(await downloadBackup(page)).toEqual(backup);
});

test('a backup with decreasing or zero timestamps can be restored and saved unchanged', async ({ page }) => {
  await openSketch(page);
  const recovered = sketchFile({ strokes: [{
    id: 'recovered', completion: 'interrupted',
    points: [100, 80, 0, 80].map((t, x) => ({ x, y: 1, t, pressure: 0.5, tiltX: 0, tiltY: 0 })),
  }] });
  await upload(page, JSON.stringify(recovered));
  await expectStrokes(page, 1);
  await expectSaved(page);
  await page.reload();
  await expectStrokes(page, 1);
  await expectSaved(page);
  expect(await downloadBackup(page)).toEqual(recovered.document);
});

test('undo/redo autosave their resulting document, including the empty sketch', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await expectSaved(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectSaved(page);
  expect(await readDraft(page)).toMatchObject({ sketch: { document: { strokes: [] } } });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectSaved(page);
  await page.reload();
  await expectStrokes(page, 1);
  await draw(page, 200);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectSaved(page);
  await page.reload();
  await expectStrokes(page, 1);
});

test('interrupted ink is saved once and background lifecycle flush captures partial ink', async ({ page }) => {
  await openSketch(page);
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointermove', 120, 110);
  await pointer(canvas, 'pointercancel', 120, 110);
  await pointer(canvas, 'lostpointercapture', 120, 110);
  await pointer(canvas, 'pointerdown', 200, 100);
  await pointer(canvas, 'pointermove', 220, 110);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expectStrokes(page, 2);
  await expectSaved(page);
  await page.reload();
  await expectStrokes(page, 2);
  const backup = await downloadBackup(page);
  expect(backup.strokes.map((stroke) => stroke.completion)).toEqual(['interrupted', 'interrupted']);
});

test('backup restore validates data, is undoable, and survives reload', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await expectSaved(page);
  const original = await downloadBackup(page);
  page.once('dialog', (dialog) => dialog.accept());
  await upload(page, JSON.stringify(imported));
  await expectStrokes(page, 2);
  await expectSaved(page);
  expect(await downloadBackup(page)).toEqual(imported.document);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectSaved(page);
  expect(await downloadBackup(page)).toEqual(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectSaved(page);
  await page.reload();
  await expectStrokes(page, 2);
  expect(await downloadBackup(page)).toEqual(imported.document);
});

test('invalid imports and canceled restores leave ink and storage unchanged', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await expectSaved(page);
  const before = await readDraft(page);
  await upload(page, '{broken');
  await expect(page.locator('#backup-status')).toContainText('Restore failed');
  await expectStrokes(page, 1);
  expect(await readDraft(page)).toEqual(before);
  page.once('dialog', (dialog) => dialog.dismiss());
  await upload(page, JSON.stringify(imported));
  await expect(page.getByRole('button', { name: 'Restore backup' })).toBeEnabled();
  await expectStrokes(page, 1);
  expect(await readDraft(page)).toEqual(before);
});

for (const sketch of [{ format: 'sheetmusicomposer', version: 2, document: { future: true } }, { broken: true }]) {
  test(`unreadable saved data stays untouched (${JSON.stringify(sketch)})`, async ({ page }) => {
    await openSketch(page);
    const raw = { revision: 1, sketch };
    await writeDraft(page, raw);
    await page.reload();
    await expect(page.locator('#save-status')).toContainText('Storage unavailable');
    await draw(page);
    await expectStrokes(page, 1);
    expect(await readDraft(page)).toEqual(raw);
    expect((await downloadBackup(page)).strokes).toHaveLength(1);
  });
}

test('storage unavailable still permits drawing and downloading a backup', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => { throw new DOMException('Storage denied', 'SecurityError'); };
  });
  await openSketch(page);
  await expect(page.locator('#save-status')).toContainText('memory-only');
  await draw(page);
  expect((await downloadBackup(page)).strokes).toHaveLength(1);
});

test('quota failure is visible, preserves latest edits, and supports retry', async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as unknown as { simulateQuota: boolean };
    testWindow.simulateQuota = true;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'sketches' && testWindow.simulateQuota) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await openSketch(page);
  await draw(page);
  await expect(page.locator('#save-status')).toContainText('Storage quota exceeded');
  await draw(page, 200);
  await expectStrokes(page, 2);
  await page.evaluate(() => { (window as unknown as { simulateQuota: boolean }).simulateQuota = false; });
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expectSaved(page);
  await page.reload();
  await expectStrokes(page, 2);
});

test('status changes do not resize the canvas during drawing or saving', async ({ page }) => {
  await openSketch(page);
  const canvas = page.getByLabel('Music ink surface');
  const initial = await canvas.boundingBox();
  await pointer(canvas, 'pointerdown', 100, 100);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await canvas.boundingBox()).toEqual(initial);
  await pointer(canvas, 'pointermove', 120, 110);
  await pointer(canvas, 'pointerup', 140, 120);
  await expectSaved(page);
  expect(await canvas.boundingBox()).toEqual(initial);
});

test('a newer database schema is not downgraded or overwritten', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await expectSaved(page);
  const original = await readDraft(page);
  await page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Upgrade blocked'));
  }), databaseName);
  await page.reload();
  await expect(page.locator('#save-status')).toContainText('Storage unavailable');
  await draw(page, 200);
  expect(await readDraft(page)).toEqual(original);
});

test('a stale tab cannot overwrite a newer saved revision', async ({ page, context }) => {
  await openSketch(page);
  const stale = await context.newPage();
  await openSketch(stale);
  await draw(page);
  await expectSaved(page);
  const before = await readDraft(page);
  await draw(stale, 300);
  await expect(stale.locator('#save-status')).toContainText('Another tab changed');
  expect(await readDraft(page)).toEqual(before);
  expect((await downloadBackup(stale)).strokes).toHaveLength(1);
});
