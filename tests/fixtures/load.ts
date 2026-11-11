import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFixture } from '../../src/fixtures/schema';
import type { InkFixture } from '../../src/fixtures/schema';

export interface LoadedFixture { readonly path: string; readonly fixture: InkFixture }

/** Recursively load reviewed JSON, never trusting a file's extension as validation. */
export function loadFixtures(directory: string): LoadedFixture[] {
  const files: LoadedFixture[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...loadFixtures(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      try { files.push({ path, fixture: parseFixture(readFileSync(path, 'utf8')) }); }
      catch (cause) { throw new Error(`Invalid fixture: ${path}`, { cause }); }
    }
  }
  const names = new Set<string>();
  for (const { fixture } of files) {
    if (names.has(fixture.name)) throw new Error(`Duplicate fixture name: ${fixture.name}`);
    names.add(fixture.name);
  }
  return files;
}

/** Inventory only. Recognition accuracy must not be inferred from schema tests. */
export function fixtureInventory(fixtures: readonly LoadedFixture[]): string {
  const sets = new Map<string, number>();
  const primitives = new Map<string, number>();
  for (const { fixture } of fixtures) {
    const set = `${fixture.set} (${fixture.provenance})`;
    sets.set(set, (sets.get(set) ?? 0) + 1);
    for (const { label } of fixture.expected.primitives) primitives.set(label, (primitives.get(label) ?? 0) + 1);
  }
  const counts = (values: Map<string, number>): string => Array.from(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `${key}: ${count}`).join(', ');
  return `Fixture inventory — ${fixtures.length} files\nSets: ${counts(sets)}\nExpected primitives: ${counts(primitives)}\nRecognition accuracy: N/A — inventory/schema checks only (development classifier results reported separately).`;
}
