import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { expectStrokes, hasInk, inkBounds, openSketch, pointer } from './ink-helpers';

async function draw(canvas: Locator, x: number): Promise<void> {
  await pointer(canvas, 'pointerdown', x, 100);
  await pointer(canvas, 'pointermove', x + 20, 110);
  await pointer(canvas, 'pointerup', x + 40, 120);
  await expect.poll(() => hasInk(canvas)).toBe(true);
}

async function raster(canvas: Locator): Promise<string> {
  return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
}

test.beforeEach(async ({ page }) => { await openSketch(page); });

test('empty history disables toolbar controls and ignores shortcuts', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await expectStrokes(page, 0);
});

test('toolbar undo and redo restore stroke order and exact rendered ink', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await draw(canvas, 100);
  const firstImage = await raster(canvas);
  await draw(canvas, 200);
  await expect.poll(() => raster(canvas)).not.toBe(firstImage);
  const completeImage = await raster(canvas);
  await expectStrokes(page, 2);
  await undo.click();
  await expect.poll(() => raster(canvas)).toBe(firstImage);
  await expectStrokes(page, 1);
  await undo.click();
  await expect.poll(() => hasInk(canvas)).toBe(false);
  await expect(undo).toBeDisabled();
  await redo.click();
  await expect.poll(() => raster(canvas)).toBe(firstImage);
  await redo.click();
  await expect.poll(() => raster(canvas)).toBe(completeImage);
  await expect(redo).toBeDisabled();
});

test('a new stroke clears redo but can itself be undone', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas, 100);
  await draw(canvas, 200);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await draw(canvas, 300);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expectStrokes(page, 1);
});

test('keyboard supports Control/Command-Z, Shift-Z, and Control-Y', async ({ page }) => {
  await draw(page.getByLabel('Music ink surface'), 100);
  await page.keyboard.press('Meta+z');
  await expectStrokes(page, 0);
  await page.keyboard.press('Meta+Shift+z');
  await expectStrokes(page, 1);
  await page.keyboard.press('Control+z');
  await expectStrokes(page, 0);
  await page.keyboard.press('Control+y');
  await expectStrokes(page, 1);
});

test('keyboard shortcuts do not steal undo from editable controls', async ({ page }) => {
  await draw(page.getByLabel('Music ink surface'), 100);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Test text');
    document.body.append(input);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.setAttribute('aria-label', 'Test editable');
    document.body.append(editable);
  });
  await page.getByLabel('Test text').fill('hello');
  await page.getByLabel('Test text').press('Control+z');
  await expectStrokes(page, 1);
  await page.getByLabel('Test editable').fill('hello');
  await page.getByLabel('Test editable').press('Meta+z');
  await expectStrokes(page, 1);
});

test('undo during contact removes the partial stroke and redo recovers it', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointermove', 120, 110);
  await expect.poll(() => hasInk(canvas)).toBe(true);
  const partialImage = await raster(canvas);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect.poll(() => hasInk(canvas)).toBe(false);
  await pointer(canvas, 'pointerup', 140, 120);
  await expectStrokes(page, 0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => raster(canvas)).toBe(partialImage);
  await expectStrokes(page, 1);
});

test('redo is disabled and ignored while a new stroke is active', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas, 100);
  await page.keyboard.press('Control+z');
  await pointer(canvas, 'pointerdown', 200, 100);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await pointer(canvas, 'pointerup', 220, 110);
  await expectStrokes(page, 1);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
});

test('interrupted strokes are individual undo steps and redo is not duplicated by late events', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas, 100);
  const firstImage = await raster(canvas);
  await pointer(canvas, 'pointerdown', 200, 100);
  await pointer(canvas, 'pointermove', 220, 110);
  await pointer(canvas, 'pointercancel', 220, 110);
  await expect.poll(() => raster(canvas)).not.toBe(firstImage);
  const interruptedImage = await raster(canvas);
  await pointer(canvas, 'lostpointercapture', 220, 110);
  await page.keyboard.press('Control+z');
  await expect.poll(() => raster(canvas)).toBe(firstImage);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => raster(canvas)).toBe(interruptedImage);
  await expectStrokes(page, 2);
});

test('navigation and Fit staff stay outside history and do not clear redo', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas, 100);
  const original = await inkBounds(canvas);
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointermove', 230, 220, 'touch', 2);
  await pointer(canvas, 'pointerup', 230, 220, 'touch', 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => hasInk(canvas)).toBe(false);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Fit staff' }).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => inkBounds(canvas)).toEqual(original);
});
