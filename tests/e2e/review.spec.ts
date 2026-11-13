import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { config } from '../../src/config';
import { parseFixture } from '../../src/fixtures/schema';
import type { SketchDocument } from '../../src/model/document';
import { databaseName } from '../../src/store/indexeddb';
import { parseBackup, serializeBackup } from '../../src/store/schema';
import { documentToScreen, expectSaved, expectStrokes, openSketch, pointer } from './ink-helpers';

// Existing TEMPLATE-DERIVED synthetic scene, not new Pencil/independent accuracy.
const fixture = parseFixture(await readFile(new URL('../../fixtures/synthetic/runtime-review.json', import.meta.url), 'utf8'));
const source: SketchDocument = fixture.document;
async function upload(page: Page, document = source): Promise<void> {
  await page.getByLabel('Choose sketch backup').setInputFiles({ name: 'review-source.json', mimeType: 'application/json', buffer: Buffer.from(serializeBackup(document)) });
  await expectStrokes(page, document.strokes.length); await expectSaved(page);
}
async function backup(page: Page): Promise<SketchDocument> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = await (await pending).path();
  if (!file) throw new Error('Missing backup');
  return parseBackup(await readFile(file, 'utf8'));
}
async function review(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('2 proposals');
  await expect(page.locator('#note-review input[type=checkbox]').first()).toBeEnabled();
}
const keep = (page: Page) => page.getByRole('button', { name: 'Keep selected notes', exact: true });
const cancel = (page: Page) => page.getByRole('button', { name: 'Cancel review', exact: true });

test('preview is opt-in, locally rendered and read-only; all ink and unknown strokes remain visible', async ({ page, baseURL }) => {
  const offOrigin: string[] = [], origin = new URL(baseURL!).origin;
  page.on('request', (r) => { if (r.url().startsWith('http') && new URL(r.url()).origin !== origin) offOrigin.push(r.url()); });
  await openSketch(page);
  await expect(page.getByRole('button', { name: 'Review notes', exact: true })).toBeDisabled();
  await upload(page); const before = await backup(page);
  await review(page);
  await expect(page.getByRole('dialog', { name: 'Review proposed notes' })).toContainText('pencil-dev-v1');
  await expect(page.locator('.review-notation .vf-stavenote')).toHaveCount(2);
  await expect(page.locator('.review-ink polyline')).toHaveCount(4);
  await expect(page.locator('.review-ink polyline[data-stroke-number="4"]')).toHaveAttribute('stroke', '#b12e21');
  await expect(page.locator('#note-review input:checked')).toHaveCount(0);
  await expect(keep(page)).toBeDisabled();
  await expect(page.locator('#review-status')).toContainText('0 selected');
  // SVG targets are not HTMLElements: modal protection must not depend solely
  // on the shortcut target's closest() input/dialog ancestry.
  await page.locator('.review-notation svg').dispatchEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
  await expectStrokes(page, 4);
  await expect(page.locator('#review-status')).toContainText('2 proposals');
  await page.screenshot({ path: test.info().outputPath('review.png') });
  await page.getByText('Matching diagnostics (not probabilities)').first().click();
  await expect(page.locator('#note-review pre').first()).toContainText('distance');
  await expect(page.locator('#note-review pre').first()).toContainText('builtin');
  expect(await page.evaluate(() => document.fonts.check('20px Bravura'))).toBe(true);
  await cancel(page).click();
  expect(await backup(page)).toEqual(before);
  expect(offOrigin).toEqual([]);
});

test('explicitly selected notes persist with original samples, exact undo/redo, fresh-history reload and ink invalidation', async ({ page }) => {
  await openSketch(page); await upload(page); await review(page);
  await page.getByRole('checkbox', { name: /Note 1: E4, quarter/ }).check();
  await page.getByRole('checkbox', { name: /Note 2: E4, whole/ }).check();
  await expect(page.locator('#review-duration')).toContainText('Overfull: 5 quarter-note units selected but a 4/4 measure holds 4');
  await expect(page.locator('#review-duration')).toHaveAttribute('data-state', 'over');
  await keep(page).click(); await expectSaved(page);
  const after = await backup(page);
  expect(after.strokes).toEqual(source.strokes);
  expect(after.measures?.[0]?.events.map((e) => e.duration)).toEqual(['quarter', 'whole']);
  expect(after.measures?.[0]?.unresolvedStrokeIds).toEqual(['review-unknown']);
  expect(after.measures?.[0]?.events.every((e) => e.confidence >= 0 && e.confidence <= 1)).toBe(true);
  await expect(page.locator('#music-status')).toContainText('2 events in document');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(source);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(after);
  await page.reload(); await expectStrokes(page, 4);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await backup(page)).toEqual(after);
  const canvas = page.getByLabel('Music ink surface');
  // Ink beside the first note (quarter, E4) takes only that note; the whole note stays.
  const head = await documentToScreen(canvas, 4, 4);
  await pointer(canvas, 'pointerdown', head.x, head.y); await pointer(canvas, 'pointerup', head.x + 10, head.y); await expectSaved(page);
  expect((await backup(page)).measures?.[0]?.events.map((e) => e.duration)).toEqual(['whole']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(after);
});

test('hollow head plus a unique stem renders and keeps a half note without invented rests', async ({ page }) => {
  const half: SketchDocument = { strokes: [{ ...source.strokes[2]!, id: 'half-head', points: source.strokes[2]!.points.map((p) => ({ ...p, x: p.x - 6 })) },
    source.strokes[1]!, source.strokes[3]!] };
  await openSketch(page); await upload(page, half);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('1 proposal');
  await expect(page.locator('.review-notation .vf-stavenote')).toHaveCount(1);
  await page.getByRole('checkbox', { name: /Note 1: E4, half/ }).check();
  await expect(page.locator('#review-duration')).toContainText('Underfull: 2 of 4 quarter-note units in 4/4; 2 quarter-note units short.');
  await keep(page).click(); await expectSaved(page);
  const result = await backup(page);
  expect(result.measures?.[0]?.events.map((e) => e.duration)).toEqual(['half']);
  expect(result.strokes).toEqual(half.strokes);
});

test('partial explicit selection and time signature changes keep all other source ink unresolved', async ({ page }) => {
  await openSketch(page); await upload(page); await review(page);
  await page.getByLabel('Review time signature').selectOption('6/8');
  await expect(page.getByRole('checkbox', { name: /Note 2/ })).toBeEnabled();
  await page.getByRole('checkbox', { name: /Note 2/ }).check();
  await expect(page.locator('#review-duration')).toContainText('Overfull: 4 quarter-note units selected but a 6/8 measure holds 3');
  await page.getByLabel('Review time signature').selectOption('4/4');
  await expect(page.locator('#review-duration')).toHaveAttribute('data-state', 'match');
  await expect(page.locator('#review-duration')).toContainText('Total matches: 4 quarter-note units in 4/4');
  await page.getByLabel('Review time signature').selectOption('6/8');
  await expect(page.locator('#review-duration')).toHaveAttribute('data-state', 'over');
  await keep(page).click(); await expectSaved(page);
  const result = await backup(page);
  expect(result.measures?.[0]?.timeSignature).toBe('6/8');
  expect(result.measures?.[0]?.events.map((e) => e.duration)).toEqual(['whole']);
  expect(result.measures?.[0]?.unresolvedStrokeIds).toEqual(['review-head', 'review-stem', 'review-unknown']);
  expect(result.strokes).toEqual(source.strokes);
});

test('review is disabled during contact and does not interrupt a pending Pencil stroke', async ({ page }) => {
  await openSketch(page); await upload(page);
  const canvas = page.getByLabel('Music ink surface');
  await pointer(canvas, 'pointerdown', 100, 100);
  await expect(page.getByRole('button', { name: 'Review notes', exact: true })).toBeDisabled();
  await expect(page.locator('#save-status')).toContainText('Drawing');
  await pointer(canvas, 'pointermove', 110, 100); await pointer(canvas, 'pointerup', 120, 100);
  await expectStrokes(page, 5); await expectSaved(page);
  const doc = await backup(page);
  expect(doc.strokes.at(-1)?.completion).toBe('complete');
  expect(doc.strokes.at(-1)?.points).toHaveLength(3);
  await expect(page.getByRole('button', { name: 'Review notes', exact: true })).toBeEnabled();
});

test('active contact behind a preview invalidates selection rather than committing or interrupting it', async ({ page }) => {
  await openSketch(page); await upload(page); await review(page);
  await page.getByRole('checkbox', { name: /Note 1/ }).check();
  const canvas = page.getByLabel('Music ink surface');
  // Synthetic bypass of native modal inertness exercises the independent guard.
  await pointer(canvas, 'pointerdown', 100, 100);
  await expect(page.locator('#review-status')).toContainText('Pen contact started');
  await expect(keep(page)).toBeDisabled();
  await pointer(canvas, 'pointerup', 110, 100);
  await expect(page.locator('#review-status')).toContainText('Sketch changed');
  await expectStrokes(page, 5);
  // Returning to the exact old base via Undo must not reactivate a canceled
  // generation or a disabled signature control's synthetic change event.
  await page.getByRole('button', { name: 'Undo', exact: true }).dispatchEvent('click');
  await expectStrokes(page, 4);
  await page.getByLabel('Review time signature').dispatchEvent('change');
  await expect(page.locator('#note-review input[type=checkbox]').first()).toBeDisabled();
  await expect(keep(page)).toBeDisabled();
  await cancel(page).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(source);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expectSaved(page);
  const doc = await backup(page);
  expect(doc.measures).toBeUndefined(); expect(doc.strokes).toHaveLength(5);
  expect(doc.strokes.at(-1)?.completion).toBe('complete');
});

test('cancel during worker loading rejects late results and a new preview starts unchecked', async ({ page }) => {
  await openSketch(page); await upload(page);
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  await page.route('**/review-worker-*.js', async (route) => { if (first) { first = false; await delayed; } await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('Preparing');
  await cancel(page).click(); release();
  await expect(page.locator('#note-review')).not.toBeVisible();
  expect(await backup(page)).toEqual(source);
  await review(page); await expect(keep(page)).toBeDisabled();
  await expect(page.locator('#note-review input:checked')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await backup(page)).toEqual(source);
});

test('unknown-only ink never invents selectable notes or overwrites existing musical metadata', async ({ page }) => {
  const unknown: SketchDocument = { strokes: [source.strokes[3]!], measures: [{ id: 'existing', clef: 'treble', timeSignature: '3/4', events: [], unresolvedStrokeIds: ['review-unknown'] }] };
  await openSketch(page); await upload(page, unknown);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('0 proposals');
  await expect(page.locator('#note-review input[type=checkbox]')).toHaveCount(0);
  await expect(page.locator('.review-ink polyline')).toHaveCount(1);
  await expect(keep(page)).toBeDisabled(); await cancel(page).click();
  expect(await backup(page)).toEqual(unknown);
});

test('notation chunk failure leaves the sketch intact and confirmation disabled', async ({ page }) => {
  await openSketch(page); await upload(page);
  await page.route('**/notation-*.js', (route) => route.abort());
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('Preview failed');
  await expect(keep(page)).toBeDisabled();
  await cancel(page).click(); expect(await backup(page)).toEqual(source);
});

test('a local font readiness failure is not treated as a successful preview', async ({ page }) => {
  // Patch the prototype before any page script runs; WebKit ignores an instance-level override.
  await page.addInitScript(() => { FontFaceSet.prototype.load = () => Promise.reject(new Error('test font unavailable')); });
  await openSketch(page); await upload(page);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('test font unavailable');
  await expect(keep(page)).toBeDisabled(); await cancel(page).click();
  expect(await backup(page)).toEqual(source);
});

test('extreme written pitches have ledger notation inside an expanded SVG viewBox', async ({ page }) => {
  const extreme: SketchDocument = { strokes: source.strokes.map((s, i) => ({ ...s, points: s.points.map((p) => ({ ...p, y: p.y + (i < 2 ? -19.5 : i === 2 ? 15 : 0) })) })) };
  await openSketch(page); await upload(page, extreme); await review(page);
  await expect(page.getByRole('checkbox', { name: /Note 1: B9/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Note 2: C0/ })).toBeVisible();
  expect(await page.locator('.review-notation svg').evaluate((svg: SVGSVGElement) => {
    const b = svg.getBBox(), v = svg.viewBox.baseVal;
    return b.y >= v.y && b.y + b.height <= v.y + v.height;
  })).toBe(true);
  await cancel(page).click(); expect((await backup(page)).strokes).toEqual(extreme.strokes);
});

test('work caps and multiple stored measures refuse review without truncation or flattening', async ({ page }) => {
  await openSketch(page);
  const m = { id: 'a', clef: 'treble' as const, timeSignature: '4/4' as const, events: [], unresolvedStrokeIds: [] };
  const multi: SketchDocument = { ...source, measures: [m, { ...m, id: 'b' }] };
  await upload(page, multi);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('one-measure'); await expect(keep(page)).toBeDisabled();
  await cancel(page).click(); expect(await backup(page)).toEqual(multi);
  page.on('dialog', (dialog) => dialog.accept());
  const huge: SketchDocument = { strokes: [{ ...source.strokes[0]!, points: Array.from({ length: config.reviewMaxPoints + 1 }, () => source.strokes[0]!.points[0]!) }] };
  await upload(page, huge);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('point work limit'); await expect(keep(page)).toBeDisabled();
  await cancel(page).click(); expect((await backup(page)).strokes[0]?.points).toHaveLength(config.reviewMaxPoints + 1);
});

test('too many proposals are refused as a whole, not displayed/kept as a silent truncated subset', async ({ page }) => {
  const head = source.strokes[2]!;
  const many: SketchDocument = { strokes: Array.from({ length: config.reviewMaxDisplayNotes + 1 }, (_, i) => ({ ...head, id: `head-${i}`,
    points: head.points.map((p) => ({ ...p, x: p.x + i * 2 })) })) };
  await openSketch(page); await upload(page, many);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('Too many proposals');
  await expect(page.locator('#review-status')).toContainText('No proposals were truncated');
  await expect(keep(page)).toBeDisabled(); await expect(page.locator('#note-review input[type=checkbox]')).toHaveCount(0);
  await cancel(page).click(); expect(await backup(page)).toEqual(many);
});

test('document replacement during notation loading prevents late publication and acceptance', async ({ page }) => {
  await openSketch(page); await upload(page);
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let requested: () => void = () => {};
  const started = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('**/notation-*.js', async (route) => { requested(); await delayed; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await started;
  page.on('dialog', (d) => d.accept());
  const replacement: SketchDocument = { strokes: [...source.strokes, { ...source.strokes[3]!, id: 'replacement-extra' }] };
  // Native modality prevents this normally; force a real document update to
  // exercise stale async-result guards independently of contact prevention.
  await upload(page, replacement);
  await expect(page.locator('#review-status')).toContainText('Sketch changed');
  release();
  await expect(keep(page)).toBeDisabled();
  await cancel(page).click(); expect(await backup(page)).toEqual(replacement);
  await review(page); await expect(keep(page)).toBeDisabled();
  await expect(page.locator('#note-review input:checked')).toHaveCount(0);
  await cancel(page).click(); expect(await backup(page)).toEqual(replacement);
});

test('worker load failure keeps ink intact and a canceled retry can start a fresh worker', async ({ page }) => {
  await openSketch(page); await upload(page);
  await page.route('**/review-worker-*.js', (route) => route.abort());
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('Review worker failed');
  await expect(keep(page)).toBeDisabled(); await cancel(page).click();
  expect(await backup(page)).toEqual(source);
  await page.unroute('**/review-worker-*.js');
  await review(page); await expect(keep(page)).toBeDisabled(); await cancel(page).click();
});

test('reviewed notes compose with New and Restore in the same reversible history', async ({ page }) => {
  await openSketch(page); await upload(page); await review(page);
  await page.getByRole('checkbox', { name: /Note 1/ }).check(); await keep(page).click(); await expectSaved(page);
  const after = await backup(page);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'New', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual({ strokes: [] });
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(after);
  await upload(page);
  // Both have four strokes, so wait for the restore's musical-state change too.
  await expect(page.locator('#music-status')).toBeEmpty(); await expectSaved(page);
  expect(await backup(page)).toEqual(source);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expectSaved(page);
  expect(await backup(page)).toEqual(after);
});

test('review duration line distinguishes empty from underfull selections', async ({ page }) => {
  await openSketch(page); await upload(page); await review(page);
  await expect(page.locator('#review-duration')).toHaveAttribute('data-state', 'empty');
  await expect(page.locator('#review-duration')).toContainText('No notes selected. A 4/4 measure holds 4 quarter-note units.');
  await page.getByRole('checkbox', { name: /Note 1: E4, quarter/ }).check();
  await expect(page.locator('#review-duration')).toHaveAttribute('data-state', 'under');
  await expect(page.locator('#review-duration')).toContainText('Underfull: 1 of 4 quarter-note units in 4/4; 3 quarter-note units short.');
  await cancel(page).click();
});

// Personal templates (milestone 7, PR 3). Samples are trained through the real
// training screen from the uploaded ink itself, so the match provenance is deterministic.
async function trainFromPage(page: Page, labels: Record<number, string>): Promise<void> {
  await page.getByRole('button', { name: 'Personal templates', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Personal templates' });
  await expect(dialog).toBeVisible();
  for (const [stroke, label] of Object.entries(labels)) await dialog.getByLabel(new RegExp(`^Stroke ${stroke} `)).selectOption(label);
  await expect(dialog.locator('.training-problem')).toHaveText(['', '', '', '']);
  await dialog.getByRole('button', { name: 'Save labeled samples' }).click();
  await expect(dialog.locator('#training-status')).toContainText(`Saved ${Object.keys(labels).length} samples.`);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeVisible();
}
const trained = { 1: 'noteheadFilled', 2: 'stem', 3: 'noteheadHollow' };

test('review uses personal samples, shows the merged bank, and marks personal matches', async ({ page }) => {
  await openSketch(page); await upload(page);
  await review(page);
  await expect(page.locator('#review-bank')).toContainText('no personal samples');
  await expect(page.locator('.review-personal')).toHaveCount(0);
  await cancel(page).click();
  await trainFromPage(page, trained);
  const before = await backup(page);
  await review(page);
  await expect(page.locator('#review-bank')).toContainText('pencil-dev-v1+user-3-');
  await expect(page.locator('#review-bank')).toContainText('15 built-in samples plus 3 personal samples');
  await expect(page.locator('.review-personal')).toHaveCount(2);
  await expect(page.locator('.review-personal').first()).toContainText('Closest match was one of your personal samples.');
  await page.getByText('Matching diagnostics (not probabilities)').first().click();
  await expect(page.locator('#note-review pre').first()).toContainText('user/');
  await page.getByRole('checkbox', { name: /Note 1: E4, quarter/ }).check();
  await keep(page).click(); await expectSaved(page);
  const after = await backup(page);
  expect(after.strokes).toEqual(before.strokes);
  expect(after.measures?.[0]?.events.map((e) => e.duration)).toEqual(['quarter']);
});

test('a template change after the preview, even from another tab, refuses to keep stale proposals', async ({ page, context }) => {
  await openSketch(page); await upload(page);
  const before = await backup(page);
  await review(page);
  await expect(page.locator('#review-bank')).toContainText('no personal samples');
  const other = await context.newPage();
  await openSketch(other);
  await expectStrokes(other, 4);
  await trainFromPage(other, trained);
  await page.getByRole('checkbox', { name: /Note 1: E4, quarter/ }).check();
  await keep(page).click();
  await expect(page.locator('#review-status')).toContainText('Personal templates changed since this preview');
  await expect(keep(page)).toBeDisabled();
  await cancel(page).click();
  expect(await backup(page)).toEqual(before);
  expect((await backup(page)).measures).toBeUndefined();
  // A fresh review now uses the new samples.
  await review(page);
  await expect(page.locator('#review-bank')).toContainText('plus 3 personal samples');
});

test('a damaged stored template record is ignored and reported, and review still works', async ({ page }) => {
  await openSketch(page); await upload(page);
  await page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('templates', 'readwrite');
      tx.objectStore('templates').put({ format: 'something-else' }, 'broken-1');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }), databaseName);
  await review(page);
  await expect(page.locator('#review-bank')).toContainText('1 stored template record was damaged and ignored');
  await expect(page.locator('#review-bank')).toContainText('no personal samples');
});

test('review falls back to built-in samples, and says so, when template storage is unavailable', async ({ page }) => {
  await openSketch(page);
  await page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  }), databaseName);
  await page.reload();
  await expect(page.locator('#save-status')).toContainText('Storage unavailable');
  await page.getByLabel('Choose sketch backup').setInputFiles({ name: 'review-source.json', mimeType: 'application/json', buffer: Buffer.from(serializeBackup(source)) });
  await expectStrokes(page, source.strokes.length);
  await review(page);
  await expect(page.locator('#review-bank')).toContainText('built-in samples only: personal templates are unavailable');
  await expect(page.locator('#review-bank')).toContainText('pencil-dev-v1');
});
