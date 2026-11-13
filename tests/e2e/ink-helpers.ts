import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { config } from '../../src/config';

export async function openSketch(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByLabel('Music ink surface')).toHaveAttribute('aria-disabled', 'false');
}

export async function expectStrokes(page: Page, count: number): Promise<void> {
  await expect(page.getByLabel('Music ink surface')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#ink-status')).toHaveText(`${count} ${count === 1 ? 'stroke' : 'strokes'}`);
}

export async function expectSaved(page: Page): Promise<void> {
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
}

export async function pointer(
  canvas: Locator, type: string, x: number, y: number, pointerType = 'pen', pointerId = 1,
): Promise<void> {
  await expect(canvas).toHaveAttribute('aria-disabled', 'false');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.dispatchEvent(type, {
    pointerType, pointerId, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: box.x + x, clientY: box.y + y, pressure: 0.6, tiltX: 10, tiltY: -5,
  });
}

/** Screen position (canvas-local CSS pixels) of a document point, assuming the
 * initial fit. A late layout resize can shift the real view by a few pixels, so
 * give tolerances a staff space or so of slack.
 */
export async function documentToScreen(canvas: Locator, x: number, y: number): Promise<{ x: number; y: number; space: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const space = Math.min(config.initialSpaceSize, box.width / (config.staffWidth + 2 * config.viewPadding));
  return { x: (box.width - config.staffWidth * space) / 2 + x * space, y: (box.height - 4 * space) / 2 + y * space, space };
}

/** Dark-ink bounds in CSS pixels, ignoring staff lines and transparent pixels. */
export async function inkBounds(canvas: Locator): Promise<{ x: number; y: number; width: number } | null> {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d');
    if (!context) return null;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    for (let index = 0; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 255) >= 70 || (pixels[index + 3] ?? 0) <= 100) continue;
      const x = (index / 4) % element.width;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, Math.floor(index / 4 / element.width));
    }
    if (left === Infinity) return null;
    const ratio = element.width / element.getBoundingClientRect().width;
    return { x: left / ratio, y: top / ratio, width: (right - left + 1) / ratio };
  });
}

export async function hasInk(canvas: Locator): Promise<boolean> {
  return (await inkBounds(canvas)) !== null;
}
