import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseFixture } from '../../src/fixtures/schema';
import { parseBackup } from '../../src/store/schema';
import { expectSaved, expectStrokes, openSketch, pointer } from './ink-helpers';

async function draw(page: Page, x = 100): Promise<void> {
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', x, 100);
  await pointer(canvas, 'pointermove', x + 20, 110);
  await pointer(canvas, 'pointerup', x + 40, 120);
  await expectSaved(page);
}
async function download(page: Page, button: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const file = await pending;
  const path = await file.path();
  if (!path) throw new Error('No downloaded file');
  return { text: await readFile(path, 'utf8'), filename: file.suggestedFilename() };
}
async function record(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Record fixture', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('empty page explains recording requirements without modifying the sketch', async ({ page }) => {
  await openSketch(page);
  await record(page);
  await expect(page.locator('#fixture-status')).toContainText('Draw one measure first');
  await expect(page.getByRole('button', { name: 'Download fixture', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expectStrokes(page, 0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('exports original ink, staff geometry, primitive groups, and an expected note', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await draw(page, 200);
  const before = parseBackup((await download(page, 'Download backup')).text);
  await record(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Quarter C4 / sample');
  await dialog.getByLabel('Fixture set', { exact: true }).fill('ipad-test');
  await dialog.getByRole('combobox', { name: 'Time signature', exact: true }).selectOption('3/4');
  await dialog.getByLabel('Notes (optional)', { exact: true }).fill('Two strokes, manually labeled.');
  await expect(dialog.getByLabel('Recorded strokes').locator('li')).toHaveCount(2);
  await expect(dialog.locator('svg text')).toHaveText(['1', '2']);
  const first = dialog.locator('#fixture-primitives fieldset').first();
  await first.getByRole('combobox', { name: 'Label', exact: true }).selectOption('noteheadFilled');
  await first.getByLabel('Stroke numbers', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Add primitive', exact: true }).click();
  const second = dialog.locator('#fixture-primitives fieldset').nth(1);
  await second.getByRole('combobox', { name: 'Label', exact: true }).selectOption('stem');
  await second.getByLabel('Stroke numbers', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Add note/rest', exact: true }).click();
  const event = dialog.locator('#fixture-events fieldset');
  await event.getByLabel('Pitch', { exact: true }).fill('c4');
  await event.getByRole('combobox', { name: 'Duration', exact: true }).selectOption('quarter');
  await event.getByRole('combobox', { name: 'Dots', exact: true }).selectOption('1');
  await event.getByRole('combobox', { name: 'Accidental', exact: true }).selectOption('sharp');
  await event.getByLabel('Stroke numbers', { exact: true }).fill('1,2');
  const file = await download(page, 'Download fixture');
  const fixture = parseFixture(file.text);
  expect(file.filename).toBe('fixture-quarter-c4-sample.json');
  expect(fixture.document).toEqual(before);
  expect(fixture.name).toBe('Quarter C4 / sample');
  expect(fixture.set).toBe('ipad-test');
  expect(fixture.provenance).toBe('recorded');
  expect(fixture.staff).toEqual({ units: 'staff-space', lineYs: [0, 1, 2, 3, 4], width: 40, clef: 'treble', timeSignature: '3/4' });
  expect(fixture.expected.primitives).toEqual([
    { label: 'noteheadFilled', strokeIds: [before.strokes[0]!.id] },
    { label: 'stem', strokeIds: [before.strokes[1]!.id] },
  ]);
  expect(fixture.expected.events).toEqual([{ kind: 'note', pitch: { step: 'C', octave: 4 }, accidental: 'sharp', duration: 'quarter', dots: 1, strokeIds: before.strokes.map((stroke) => stroke.id) }]);
  await expect(dialog.locator('#fixture-status')).toContainText('Fixture download requested');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect(parseBackup((await download(page, 'Download backup')).text)).toEqual(before);
  await page.reload();
  await expectStrokes(page, 2);
});

test('rejects missing, repeated, and unknown stroke references before downloading', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await draw(page, 200);
  await record(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('unsupported');
  const strokes = dialog.locator('#fixture-primitives').getByLabel('Stroke numbers', { exact: true });
  for (const [input, message] of [['1', 'Label every stroke'], ['1,1', 'repeated'], ['3', 'Unknown stroke number']]) {
    await strokes.fill(input!);
    await dialog.getByRole('button', { name: 'Download fixture', exact: true }).click();
    await expect(dialog.locator('#fixture-status')).toContainText(message!);
  }
  await strokes.fill('2,1');
  const fixture = parseFixture((await download(page, 'Download fixture')).text);
  expect(fixture.expected.events).toEqual([]);
  expect(fixture.expected.primitives[0]!.label).toBe('unknown');
  expect(fixture.expected.primitives[0]!.strokeIds).toEqual(fixture.document.strokes.map((stroke) => stroke.id).reverse());
});

test('supports event-only rests without hidden pitch validation, and preserves event order', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await draw(page, 200);
  await record(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('rest-and-note');
  await dialog.locator('#fixture-primitives').getByRole('button', { name: 'Remove', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add note/rest', exact: true }).click();
  const first = dialog.locator('#fixture-events fieldset').first();
  await first.getByLabel('Pitch', { exact: true }).fill('invalid');
  await first.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('rest');
  await first.getByRole('combobox', { name: 'Duration', exact: true }).selectOption('eighth');
  await first.getByLabel('Stroke numbers', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Add note/rest', exact: true }).click();
  const second = dialog.locator('#fixture-events fieldset').nth(1);
  await second.getByLabel('Stroke numbers', { exact: true }).fill('1');
  const fixture = parseFixture((await download(page, 'Download fixture')).text);
  expect(fixture.expected.primitives).toEqual([]);
  expect(fixture.expected.events.map((event) => event.kind)).toEqual(['rest', 'note']);
  expect(fixture.expected.events[0]!.strokeIds).toEqual([fixture.document.strokes[1]!.id]);
});

test('closing/canceling the recorder leaves undo/redo intact and shortcuts cannot edit behind it', async ({ page }) => {
  await openSketch(page);
  await draw(page);
  await draw(page, 200);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectSaved(page);
  await record(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expectStrokes(page, 1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectStrokes(page, 2);
  await record(page);
  await expect(page.locator('#fixture-primitives fieldset')).toHaveCount(1);
  await expect(page.getByLabel('Recorded strokes').locator('li')).toHaveCount(2);
});

test('finalizes active pen ink once for recording, without adding a fixture history command', async ({ page }) => {
  await openSketch(page);
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await pointer(canvas, 'pointermove', 120, 110);
  await record(page);
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('partial-stroke');
  const fixture = parseFixture((await download(page, 'Download fixture')).text);
  expect(fixture.document.strokes).toHaveLength(1);
  expect(fixture.document.strokes[0]!.completion).toBe('interrupted');
  await page.keyboard.press('Escape');
  await pointer(canvas, 'pointerup', 140, 120);
  await expectStrokes(page, 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStrokes(page, 0);
});

test('recorder fits a narrow viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await openSketch(page);
  await draw(page);
  await record(page);
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Add note/rest', exact: true }).click();
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});
