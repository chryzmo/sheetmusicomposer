import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { config } from '../../src/config';
import { parseFixture } from '../../src/fixtures/schema';
import { encodeUserTemplateSample } from '../../src/recognize/user-templates';
import { databaseName } from '../../src/store/indexeddb';
import { expectStrokes, hasInk, openSketch, pointer } from './ink-helpers';

// Roughly 18 px per staff space on the trainer canvas.
const SPACE = 18;
const canvasOf = (page: Page) => page.getByLabel('Training ink surface');
async function draw(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const canvas = canvasOf(page);
  const [first, ...rest] = points;
  await pointer(canvas, 'pointerdown', first![0], first![1]);
  for (const [x, y] of rest.slice(0, -1)) await pointer(canvas, 'pointermove', x, y);
  const last = rest.at(-1) ?? first!;
  await pointer(canvas, 'pointerup', last[0], last[1]);
}
const head = (page: Page, x = 200): Promise<void> => draw(page, Array.from({ length: 17 }, (_, i): [number, number] =>
  [x + Math.cos(i / 16 * 2 * Math.PI) * 0.6 * SPACE, 104 + Math.sin(i / 16 * 2 * Math.PI) * 0.45 * SPACE]));
const stem = (page: Page, x = 300): Promise<void> => draw(page, Array.from({ length: 8 }, (_, i): [number, number] => [x, 50 + i * (3 * SPACE / 7)]));
const dot = (page: Page): Promise<void> => draw(page, [[200, 104], [201, 105]]);

async function records(page: Page): Promise<{ label: string }[]> {
  return page.evaluate((name) => new Promise<{ label: string }[]>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('templates', 'readonly').objectStore('templates').getAll();
      read.onsuccess = () => { db.close(); resolve(read.result as { label: string }[]); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }), databaseName);
}
async function openGuided(page: Page) {
  await page.getByRole('button', { name: 'Personal templates', exact: true }).click();
  await page.getByRole('button', { name: 'Start guided training', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Guided training' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a filled notehead');
  return dialog;
}

test('labels each stroke from its prompt, advances, and leaves the sketch alone', async ({ page }) => {
  await openSketch(page);
  const dialog = await openGuided(page);
  await expect(dialog.locator('#guided-progress')).toContainText('Filled notehead 1 of 8');
  await head(page);
  await expect(dialog.locator('#guided-status')).toHaveText('Saved as filled notehead.');
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a hollow notehead');
  await head(page, 260);
  await expect(dialog.locator('#guided-status')).toHaveText('Saved as hollow notehead.');
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a stem');
  await stem(page);
  await expect(dialog.locator('#guided-status')).toHaveText('Saved as stem.');
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a filled notehead');
  await expect(dialog.locator('#guided-progress')).toContainText('Filled notehead 2 of 8 in this round · 3 saved this session');
  await expect(dialog.locator('#guided-counts')).toContainText('Filled notehead 1 of 30 · Hollow notehead 1 of 30 · Stem 1 of 30');
  expect((await records(page)).map((r) => r.label).sort()).toEqual(['noteheadFilled', 'noteheadHollow', 'stem']);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  // The Personal templates screen underneath now lists what was just trained.
  await expect(page.locator('#training-saved li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expectStrokes(page, 0);
});

test('refuses a stroke that is not the prompted shape, removes its ink, and repeats the prompt', async ({ page }) => {
  await openSketch(page);
  const dialog = await openGuided(page);
  await dot(page);
  await expect(dialog.locator('#guided-status')).toContainText('Not saved: Too small or too large for a notehead.');
  await expect(dialog.locator('#guided-status')).toContainText('Try the same prompt again.');
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a filled notehead');
  await expect(dialog.locator('#guided-progress')).toContainText('Filled notehead 1 of 8');
  expect(await records(page)).toEqual([]);
  await expect.poll(() => hasInk(canvasOf(page))).toBe(false);
  await expect(dialog.getByRole('button', { name: 'Undo last', exact: true })).toBeDisabled();
  // A head is not a stem: the prompt decides what a stroke must be.
  await head(page);
  await expect(dialog.locator('#guided-status')).toHaveText('Saved as filled notehead.');
  await head(page, 260);
  await head(page, 320);
  await expect(dialog.locator('#guided-status')).toContainText('Not saved: ');
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a stem');
  expect(await records(page)).toHaveLength(2);
});

test('undo removes the last saved sample and returns to its prompt', async ({ page }) => {
  await openSketch(page);
  const dialog = await openGuided(page);
  await head(page);
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a hollow notehead');
  await dialog.getByRole('button', { name: 'Undo last', exact: true }).click();
  await expect(dialog.locator('#guided-status')).toHaveText('Last sample removed.');
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a filled notehead');
  await expect(dialog.locator('#guided-progress')).toContainText('Filled notehead 1 of 8 in this round · 0 saved this session');
  expect(await records(page)).toEqual([]);
  await expect.poll(() => hasInk(canvasOf(page))).toBe(false);
  await expect(dialog.getByRole('button', { name: 'Undo last', exact: true })).toBeDisabled();
});

test('skip moves on without saving, and clearing the drawing area keeps saved samples', async ({ page }) => {
  await openSketch(page);
  const dialog = await openGuided(page);
  await dialog.getByRole('button', { name: 'Skip this prompt', exact: true }).click();
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a hollow notehead');
  await head(page);
  await expect(dialog.locator('#guided-status')).toHaveText('Saved as hollow notehead.');
  await dialog.getByRole('button', { name: 'Clear drawing area', exact: true }).click();
  await expect.poll(() => hasInk(canvasOf(page))).toBe(false);
  expect(await records(page)).toHaveLength(1);
  await expect(dialog.locator('#guided-counts')).toContainText('Hollow notehead 1 of 30');
});

test('prompts for a shape that is already at its limit are skipped automatically', async ({ page }) => {
  await openSketch(page);
  const fixture = parseFixture(await readFile(new URL('../../fixtures/recorded/sample-fail.json', import.meta.url), 'utf8'));
  const seeded = Array.from({ length: config.maxUserTemplatesPerLabel }, (_, i) => encodeUserTemplateSample({
    id: `seed-${i}`, label: 'noteheadFilled', createdAt: i + 1, strokes: [fixture.document.strokes[0]!] }));
  await page.evaluate(({ name, seeded }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('templates', 'readwrite');
      for (const record of seeded) tx.objectStore('templates').put(record, record.id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }), { name: databaseName, seeded });
  await page.getByRole('button', { name: 'Personal templates', exact: true }).click();
  await page.getByRole('button', { name: 'Start guided training', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Guided training' });
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a hollow notehead');
  await expect(dialog.locator('#guided-counts')).toContainText('Filled notehead 30 of 30');
  await head(page);
  await stem(page);
  // The next prompts continue with the shapes that still have room, never filled heads.
  await expect(dialog.locator('#guided-prompt')).toContainText('Draw a hollow notehead');
  await expect(dialog.locator('#guided-counts')).toContainText('Hollow notehead 1 of 30 · Stem 1 of 30');
});

test('guided training is unavailable, with the reason shown, when template storage cannot open', async ({ page }) => {
  await openSketch(page);
  await page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  }), databaseName);
  await page.reload();
  await page.getByRole('button', { name: 'Personal templates', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start guided training', exact: true })).toBeDisabled();
  await expect(page.locator('#training-status')).toContainText('Personal template storage is unavailable');
});

test('reopening starts a fresh canvas, continues from the saved counts, and still draws', async ({ page }) => {
  await openSketch(page);
  let dialog = await openGuided(page);
  await head(page);
  await expect(dialog.locator('#guided-status')).toHaveText('Saved as filled notehead.');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // The Personal templates screen is still open underneath; start guided training again from it.
  await page.getByRole('button', { name: 'Start guided training', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Guided training' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#guided-counts')).toContainText('Filled notehead 1 of 30');
  await expect(dialog.locator('#guided-progress')).toContainText('0 saved this session');
  await expect.poll(() => hasInk(canvasOf(page))).toBe(false);
  await head(page);
  await expect(dialog.locator('#guided-status')).toHaveText('Saved as filled notehead.');
  expect(await records(page)).toHaveLength(2);
  await expectStrokes(page, 0);
});
