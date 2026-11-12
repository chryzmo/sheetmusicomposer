import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { databaseName } from '../../src/store/indexeddb';
import { sketchFile } from '../../src/store/schema';
import { expectSaved, expectStrokes, openSketch, pointer } from './ink-helpers';

// Sizes are in CSS pixels at roughly 18 px per staff space; the shapes sit well
// inside the notehead/stem bounds so they pass the label gates at nearby scales.
const SPACE = 18;
async function stroke(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const canvas = page.getByLabel('Music ink surface');
  const [first, ...rest] = points;
  await pointer(canvas, 'pointerdown', first![0], first![1]);
  for (const [x, y] of rest.slice(0, -1)) await pointer(canvas, 'pointermove', x, y);
  const last = rest.at(-1) ?? first!;
  await pointer(canvas, 'pointerup', last[0], last[1]);
}
const ellipse = (cx: number, cy: number): [number, number][] =>
  Array.from({ length: 17 }, (_, i) => [cx + Math.cos(i / 16 * 2 * Math.PI) * 0.6 * SPACE, cy + Math.sin(i / 16 * 2 * Math.PI) * 0.45 * SPACE]);
const head = (page: Page, x: number): Promise<void> => stroke(page, ellipse(x, 120));
const stem = (page: Page, x: number): Promise<void> => stroke(page, Array.from({ length: 8 }, (_, i): [number, number] => [x, 60 + i * (3 * SPACE / 7)]));
const dot = (page: Page, x: number): Promise<void> => stroke(page, [[x, 120], [x + 1, 121]]);

const open = async (page: Page) => {
  await page.getByRole('button', { name: 'Personal templates', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
};
const choose = (dialog: ReturnType<Page['getByRole']>, stroke: number, label: string) =>
  dialog.getByLabel(new RegExp(`^Stroke ${stroke} `)).selectOption(label);

async function templateRecords(page: Page): Promise<unknown[]> {
  return page.evaluate((name) => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('templates', 'readonly').objectStore('templates').getAll();
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }), databaseName);
}

test('trains labeled strokes, keeps them across reload, deletes one, and resets all', async ({ page }) => {
  await openSketch(page);
  await head(page, 120); await head(page, 220); await stem(page, 320);
  await expectStrokes(page, 3); await expectSaved(page);
  const dialog = await open(page);
  await expect(dialog.locator('#training-counts')).toContainText('Filled notehead: 0 of 30');
  await expect(dialog.getByRole('button', { name: 'Save labeled samples' })).toBeDisabled();
  await choose(dialog, 1, 'noteheadFilled'); await choose(dialog, 2, 'noteheadHollow'); await choose(dialog, 3, 'stem');
  await expect(dialog.locator('.training-problem')).toHaveText(['', '', '']);
  await dialog.getByRole('button', { name: 'Save labeled samples' }).click();
  await expect(dialog.locator('#training-status')).toContainText('Saved 3 samples.');
  await expect(dialog.locator('#training-counts')).toContainText('Filled notehead: 1 of 30 · Hollow notehead: 1 of 30 · Stem: 1 of 30');
  await expect(dialog.locator('#training-saved li')).toHaveCount(3);
  // Saved strokes return to Skip so the same ink is not saved twice.
  await expect(dialog.getByRole('button', { name: 'Save labeled samples' })).toBeDisabled();
  expect(await templateRecords(page)).toHaveLength(3);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expectStrokes(page, 3);

  await page.reload();
  await expectStrokes(page, 3);
  const again = await open(page);
  await expect(again.locator('#training-saved li')).toHaveCount(3);
  await again.getByRole('button', { name: 'Delete stem sample 3' }).click();
  await expect(again.locator('#training-status')).toContainText('Sample deleted.');
  await expect(again.locator('#training-saved li')).toHaveCount(2);
  page.once('dialog', (confirmation) => void confirmation.accept());
  await again.getByRole('button', { name: 'Delete all personal samples' }).click();
  await expect(again.locator('#training-counts')).toContainText('Filled notehead: 0 of 30');
  expect(await templateRecords(page)).toEqual([]);
  await expectStrokes(page, 3);
});

test('refuses strokes that fail their own shape gates and never changes the sketch', async ({ page }) => {
  await openSketch(page);
  await dot(page, 120); await head(page, 220);
  await expectStrokes(page, 2); await expectSaved(page);
  const dialog = await open(page);
  await choose(dialog, 1, 'noteheadFilled');
  await expect(dialog.locator('.training-problem').first()).toContainText('Too small or too large for a notehead');
  await expect(dialog.getByRole('button', { name: 'Save labeled samples' })).toBeDisabled();
  // A head is not a stem either.
  await choose(dialog, 2, 'stem');
  await expect(dialog.locator('.training-problem').nth(1)).toContainText('Not saved:');
  await choose(dialog, 2, 'noteheadHollow');
  await expect(dialog.locator('.training-problem').nth(1)).toHaveText('');
  await expect(dialog.getByRole('button', { name: 'Save labeled samples' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save labeled samples' }).click();
  await expect(dialog.locator('#training-status')).toContainText('Saved 1 sample. 1 labeled stroke was not saved');
  expect(await templateRecords(page)).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expectStrokes(page, 2);
});

test('ignores and can remove a damaged stored record without losing valid samples', async ({ page }) => {
  await openSketch(page);
  await head(page, 120);
  await expectSaved(page);
  let dialog = await open(page);
  await choose(dialog, 1, 'noteheadFilled');
  await dialog.getByRole('button', { name: 'Save labeled samples' }).click();
  await expect(dialog.locator('#training-saved li')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('templates', 'readwrite');
      tx.objectStore('templates').put({ format: 'something-else' }, 'broken-1');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }), databaseName);
  dialog = await open(page);
  await expect(dialog.locator('#training-damaged')).toBeVisible();
  await expect(dialog.locator('#training-damaged-text')).toContainText('1 stored record was damaged');
  await expect(dialog.locator('#training-saved li')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Remove damaged records' }).click();
  await expect(dialog.locator('#training-damaged')).toBeHidden();
  await expect(dialog.locator('#training-saved li')).toHaveCount(1);
  expect(await templateRecords(page)).toHaveLength(1);
});

test('upgrades a version-1 database in place, keeping the saved sketch and enabling templates', async ({ page }) => {
  await page.route('**/blank-origin-page', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  await page.goto('/blank-origin-page');
  const draft = { revision: 1, sketch: sketchFile({ strokes: [{ id: 'old-1', completion: 'complete',
    points: [{ x: 5, y: 1, t: 1, pressure: 0.5, tiltX: 0, tiltY: 0 }, { x: 6, y: 2, t: 2, pressure: 0.5, tiltX: 0, tiltY: 0 }] }] }) };
  await page.evaluate(({ name, draft }) => new Promise<void>((resolve, reject) => {
    const drop = indexedDB.deleteDatabase(name);
    drop.onerror = () => reject(drop.error);
    drop.onsuccess = () => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('sketches'); };
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('sketches', 'readwrite');
        tx.objectStore('sketches').put(draft, 'current');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
      request.onerror = () => reject(request.error);
    };
  }), { name: databaseName, draft });
  await openSketch(page);
  await expectStrokes(page, 1);
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
  const dialog = await open(page);
  await expect(dialog.locator('#training-counts')).toContainText('Stem: 0 of 30');
  await expect(dialog.locator('#training-status')).toHaveText('');
});

test('a newer database leaves drawing working and reports templates unavailable', async ({ page }) => {
  await openSketch(page);
  await page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Upgrade blocked'));
  }), databaseName);
  await page.reload();
  await expect(page.locator('#save-status')).toContainText('Storage unavailable');
  await head(page, 120);
  await expectStrokes(page, 1);
  const dialog = await open(page);
  await expect(dialog.locator('#training-status')).toContainText('Personal template storage is unavailable');
  await expect(dialog.getByRole('button', { name: 'Save labeled samples' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Delete all personal samples' })).toBeDisabled();
});
