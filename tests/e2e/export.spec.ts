import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseFixture } from '../../src/fixtures/schema';
import { serializeBackup } from '../../src/store/schema';
import { expectSaved, expectStrokes, openSketch } from './ink-helpers';

// Template-derived synthetic scene: a quarter and a whole note, both E4.
const fixture = parseFixture(await readFile(new URL('../../fixtures/synthetic/runtime-review.json', import.meta.url), 'utf8'));

async function keepBothNotes(page: Page): Promise<void> {
  await page.getByLabel('Choose sketch backup').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(serializeBackup(fixture.document)) });
  await expectStrokes(page, fixture.document.strokes.length); await expectSaved(page);
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.locator('#review-status')).toContainText('2 proposals');
  await page.getByRole('checkbox', { name: /Note 1/ }).check();
  await page.getByRole('checkbox', { name: /Note 2/ }).check();
  await page.getByRole('button', { name: 'Keep selected notes', exact: true }).click();
  await expectSaved(page);
}

test('export with no kept notes downloads nothing and says why', async ({ page }) => {
  await openSketch(page);
  await page.getByRole('button', { name: 'Export MusicXML' }).click();
  await expect(page.locator('#backup-status')).toContainText('Nothing to export yet');
});

test('export downloads the kept notes as MusicXML and warns about an unfilled measure', async ({ page }) => {
  await openSketch(page); await keepBothNotes(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MusicXML' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.musicxml$/);
  const file = await download.path();
  if (!file) throw new Error('Missing export');
  const xml = await readFile(file, 'utf8');
  expect(xml).toContain('<score-partwise');
  expect(xml.match(/<note>/g)).toHaveLength(2);
  expect(xml).toContain('<step>E</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type>');
  expect(xml).toContain('<type>whole</type>');
  await expect(page.locator('#backup-status')).toContainText('MusicXML export requested: 2 kept events');
  await expect(page.locator('#backup-status')).toContainText('does not fill its time signature');
});
