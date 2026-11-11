import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { classificationReport, evaluatePrimitives } from '../fixtures/classification';
import { createDevelopmentTemplates } from '../fixtures/development';
import { loadFixtures } from '../fixtures/load';
import { fixtureRole, fixtureRoot } from '../fixtures/roles';
import { frozenPencilV1 } from './frozen-pencil-v1';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const hashFile = (path: string): string => createHash('sha256').update(readFileSync(join(projectRoot, path))).digest('hex');

it('evaluates only the pre-frozen candidate, with no evaluation templates or post-result tuning', () => {
  // Fail BEFORE classification if the model, adapter, runner, decoder, or source
  // recordings differ. Reproduce from the frozen commit rather than updating
  // these hashes to make a changed model appear to be the original experiment.
  for (const [path, expected] of Object.entries(frozenPencilV1.sourceHashes)) expect(hashFile(path), path).toBe(expected);
  expect(hashFile(frozenPencilV1.development.path)).toBe(frozenPencilV1.development.sha256);
  expect(hashFile(frozenPencilV1.evaluation.path)).toBe(frozenPencilV1.evaluation.sha256);
  const files = loadFixtures(fixtureRoot);
  const development = files.find(({ path }) => path === join(projectRoot, frozenPencilV1.development.path));
  const evaluation = files.find(({ path }) => path === join(projectRoot, frozenPencilV1.evaluation.path));
  if (!development || !evaluation) throw new Error('Missing frozen input recordings');
  expect(fixtureRole(development.path)).toBe('development');
  expect(fixtureRole(evaluation.path)).toBe('evaluation');
  const bank = createDevelopmentTemplates([development]);
  expect(bank).toHaveLength(frozenPencilV1.templateCount);
  expect(bank.every(({ source }) => source.kind === 'user')).toBe(true);
  const observations = evaluatePrimitives([evaluation], bank);
  expect(observations).toHaveLength(20);
  const developmentIds = new Set(bank.map(({ id }) => id));
  expect(observations.every(({ result }) => result.candidates.every(({ templateId }) => developmentIds.has(templateId)))).toBe(true);
  console.info(classificationReport(observations, '15 development templates; frozen pencil-v1 candidate', 'frozen-evaluation'));
  console.info(JSON.stringify(observations.map(({ expected, result }, index) => ({
    annotation: index + 1, expected, predicted: result.label, rejection: result.rejection,
    margin: result.margin, linearityRatio: result.linearityRatio,
    candidates: result.candidates.map(({ label, distance, geometryRejections }) => ({ label, distance, geometryRejections })),
  })), null, 2));
  // No pass/fail accuracy target chosen after seeing results. This test checks
  // protocol integrity; report every mistake/rejection, even for a poor model.
});
