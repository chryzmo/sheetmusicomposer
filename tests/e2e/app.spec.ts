import { expect, test } from '@playwright/test';
import { expectStrokes, hasInk, openSketch, pointer } from './ink-helpers';

test.beforeEach(async ({ page }) => { await openSketch(page); });

test('loads a rendered ink surface without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSketch(page);
  await expect(page).toHaveTitle('Sheet Music Composer');
  await expect(page.getByRole('heading', { name: 'Sheet Music Composer' })).toBeVisible();
  const canvas = page.getByLabel('Music ink surface');
  await expect(canvas).toBeVisible();
  await expect(page.getByText('keep JSON backups.', { exact: false })).toBeVisible();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data;
    return pixels?.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
  expect(errors).toEqual([]);
});

test('distributes the adapted $P license notice with the static build', async ({ page }) => {
  const response = await page.request.get('/third-party-notices.txt');
  expect(response.ok()).toBe(true);
  const notice = await response.text();
  expect(notice).toContain('Copyright (C) 2012, Radu-Daniel Vatavu, Lisa Anthony, and');
  expect(notice).toContain('Redistribution and use in source and binary forms');
  expect(notice).toContain('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS');
});

test('fits a narrow viewport and redraws after resizing', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const canvas = page.getByLabel('Music ink surface');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const initialWidth = await canvas.evaluate((element: HTMLCanvasElement) => element.width);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(initialWidth);
});

test('draws pen ink and retains it across resize', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointermove', 140, 120);
  await pointer(canvas, 'pointerup', 160, 130);
  await expectStrokes(page, 1);
  await expect.poll(() => hasInk(canvas)).toBe(true);
  const oldWidth = await canvas.evaluate((element: HTMLCanvasElement) => element.width);
  await page.setViewportSize({ width: 640, height: 900 });
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).not.toBe(oldWidth);
  await expect.poll(() => hasInk(canvas)).toBe(true);
  await expectStrokes(page, 1);
});

test('ignores mouse and touch drawing while allowing single-point pen taps', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  for (const type of ['mouse', 'touch']) {
    await pointer(canvas, 'pointerdown', 100, 100, type);
    await pointer(canvas, 'pointermove', 140, 120, type);
    await pointer(canvas, 'pointerup', 160, 130, type);
  }
  await expectStrokes(page, 0);
  expect(await hasInk(canvas)).toBe(false);
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointerup', 100, 100);
  await expectStrokes(page, 1);
  await expect.poll(() => hasInk(canvas)).toBe(true);
});

test('ends an active stroke on resize without losing previous strokes', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointerup', 130, 110);
  await pointer(canvas, 'pointerdown', 140, 120, 'pen', 2);
  await pointer(canvas, 'pointermove', 160, 130, 'pen', 2);
  await page.setViewportSize({ width: 640, height: 900 });
  await expectStrokes(page, 2);
  await pointer(canvas, 'pointerup', 160, 130, 'pen', 2);
  await expectStrokes(page, 2);
  await expect.poll(() => hasInk(canvas)).toBe(true);
});

test('recovers when a move indicates contact ended without a pen-up', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointermove', 120, 110);
  await canvas.dispatchEvent('pointermove', { pointerType: 'pen', pointerId: 1, buttons: 0 });
  await expectStrokes(page, 1);
  await pointer(canvas, 'pointerdown', 130, 120);
  await pointer(canvas, 'pointerup', 140, 130);
  await expectStrokes(page, 2);
});

test('accepts rapid consecutive strokes without a cooldown', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  // One browser task, with no artificial pauses between contacts.
  await canvas.evaluate((element) => {
    const box = element.getBoundingClientRect();
    for (let index = 0; index < 20; index++) {
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
        element.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 1,
          button: 0, buttons: type === 'pointerup' ? 0 : 1,
          clientX: box.left + 100 + index, clientY: box.top + 100, pressure: 0.5,
        }));
      }
    }
  });
  await expectStrokes(page, 20);
  await expect.poll(() => hasInk(canvas)).toBe(true);
});

test('a fresh pen contact recovers an unfinished stroke immediately', async ({ page }) => {
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointermove', 120, 110);
  await pointer(canvas, 'pointerdown', 140, 120);
  await pointer(canvas, 'pointerup', 150, 130);
  await expectStrokes(page, 2);
});

test('suppresses cancelable native touch gestures without drawing touch ink', async ({ page }) => {
  const prevented = await page.getByLabel('Music ink surface').evaluate((element) => ['touchstart', 'touchmove'].map((type) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }));
  expect(prevented).toEqual([true, true]);
  await expectStrokes(page, 0);
});

test('opt-in diagnostics show pointer lifecycle and capabilities', async ({ page }) => {
  await openSketch(page, '/?debugInk=1');
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointerup', 120, 110);
  const debug = page.getByLabel('Ink input diagnostics');
  await expect(debug).toContainText('secure=true');
  await expect(debug).toContainText('down pen');
  await expect(debug).toContainText('up pen');
  await expect(debug).toContainText('finish pointer=1 complete');
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur']) {
  test(`preserves interrupted ink on ${interruption} and allows the next stroke`, async ({ page }) => {
    const canvas = page.getByLabel('Music ink surface');
    await pointer(canvas, 'pointerdown', 100, 100);
    await pointer(canvas, 'pointermove', 140, 120);
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await pointer(canvas, interruption, 140, 120);
    await expectStrokes(page, 1);
    await pointer(canvas, 'pointerdown', 150, 140, 'pen', 2);
    await pointer(canvas, 'pointerup', 170, 150, 'pen', 2);
    await expectStrokes(page, 2);
    await expect.poll(() => hasInk(canvas)).toBe(true);
  });
}
