import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { config } from '../../src/config';
import { parseFixture } from '../../src/fixtures/schema';
import type { SketchDocument } from '../../src/model/document';
import { parseBackup, serializeBackup } from '../../src/store/schema';
import { expectSaved, expectStrokes, openSketch, pointer } from './ink-helpers';

// Template-derived synthetic scene: a quarter (head review-head + stem) and a whole note, both E4.
const fixture = parseFixture(await readFile(new URL('../../fixtures/synthetic/runtime-review.json', import.meta.url), 'utf8'));
const source: SketchDocument = fixture.document;

async function backup(page: Page): Promise<SketchDocument> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = await (await pending).path();
  if (!file) throw new Error('Missing backup');
  return parseBackup(await readFile(file, 'utf8'));
}

async function keepBothNotes(page: Page): Promise<void> {
  await page.getByLabel('Choose sketch backup').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(serializeBackup(source)) });
  await expectStrokes(page, source.strokes.length); await expectSaved(page);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('2 proposals');
  await page.getByRole('checkbox', { name: /Note 1/ }).check();
  await page.getByRole('checkbox', { name: /Note 2/ }).check();
  await page.getByRole('button', { name: 'Keep selected notes', exact: true }).click();
  await expectSaved(page);
}

/** Screen position of a document point under the initial fit (same rule as the surface). */
async function screen(canvas: Locator, x: number, y: number): Promise<{ x: number; y: number; space: number }> {
  const box = (await canvas.boundingBox())!;
  const space = Math.min(config.initialSpaceSize, box.width / (config.staffWidth + 2 * config.viewPadding));
  return { x: (box.width - config.staffWidth * space) / 2 + x * space, y: (box.height - 4 * space) / 2 + y * space, space };
}

const pitches = async (page: Page): Promise<string[]> =>
  (await backup(page)).measures![0]!.events.map((e) => (e.kind === 'note' ? `${e.pitch.step}${e.pitch.octave}` : 'rest'));

test('holding the Pencil on a kept note then dragging repitches it as one undoable step, ink unchanged', async ({ page }) => {
  await openSketch(page); await keepBothNotes(page);
  const canvas = page.getByLabel('Music ink surface');
  const head = await screen(canvas, 4, 4); // quarter note head, E4
  await pointer(canvas, 'pointerdown', head.x, head.y);
  await page.waitForTimeout(config.noteGrabHoldMs + 250);
  await pointer(canvas, 'pointermove', head.x, head.y - head.space); // up one space = two steps: G4
  await pointer(canvas, 'pointerup', head.x, head.y - head.space);
  await expectSaved(page);
  await expect(page.locator('#backup-status')).toContainText('Moved a note from E4 to G4');
  expect(await pitches(page)).toEqual(['G4', 'E4']);
  const after = await backup(page);
  expect(after.strokes).toEqual(source.strokes); // the held contact never became ink
  await expectStrokes(page, source.strokes.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expectSaved(page);
  expect(await pitches(page)).toEqual(['E4', 'E4']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(after);
});

test('dragging back to the starting pitch, or cancelling, changes nothing', async ({ page }) => {
  await openSketch(page); await keepBothNotes(page);
  const canvas = page.getByLabel('Music ink surface');
  const whole = await screen(canvas, 10, 4);
  const before = await backup(page);
  await pointer(canvas, 'pointerdown', whole.x, whole.y);
  await page.waitForTimeout(config.noteGrabHoldMs + 250);
  await pointer(canvas, 'pointermove', whole.x, whole.y + 2 * whole.space);
  await pointer(canvas, 'pointermove', whole.x, whole.y);
  await pointer(canvas, 'pointerup', whole.x, whole.y);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled(); // keep step only
  expect(await backup(page)).toEqual(before);
  await pointer(canvas, 'pointerdown', whole.x, whole.y);
  await page.waitForTimeout(config.noteGrabHoldMs + 250);
  await pointer(canvas, 'pointermove', whole.x, whole.y + 2 * whole.space);
  await canvas.dispatchEvent('pointercancel', { pointerType: 'pen', pointerId: 1 });
  expect(await backup(page)).toEqual(before);
});

test('moving before the hold elapses, or holding off a note, is ordinary ink', async ({ page }) => {
  await openSketch(page); await keepBothNotes(page);
  const canvas = page.getByLabel('Music ink surface');
  const head = await screen(canvas, 4, 4);
  await pointer(canvas, 'pointerdown', head.x, head.y);
  await pointer(canvas, 'pointermove', head.x + head.space, head.y); // beyond tolerance at once
  await page.waitForTimeout(config.noteGrabHoldMs + 250);
  await pointer(canvas, 'pointermove', head.x + 2 * head.space, head.y);
  await pointer(canvas, 'pointerup', head.x + 2 * head.space, head.y);
  await expectStrokes(page, source.strokes.length + 1); await expectSaved(page);
  expect((await backup(page)).measures![0]!.events).toEqual([]); // new ink invalidates music, as before
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expectSaved(page);
  const away = await screen(canvas, 25, 2);
  await pointer(canvas, 'pointerdown', away.x, away.y);
  await page.waitForTimeout(config.noteGrabHoldMs + 250);
  await pointer(canvas, 'pointerup', away.x, away.y);
  await expectStrokes(page, source.strokes.length + 1);
});

const durations = async (page: Page): Promise<string[]> => (await backup(page)).measures![0]!.events.map((e) => e.duration);

test('tapping a kept note steps quarter, half, whole and back as undoable steps, ink unchanged', async ({ page }) => {
  await openSketch(page); await keepBothNotes(page);
  const canvas = page.getByLabel('Music ink surface');
  const head = await screen(canvas, 4, 4); // quarter note, E4
  const tap = async (): Promise<void> => { await pointer(canvas, 'pointerdown', head.x, head.y); await pointer(canvas, 'pointerup', head.x, head.y); await expectSaved(page); };
  await tap();
  // Read the status before backup(), whose download overwrites it.
  await expect(page.locator('#backup-status')).toContainText('Changed the E4 note from quarter to half.');
  await expect(page.locator('#backup-status')).toContainText('Measure is overfull: 6 of 4 quarter-note units in 4/4.');
  expect(await durations(page)).toEqual(['half', 'whole']);
  await tap();
  expect(await durations(page)).toEqual(['whole', 'whole']);
  await tap();
  expect(await durations(page)).toEqual(['quarter', 'whole']);
  expect((await backup(page)).strokes).toEqual(source.strokes); // taps never became ink
  await expectStrokes(page, source.strokes.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expectSaved(page);
  expect(await durations(page)).toEqual(['whole', 'whole']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expectSaved(page);
  expect(await durations(page)).toEqual(['quarter', 'whole']);
});

test('a tap off any note is still an ink dot, and a tap during a drag does not cycle', async ({ page }) => {
  await openSketch(page); await keepBothNotes(page);
  const canvas = page.getByLabel('Music ink surface');
  const away = await screen(canvas, 25, 2);
  await pointer(canvas, 'pointerdown', away.x, away.y); await pointer(canvas, 'pointerup', away.x, away.y);
  await expectStrokes(page, source.strokes.length + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStrokes(page, source.strokes.length);
  const whole = await screen(canvas, 10, 4);
  await pointer(canvas, 'pointerdown', whole.x, whole.y);
  await page.waitForTimeout(config.noteGrabHoldMs + 250);
  await pointer(canvas, 'pointerup', whole.x, whole.y);
  expect(await durations(page)).toEqual(['quarter', 'whole']); // a long hold is not a tap
});

/** A back-and-forth scribble of `legs` passes across [x0, x1] in screen pixels. */
async function scribble(canvas: Locator, x0: number, x1: number, y: number, step: number, legs = 6): Promise<void> {
  await pointer(canvas, 'pointerdown', x0, y);
  for (let i = 1; i <= legs; i++) await pointer(canvas, 'pointermove', i % 2 ? x1 : x0, y + (step * i) / legs);
  await pointer(canvas, 'pointerup', legs % 2 ? x1 : x0, y + step);
}

test('scribbling over a kept note deletes it from the music, keeps its ink as unresolved, and undoes', async ({ page }) => {
  await openSketch(page); await keepBothNotes(page);
  const canvas = page.getByLabel('Music ink surface');
  const head = await screen(canvas, 4, 4), before = await backup(page);
  // The download handler sets this text after the file is available; wait for it
  // so it cannot land after, and overwrite, the delete message on a slow runner.
  await expect(page.locator('#backup-status')).toContainText('Backup download requested');
  await scribble(canvas, head.x - 1.5 * head.space, head.x + 1.5 * head.space, head.y - 0.4 * head.space, 0.8 * head.space);
  await expectSaved(page);
  await expect(page.locator('#backup-status')).toContainText('Deleted the E4 note. Its ink stays visible and unresolved.');
  const after = await backup(page);
  expect(after.measures![0]!.events.map((e) => e.duration)).toEqual(['whole']); // only the quarter went
  expect(after.measures![0]!.unresolvedStrokeIds).toEqual(['review-head', 'review-stem', 'review-unknown']);
  expect(after.strokes).toEqual(source.strokes); // the scribble is a gesture, never saved as ink
  await expectStrokes(page, source.strokes.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(after);
});

test('a scribble that covers no kept note is ordinary ink; a plain line over a note does not delete', async ({ page }) => {
  await openSketch(page); await keepBothNotes(page);
  const canvas = page.getByLabel('Music ink surface');
  const away = await screen(canvas, 25, 2);
  await scribble(canvas, away.x - 1.5 * away.space, away.x + 1.5 * away.space, away.y, 0.8 * away.space);
  await expectStrokes(page, source.strokes.length + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStrokes(page, source.strokes.length);
  const head = await screen(canvas, 4, 4);
  await pointer(canvas, 'pointerdown', head.x - 1.5 * head.space, head.y);
  await pointer(canvas, 'pointermove', head.x, head.y);
  await pointer(canvas, 'pointerup', head.x + 1.5 * head.space, head.y);
  await expectStrokes(page, source.strokes.length + 1); // a line is ink (and clears kept notes, as for any new ink)
});
