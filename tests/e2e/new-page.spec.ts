import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectSaved, expectStrokes, hasInk, inkBounds, openSketch, pointer } from './ink-helpers';

async function draw(page: Page): Promise<void> {
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointermove', 120, 110);
  await pointer(canvas, 'pointerup', 140, 120);
  await expectSaved(page);
  await expect.poll(() => hasInk(canvas)).toBe(true);
}

async function startNew(page: Page): Promise<void> {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expectStrokes(page, 0);
  await expectSaved(page);
}

test('New on an already blank page does not prompt or add empty history steps', async ({ page }) => {
  await openSketch(page);
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expectStrokes(page, 0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(dialogs).toEqual([]);
});

test('canceling New leaves the current ink and saved sketch unchanged', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  const canvas = page.getByLabel('Music ink surface');
  const before = await inkBounds(canvas);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expectStrokes(page, 1);
  expect(await inkBounds(canvas)).toEqual(before);
  await page.reload();
  await expectStrokes(page, 1);
});

test('New clears the page, resets navigation, and is undoable/redoable', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  const canvas = page.getByLabel('Music ink surface');
  const fittedInk = await inkBounds(canvas);
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointermove', 240, 220, 'touch', 2);
  await pointer(canvas, 'pointerup', 240, 220, 'touch', 2);
  await startNew(page);
  await expect.poll(() => hasInk(canvas)).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStrokes(page, 1);
  await expect.poll(() => inkBounds(canvas)).toEqual(fittedInk);
  await expectSaved(page);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectStrokes(page, 0);
  await expectSaved(page);
  await expect.poll(() => hasInk(canvas)).toBe(false);
});

test('New autosaves the empty page and later drawing starts from it', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await startNew(page);
  await page.reload();
  await expectStrokes(page, 0);
  await expectSaved(page);
  await expect.poll(() => hasInk(page.getByLabel('Music ink surface'))).toBe(false);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await draw(page);
  await page.reload();
  await expectStrokes(page, 1);
});

test('New preserves captured partial ink for Undo and ignores its late pen-up', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 200, 100);
  await pointer(canvas, 'pointermove', 220, 110);
  await startNew(page);
  await pointer(canvas, 'pointerup', 240, 120);
  await expectStrokes(page, 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStrokes(page, 2);
  await expectSaved(page);
});
