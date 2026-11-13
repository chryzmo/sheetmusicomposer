import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseFixture } from '../../src/fixtures/schema';
import { serializeBackup } from '../../src/store/schema';
import { expectSaved, expectStrokes, openSketch } from './ink-helpers';

// Template-derived synthetic scene: a quarter and a whole note, both E4.
const fixture = parseFixture(await readFile(new URL('../../fixtures/synthetic/runtime-review.json', import.meta.url), 'utf8'));

test('play with no kept notes says why and stays on Play', async ({ page }) => {
  await openSketch(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#backup-status')).toContainText('Nothing to play yet');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('play reports the kept notes, clamps the tempo, and Stop returns to Play', async ({ page }) => {
  await openSketch(page);
  await page.getByLabel('Choose sketch backup').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(serializeBackup(fixture.document)) });
  await expectStrokes(page, fixture.document.strokes.length); await expectSaved(page);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('2 proposals');
  await page.getByRole('checkbox', { name: /Note 1/ }).check();
  await page.getByRole('checkbox', { name: /Note 2/ }).check();
  await page.getByRole('button', { name: 'Keep selected notes', exact: true }).click();
  await expectSaved(page);
  await page.getByLabel('Tempo in quarter notes per minute').fill('999');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#backup-status')).toContainText('Playing 2 kept events at 240 bpm, as written.');
  await expect(page.getByLabel('Tempo in quarter notes per minute')).toHaveValue('240');
  // Headless audio may or may not start; either way Stop (or the failure path) must return to Play.
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  if (await stop.isVisible()) await stop.click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
