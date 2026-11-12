import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Fixed, approved DEVELOPMENT input only. No globs, alternate paths, evaluation
// data, classifier scoring, sample selection, or source-file rewrites.
const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = 'fixtures/recorded/development/pencil-dev-1.json';
const expectedHash = '15ec56101a055df9280e8e03bb50b4414b50c09316a0ce50629dcd0de60736b9';
const output = new URL('../src/recognize/runtime-seeds.json', import.meta.url);
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Only --check is supported');
const raw = readFileSync(new URL(`../${sourcePath}`, import.meta.url));
if (createHash('sha256').update(raw).digest('hex') !== expectedHash) throw new Error('Approved development source hash changed');
const server = await createServer({ root, configFile: false, server: { middlewareMode: true } });
try {
  const { parseFixture } = await server.ssrLoadModule('/src/fixtures/schema.ts');
  const { createDevelopmentTemplates } = await server.ssrLoadModule('/tests/fixtures/development.ts');
  const fixture = parseFixture(raw.toString('utf8'));
  const templates = createDevelopmentTemplates([{ path: fileURLToPath(new URL(`../${sourcePath}`, import.meta.url)), fixture }]);
  if (templates.length !== 15) throw new Error('Expected all fifteen approved primitive groups');
  const result = {
    format: 'sheetmusicomposer-runtime-templates', version: 1, id: 'pencil-dev-v1', sampleCount: 32,
    description: 'Experimental single-writer recorded development seeds; not a universal or personal-template bank.',
    source: { path: sourcePath, sha256: expectedHash, fixtureName: fixture.name, role: 'development', provenance: 'recorded' },
    templates: templates.map((template) => ({ ...template, source: { ...template.source, kind: 'builtin' } })),
  };
  const text = JSON.stringify(result, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== text) throw new Error('Runtime artifact differs from approved derivation');
    console.log('Runtime bank exactly matches all fifteen development-derived clouds; no recognition scored.');
  } else {
    writeFileSync(output, text);
    console.log('Wrote fifteen development-derived runtime templates; original ink unchanged.');
  }
} finally { await server.close(); }
