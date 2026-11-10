import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { expectStrokes, inkBounds, pointer } from './ink-helpers';

async function draw(canvas: Locator): Promise<void> {
  await pointer(canvas, 'pointerdown', 300, 300);
  await pointer(canvas, 'pointermove', 320, 310);
  await pointer(canvas, 'pointerup', 340, 320);
  await expect.poll(() => inkBounds(canvas)).not.toBeNull();
}

async function bounds(canvas: Locator) {
  const value = await inkBounds(canvas);
  if (!value) throw new Error('Expected ink bounds');
  return value;
}

test('one finger pans ink and Fit staff restores its original position', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas);
  const original = await bounds(canvas);
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointermove', 230, 220, 'touch', 2);
  await pointer(canvas, 'pointerup', 230, 220, 'touch', 2);
  await expect.poll(async () => (await bounds(canvas)).x).toBeCloseTo(original.x + 30, 0);
  await expect.poll(async () => (await bounds(canvas)).y).toBeCloseTo(original.y + 20, 0);
  await expectStrokes(page, 1);
  await page.getByRole('button', { name: 'Fit staff' }).click();
  await expect.poll(() => inkBounds(canvas)).toEqual(original);
});

test('pinch zoom scales ink around the midpoint, then transitions to pan', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas);
  const original = await bounds(canvas);
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointerdown', 400, 200, 'touch', 3);
  await pointer(canvas, 'pointermove', 500, 200, 'touch', 3);
  await expect.poll(async () => Math.abs((await bounds(canvas)).width - original.width * 1.5)).toBeLessThan(2);
  const zoomed = await bounds(canvas);
  await pointer(canvas, 'pointerup', 500, 200, 'touch', 3);
  await pointer(canvas, 'pointermove', 210, 210, 'touch', 2);
  await pointer(canvas, 'pointerup', 210, 210, 'touch', 2);
  await expect.poll(async () => (await bounds(canvas)).x).toBeCloseTo(zoomed.x + 10, 0);
  await page.getByRole('button', { name: 'Fit staff' }).click();
  // Exact raster restoration also checks that gestures never rewrite original ink.
  await expect.poll(() => inkBounds(canvas)).toEqual(original);
});

test('Pencil after pan uses the new view transform for stored ink', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointermove', 240, 220, 'touch', 2);
  await pointer(canvas, 'pointerup', 240, 220, 'touch', 2);
  await draw(canvas);
  const pannedInk = await bounds(canvas);
  await page.getByRole('button', { name: 'Fit staff' }).click();
  await expect.poll(async () => (await bounds(canvas)).x).toBeCloseTo(pannedInk.x - 40, 0);
  await expect.poll(async () => (await bounds(canvas)).y).toBeCloseTo(pannedInk.y - 20, 0);
});

test('palm contacts stay suppressed during and between Pencil strokes until lifted', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas);
  const original = await bounds(canvas);
  // A finger already resting when the Pencil starts must also be suppressed.
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointerdown', 300, 300);
  await pointer(canvas, 'pointerdown', 400, 200, 'touch', 3);
  await pointer(canvas, 'pointermove', 250, 220, 'touch', 2);
  await pointer(canvas, 'pointermove', 500, 240, 'touch', 3);
  await pointer(canvas, 'pointerup', 340, 320);
  await pointer(canvas, 'pointermove', 300, 250, 'touch', 2);
  await pointer(canvas, 'pointermove', 550, 250, 'touch', 3);
  await expect.poll(() => inkBounds(canvas)).toEqual(original);
  await expectStrokes(page, 2);
  await pointer(canvas, 'pointerup', 300, 250, 'touch', 2);
  await pointer(canvas, 'pointerup', 550, 250, 'touch', 3);
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointermove', 230, 200, 'touch', 2);
  await pointer(canvas, 'pointerup', 230, 200, 'touch', 2);
  await expect.poll(async () => (await bounds(canvas)).x).toBeCloseTo(original.x + 30, 0);
});

test('resize preserves zoom and cancels the old gesture', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas);
  const original = await bounds(canvas);
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointerdown', 400, 200, 'touch', 3);
  await pointer(canvas, 'pointermove', 500, 200, 'touch', 3);
  await expect.poll(async () => Math.abs((await bounds(canvas)).width - original.width * 1.5)).toBeLessThan(2);
  const zoomed = await bounds(canvas);
  const oldWidth = await canvas.evaluate((element: HTMLCanvasElement) => element.width);
  await page.setViewportSize({ width: 640, height: 900 });
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).not.toBe(oldWidth);
  await expect.poll(async () => (await bounds(canvas)).width).toBeCloseTo(zoomed.width, 0);
  const resized = await bounds(canvas);
  await pointer(canvas, 'pointermove', 550, 240, 'touch', 3);
  await pointer(canvas, 'pointerup', 550, 240, 'touch', 3);
  await expect.poll(() => inkBounds(canvas)).toEqual(resized);
});

test('Fit staff clears an active gesture without deleting ink', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Music ink surface');
  await draw(canvas);
  const original = await bounds(canvas);
  await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
  await pointer(canvas, 'pointermove', 230, 220, 'touch', 2);
  await page.getByRole('button', { name: 'Fit staff' }).click();
  await expect.poll(() => inkBounds(canvas)).toEqual(original);
  await pointer(canvas, 'pointermove', 300, 300, 'touch', 2);
  await pointer(canvas, 'pointerup', 300, 300, 'touch', 2);
  await expect.poll(() => inkBounds(canvas)).toEqual(original);
  await expectStrokes(page, 1);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur']) {
  test(`touch navigation recovers from ${interruption}`, async ({ page }) => {
    await page.goto('/');
    const canvas = page.getByLabel('Music ink surface');
    await draw(canvas);
    const original = await bounds(canvas);
    await pointer(canvas, 'pointerdown', 200, 200, 'touch', 2);
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await pointer(canvas, interruption, 200, 200, 'touch', 2);
    // An ended contact must not move the view if a late event arrives.
    await pointer(canvas, 'pointermove', 400, 400, 'touch', 2);
    await pointer(canvas, 'pointerdown', 200, 200, 'touch', 3);
    await pointer(canvas, 'pointermove', 220, 200, 'touch', 3);
    await pointer(canvas, 'pointerup', 220, 200, 'touch', 3);
    await expect.poll(async () => (await bounds(canvas)).x).toBeCloseTo(original.x + 20, 0);
  });
}
