import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseFixture } from '../../src/fixtures/schema';
import { parseBackup } from '../../src/store/schema';
import { expectSaved, expectStrokes, openSketch, pointer } from './ink-helpers';

const SPACE = 18;
async function stroke(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const canvas = page.getByLabel('Music ink surface');
  const [first, ...rest] = points;
  await pointer(canvas, 'pointerdown', first![0], first![1]);
  for (const [x, y] of rest.slice(0, -1)) await pointer(canvas, 'pointermove', x, y);
  const last = rest.at(-1) ?? first!;
  await pointer(canvas, 'pointerup', last[0], last[1]);
}
const head = (page: Page, x: number, y = 120) => stroke(page, Array.from({ length: 17 }, (_, i): [number, number] =>
  [x + Math.cos(i / 16 * 2 * Math.PI) * 0.6 * SPACE, y + Math.sin(i / 16 * 2 * Math.PI) * 0.45 * SPACE]));
const stem = (page: Page, x: number) => stroke(page, Array.from({ length: 8 }, (_, i): [number, number] => [x, 60 + i * (3 * SPACE / 7)]));
const dot = (page: Page, x: number) => stroke(page, [[x, 60], [x + 1, 61]]);

/** The measure: 1 filled head, 2 its stem, 3 a whole-note head to the LEFT, 4 a stray mark. */
async function drawMeasure(page: Page): Promise<void> {
  await head(page, 220); await stem(page, 232); await head(page, 120); await dot(page, 400);
  await expectStrokes(page, 4); await expectSaved(page);
}
async function openLabel(page: Page) {
  await page.getByRole('button', { name: 'Label measure', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Label a test measure' });
  await expect(dialog).toBeVisible();
  return dialog;
}
/** Tap a stroke by its drawing-order number, on its own ink (the first point of its path), as a finger or Pencil would. */
async function tap(page: Page, number: number): Promise<void> {
  const at = await page.locator(`.quick-preview polyline[data-stroke-number="${number}"]`).evaluate((element) => {
    const line = element as unknown as SVGPolylineElement, svg = line.ownerSVGElement!;
    const [x, y] = line.getAttribute('points')!.split(' ')[0]!.split(',').map(Number);
    const point = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(at.x, at.y);
}
const duration = (dialog: ReturnType<Page['getByRole']>, name: string) => dialog.getByRole('button', { name, exact: true });
const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const up = (pitch: string): string => {
  const index = steps.indexOf(pitch[0]!), octave = Number(pitch.slice(1));
  return index === 6 ? `C${octave + 1}` : `${steps[index + 1]}${octave}`;
};
async function download(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download fixture', exact: true }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('No downloaded file');
  return parseFixture(await readFile(path, 'utf8'));
}
async function backupStrokes(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('No backup');
  return parseBackup(await readFile(path, 'utf8')).strokes;
}

test('labels notes by tapping and exports a valid fixture, with the ink and sketch untouched', async ({ page }) => {
  await openSketch(page);
  await drawMeasure(page);
  const original = await backupStrokes(page);
  const dialog = await openLabel(page);
  await expect(dialog.locator('#quick-prompt')).toContainText('Tap the head of a note');
  await expect(dialog.getByRole('button', { name: 'Download fixture', exact: true })).toBeDisabled();
  for (const b of ['Whole', 'Half', 'Quarter']) await expect(duration(dialog, b)).toBeDisabled();
  // Quarter note: head (stroke 1), length, then stem (stroke 2).
  await tap(page, 1);
  await expect(dialog.locator('#quick-prompt')).toContainText('1 head stroke selected');
  await duration(dialog, 'Quarter').click();
  await expect(dialog.locator('#quick-prompt')).toContainText('Now tap the stem of this quarter note');
  await tap(page, 2);
  await expect(dialog.locator('#quick-status')).toContainText('Added a quarter note at');
  // Whole note: head only (stroke 3), drawn after but sitting to the left.
  await tap(page, 3);
  await duration(dialog, 'Whole').click();
  await expect(dialog.locator('#quick-notes li')).toHaveCount(2);
  await expect(dialog.locator('#quick-notes li').first()).toContainText('whole');
  await expect(dialog.locator('#quick-notes li').nth(1)).toContainText('quarter');
  await expect(dialog.locator('#quick-prompt')).toContainText('2 notes labeled; 1 stroke will be saved as unknown ink.');
  await dialog.getByLabel('Name', { exact: true }).fill('Free test / one');
  await dialog.getByRole('combobox', { name: 'Time signature' }).selectOption('3/4');
  await dialog.getByLabel('Notes (optional)').fill('Written quickly.');
  const fixture = await download(page);
  expect(fixture.name).toBe('Free test / one');
  expect(fixture.provenance).toBe('recorded');
  expect(fixture.staff.timeSignature).toBe('3/4');
  expect(fixture.notes).toContain('Free-drawn measure labeled by tapping');
  expect(fixture.notes).toContain('Written quickly.');
  // The raw ink is the sketch's ink, unchanged and in order.
  expect(fixture.document.strokes).toEqual(original);
  const [s1, s2, s3, s4] = original.map((s) => s.id);
  expect(fixture.expected.primitives).toEqual([
    { label: 'noteheadFilled', strokeIds: [s1] }, { label: 'stem', strokeIds: [s2] },
    { label: 'noteheadHollow', strokeIds: [s3] }, { label: 'unknown', strokeIds: [s4] },
  ]);
  // Events run left to right by notehead, not in the order they were labeled.
  expect(fixture.expected.events.map((e) => e.duration)).toEqual(['whole', 'quarter']);
  expect(fixture.expected.events.map((e) => e.strokeIds)).toEqual([[s3], [s1, s2]]);
  expect(fixture.expected.events.every((e) => e.kind === 'note' && e.dots === 0 && e.accidental === null)).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expectStrokes(page, 4);
  expect(await backupStrokes(page)).toEqual(original);
});

test('the pitch can be nudged, and the exported pitch is the displayed one', async ({ page }) => {
  await openSketch(page);
  await drawMeasure(page);
  const dialog = await openLabel(page);
  await tap(page, 3);
  await duration(dialog, 'Whole').click();
  const item = dialog.locator('#quick-notes li').first();
  const before = /Note 1: ([A-G]\d) whole/.exec(await item.innerText())![1]!;
  await dialog.getByRole('button', { name: 'Raise the pitch of note 1' }).click();
  await expect(item).toContainText(`Note 1: ${up(before)} whole`);
  await expect(dialog.locator('#quick-status')).toHaveText(`Note 1 is now ${up(before)}.`);
  await dialog.getByRole('button', { name: 'Lower the pitch of note 1' }).click();
  await dialog.getByRole('button', { name: 'Lower the pitch of note 1' }).click();
  const lowered = /Note 1: ([A-G]\d) whole/.exec(await item.innerText())![1]!;
  expect(up(lowered)).not.toBe(up(before));
  await dialog.getByLabel('Name', { exact: true }).fill('pitch');
  const event = (await download(page)).expected.events[0]!;
  expect(event.kind === 'note' && `${event.pitch.step}${event.pitch.octave}`).toBe(lowered);
});

test('a stroke belongs to one note, empty taps are explained, and cancel or remove free strokes again', async ({ page }) => {
  await openSketch(page);
  await drawMeasure(page);
  const dialog = await openLabel(page);
  await page.locator('.quick-preview').click({ position: { x: 5, y: 5 } });
  await expect(dialog.locator('#quick-status')).toContainText('No stroke is near that point');
  await tap(page, 3);
  await duration(dialog, 'Whole').click();
  await tap(page, 3);
  await expect(dialog.locator('#quick-status')).toContainText('Stroke 3 is already part of note 1');
  await expect(dialog.locator('#quick-notes li')).toHaveCount(1);
  // Cancel a half-built note: selection is cleared and nothing is added. (Stroke 4 is isolated, so
  // tapping it again in the stem step can only mean the head itself.)
  await tap(page, 4);
  await duration(dialog, 'Half').click();
  await tap(page, 4);
  await expect(dialog.locator('#quick-status')).toContainText('Stroke 4 is the head. Tap the stem.');
  await dialog.getByRole('button', { name: 'Cancel this note', exact: true }).click();
  await expect(dialog.locator('#quick-prompt')).toContainText('Tap the head of a note');
  await expect(dialog.locator('#quick-notes li')).toHaveCount(1);
  // Removing a note frees its strokes to be labeled again.
  await dialog.getByRole('button', { name: 'Remove of note 1' }).click();
  await expect(dialog.locator('#quick-notes li')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Download fixture', exact: true })).toBeDisabled();
  await tap(page, 3);
  await expect(dialog.locator('#quick-status')).toHaveText('Stroke 3 selected.');
});

test('a multi-stroke head is one primitive, and tapping a selected stroke deselects it', async ({ page }) => {
  await openSketch(page);
  await head(page, 150); await head(page, 150, 125); await head(page, 300);
  await expectStrokes(page, 3);
  const dialog = await openLabel(page);
  await tap(page, 1); await tap(page, 2); await tap(page, 3);
  await expect(dialog.locator('#quick-prompt')).toContainText('3 head strokes selected');
  await tap(page, 3);
  await expect(dialog.locator('#quick-status')).toHaveText('Stroke 3 deselected.');
  await duration(dialog, 'Whole').click();
  await dialog.getByLabel('Name', { exact: true }).fill('two-stroke-head');
  const fixture = await download(page);
  const ids = fixture.document.strokes.map((s) => s.id);
  expect(fixture.expected.primitives).toEqual([
    { label: 'noteheadHollow', strokeIds: [ids[0], ids[1]] }, { label: 'unknown', strokeIds: [ids[2]] },
  ]);
  expect(fixture.expected.events).toHaveLength(1);
  expect(fixture.expected.events[0]!.strokeIds).toEqual([ids[0], ids[1]]);
});

test('an empty page explains what to do and offers no download', async ({ page }) => {
  await openSketch(page);
  const dialog = await openLabel(page);
  await expect(dialog.locator('#quick-status')).toContainText('Draw a measure first');
  await expect(dialog.getByRole('button', { name: 'Download fixture', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expectStrokes(page, 0);
});

test('a stem drawn right against its head is still reachable when tapping near both', async ({ page }) => {
  await openSketch(page);
  await drawMeasure(page);
  const dialog = await openLabel(page);
  // Stroke 2 (the stem) touches the head's right edge, which is also where stroke 1's path is tapped.
  await tap(page, 1);
  await duration(dialog, 'Quarter').click();
  await tap(page, 1);
  await expect(dialog.locator('#quick-status')).toContainText('Added a quarter note');
  await dialog.getByLabel('Name', { exact: true }).fill('adjacent');
  const fixture = await download(page);
  const ids = fixture.document.strokes.map((s) => s.id);
  expect(fixture.expected.events[0]!.strokeIds).toEqual([ids[0], ids[1]]);
  expect(fixture.expected.primitives.filter((p) => p.label === 'unknown').map((p) => p.strokeIds)).toEqual([[ids[2]], [ids[3]]]);
});
