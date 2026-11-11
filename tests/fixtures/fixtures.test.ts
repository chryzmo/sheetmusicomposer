import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseFixture, serializeFixture } from '../../src/fixtures/schema';
import { fixtureInventory, loadFixtures } from './load';

const fixtures = loadFixtures(fileURLToPath(new URL('../../fixtures/', import.meta.url)));

it('reports an inventory without claiming recognition accuracy', () => {
  expect(fixtures.length).toBeGreaterThan(0);
  const report = fixtureInventory(fixtures);
  console.info(report);
  expect(report).toContain('Recognition accuracy: N/A');
});

it.each(fixtures)('validates and round-trips reviewed fixture $fixture.name', ({ fixture }) => {
  expect(parseFixture(serializeFixture(fixture))).toEqual(fixture);
});

it('fails loudly with a path for malformed JSON and unknown versions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ink-fixtures-'));
  const path = join(directory, 'broken.json');
  try {
    for (const text of ['{broken', '{"format":"sheetmusicomposer-fixture","version":99}']) {
      writeFileSync(path, text);
      expect(() => loadFixtures(directory)).toThrow(path);
    }
  } finally { rmSync(directory, { recursive: true }); }
});

it('rejects duplicate fixture names across nested directories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ink-fixtures-'));
  try {
    mkdirSync(join(directory, 'nested'));
    const fixture = fixtures[0]!.fixture;
    writeFileSync(join(directory, 'a.json'), serializeFixture(fixture));
    writeFileSync(join(directory, 'nested', 'b.json'), serializeFixture(fixture));
    expect(() => loadFixtures(directory)).toThrow('Duplicate fixture name');
  } finally { rmSync(directory, { recursive: true }); }
});
