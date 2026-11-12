import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFixture } from '../../src/fixtures/schema';
import { ImportError, planImport, slugify } from './import-fixture';
import { runImport } from './import-run';
import { decodeManifest, serializeManifest, sessionCounts, withEntry } from './manifest';
import type { Manifest } from './manifest';
import { manifestPath } from './roles';

const fixturesDir = new URL('../../fixtures/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, fixturesDir), 'utf8');
/** A real recorded export under a new name, so it can be imported into an empty directory. */
const renamed = (path: string, from: string, to: string): string => {
  const text = read(path);
  expect(text.split(`"name": "${from}"`)).toHaveLength(2);
  return text.replace(`"name": "${from}"`, `"name": "${to}"`);
};
const empty: Manifest = { fixtures: {} };
const manifestText = (fixtures: Manifest['fixtures'] = {}): string => serializeManifest({ fixtures });

describe('manifest', () => {
  it('decodes the committed manifest, which is already in its canonical form', () => {
    const text = readFileSync(manifestPath, 'utf8');
    expect(serializeManifest(decodeManifest(text))).toBe(text);
  });

  it.each<[string, string, string]>([
    ['text that is not JSON', 'nope', 'not valid JSON'],
    ['a non-object', '[]', 'must be an object'],
    ['another format', JSON.stringify({ format: 'x', version: 1, fixtures: {} }), 'Unsupported fixture manifest'],
    ['a future version', JSON.stringify({ format: 'sheetmusicomposer-fixture-manifest', version: 2, fixtures: {} }), 'Unsupported fixture manifest'],
    ['a path that escapes the fixtures directory', manifestText({ 'a/../b.json': { role: 'regression' } }), 'Invalid fixture path'],
    ['an absolute path', manifestText({ '/etc/x.json': { role: 'regression' } }), 'Invalid fixture path'],
    ['a non-JSON file', manifestText({ 'a/b.txt': { role: 'regression' } }), 'Invalid fixture path'],
    ['an unknown role', JSON.stringify({ format: 'sheetmusicomposer-fixture-manifest', version: 1, fixtures: { 'a.json': { role: 'other' } } }), 'Invalid role'],
    ['a session on a reserved fixture', JSON.stringify({ format: 'sheetmusicomposer-fixture-manifest', version: 1, fixtures: { 'a.json': { role: 'evaluation', session: 's' } } }), 'Only regression fixtures have sessions'],
    ['a malformed session', JSON.stringify({ format: 'sheetmusicomposer-fixture-manifest', version: 1, fixtures: { 'a.json': { role: 'regression', session: 'Bad Session' } } }), 'Invalid session'],
    ['an unknown field', JSON.stringify({ format: 'sheetmusicomposer-fixture-manifest', version: 1, fixtures: { 'a.json': { role: 'regression', note: 'x' } } }), 'Unknown manifest field'],
  ])('rejects %s', (_name, text, message) => {
    expect(() => decodeManifest(text)).toThrow(message);
  });

  it('writes sorted, stable output and refuses to overwrite an entry', () => {
    const manifest = withEntry(withEntry(empty, 'recorded/b.json', { role: 'regression', session: 's2' }), 'recorded/a.json', { role: 'regression', session: 's1' });
    expect(Object.keys(JSON.parse(serializeManifest(manifest)).fixtures)).toEqual(['recorded/a.json', 'recorded/b.json']);
    expect(() => withEntry(manifest, 'recorded/a.json', { role: 'regression' })).toThrow('already in the manifest');
    expect(sessionCounts(withEntry(manifest, 'recorded/c.json', { role: 'regression', session: 's1' }))).toEqual(new Map([['s1', 2], ['s2', 1]]));
  });
});

describe('planning an import', () => {
  const text = renamed('recorded/sample-fail.json', 'Sample-mixed-first-e4-rejected', 'Free test / one');
  const state = { names: new Set<string>(), paths: new Set<string>(), manifest: empty };

  it('puts a recorded fixture under recorded/ as a regression fixture in its session', () => {
    const plan = planImport({ name: 'in.json', text }, state, { session: 'sitting-1' });
    expect(plan.path).toBe('recorded/free-test-one.json');
    expect(plan.fixture.name).toBe('Free test / one');
    expect(plan.manifest.fixtures['recorded/free-test-one.json']).toEqual({ role: 'regression', session: 'sitting-1' });
    expect(state.manifest.fixtures).toEqual({});
  });

  it('makes file names from fixture names like the app does', () => {
    expect(slugify('Free test / one')).toBe('free-test-one');
    expect(slugify('  --Weird__Name!!  ')).toBe('weird__name');
    expect(slugify('???')).toBe('fixture');
    expect(slugify('x'.repeat(200))).toHaveLength(80);
  });

  it('requires a session, and lists the existing ones to choose from', () => {
    const known = withEntry(empty, 'recorded/x.json', { role: 'regression', session: 'earlier' });
    expect(() => planImport({ name: 'in.json', text }, state, {})).toThrow('--session <id> is required');
    expect(() => planImport({ name: 'in.json', text }, { ...state, manifest: known }, {})).toThrow('Existing sessions: earlier (1)');
    expect(() => planImport({ name: 'in.json', text }, state, { session: 'Not Valid' })).toThrow('Invalid session id');
  });

  it.each<[string, string, string]>([
    ['a file that is not a fixture', '{"format":"nope"}', 'not a valid fixture file'],
    ['text that is not JSON', 'oops', 'not a valid fixture file'],
    ['a hand-authored synthetic fixture', read('synthetic/half-e4.json'), 'Only recorded fixtures are imported'],
  ])('refuses %s', (_name, bad, message) => {
    expect(() => planImport({ name: 'in.json', text: bad }, state, { session: 's' })).toThrow(message);
  });

  it('refuses a duplicate name or a path that is already taken', () => {
    expect(() => planImport({ name: 'in.json', text }, { ...state, names: new Set(['Free test / one']) }, { session: 's' })).toThrow('already exists');
    expect(() => planImport({ name: 'in.json', text }, { ...state, paths: new Set(['recorded/free-test-one.json']) }, { session: 's' })).toThrow('already exists');
    expect(() => planImport({ name: 'in.json', text }, state, { session: 's' })).not.toThrow(ImportError);
  });
});

describe('importing files', () => {
  let dir: string, root: string, manifestFile: string, logs: string[];
  const input = (name: string, text: string): string => { const path = join(dir, name); writeFileSync(path, text); return path; };
  const env = () => ({ log: (line: string) => logs.push(line), fixturesRoot: root, manifestFile });
  const one = renamed('recorded/sample-fail.json', 'Sample-mixed-first-e4-rejected', 'Import One');
  const two = renamed('recorded/a4-whole-x4.json', 'Mixed-a4-whole-x4-third-rejected', 'Import Two');
  const written = (): string[] => existsSync(root) ? readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json')).sort() : [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fixture-import-'));
    root = join(dir, 'fixtures'); mkdirSync(root);
    manifestFile = join(dir, 'manifest.json'); writeFileSync(manifestFile, manifestText());
    logs = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies each file byte for byte, records role and session, and reports the built-in result', () => {
    const a = input('a.json', one), b = input('b.json', two);
    const result = runImport(['--session', 'sitting-1', a, b], env());
    expect(result.imported.map((i) => i.path)).toEqual(['recorded/import-one.json', 'recorded/import-two.json']);
    expect(readFileSync(join(root, 'recorded/import-one.json')).equals(readFileSync(a))).toBe(true);
    expect(readFileSync(join(root, 'recorded/import-two.json')).equals(readFileSync(b))).toBe(true);
    const manifest = decodeManifest(readFileSync(manifestFile, 'utf8'));
    expect(manifest.fixtures).toEqual({ 'recorded/import-one.json': { role: 'regression', session: 'sitting-1' }, 'recorded/import-two.json': { role: 'regression', session: 'sitting-1' } });
    expect(logs.join('\n')).toContain('built-in bank: shapes exact');
    expect(logs.join('\n')).toContain('session sitting-1 now has 2');
    // The copied file is still a valid fixture with the same ink.
    expect(parseFixture(readFileSync(join(root, 'recorded/import-one.json'), 'utf8')).document).toEqual(parseFixture(one).document);
  });

  it('accepts --session=value and writes nothing on a dry run', () => {
    const a = input('a.json', one);
    const result = runImport(['--dry-run', '--session=sitting-1', a], env());
    expect(result.dryRun).toBe(true);
    expect(written()).toEqual([]);
    expect(readFileSync(manifestFile, 'utf8')).toBe(manifestText());
    expect(logs.join('\n')).toContain('Would import "Import One"');
    expect(logs.join('\n')).toContain('Dry run: nothing was written.');
  });

  it('is all or nothing: one bad file leaves the repository untouched', () => {
    const good = input('good.json', one), bad = input('bad.json', '{"not":"a fixture"}');
    expect(() => runImport(['--session', 's', good, bad], env())).toThrow('not a valid fixture file');
    expect(written()).toEqual([]);
    expect(readFileSync(manifestFile, 'utf8')).toBe(manifestText());
  });

  it('refuses to import the same fixture twice, or the same file twice in one command', () => {
    const a = input('a.json', one);
    runImport(['--session', 's', a], env());
    expect(() => runImport(['--session', 's', a], env())).toThrow('already exists');
    expect(written()).toEqual(['recorded/import-one.json']);
    const copy = input('copy.json', two), same = input('same.json', two);
    expect(() => runImport(['--session', 's', copy, same], env())).toThrow('duplicate of another file');
  });

  it.each<[string, string[], string]>([
    ['no files', ['--session', 's'], 'No fixture files given'],
    ['a missing file', ['--session', 's', 'does-not-exist.json'], 'File not found'],
    ['an unknown option', ['--role', 'evaluation', 'x.json'], 'Unknown option --role'],
    ['a session option with no value', ['--session'], '--session needs a value'],
  ])('refuses %s', (_name, argv, message) => {
    expect(() => runImport(argv, env())).toThrow(message);
    expect(written()).toEqual([]);
  });

  it('requires a session and never imports a development or evaluation fixture', () => {
    const a = input('a.json', one);
    expect(() => runImport([a], env())).toThrow('--session <id> is required');
    const synthetic = input('s.json', read('synthetic/half-e4.json'));
    expect(() => runImport(['--session', 's', synthetic], env())).toThrow('Only recorded fixtures');
    expect(written()).toEqual([]);
  });

  it('prints usage for --help without touching anything', () => {
    runImport(['--help'], env());
    expect(logs.join('\n')).toContain('Usage: npm run fixtures:import');
    expect(written()).toEqual([]);
  });
});

it('runs from the command line through the real script', { timeout: 60000 }, () => {
  const output = execFileSync(process.execPath, ['scripts/import-fixtures.mjs', '--help'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  expect(output).toContain('Usage: npm run fixtures:import');
});
