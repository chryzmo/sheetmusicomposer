import type { ExpectedEvent } from '../../src/fixtures/schema';
import type { Stroke } from '../../src/ink/types';
import { sampleGeometryRejections } from '../../src/recognize/classify';
import { prepareMusicReview } from '../../src/recognize/review';
import type { ReviewBank } from '../../src/recognize/review';
import { createRuntimeBank } from '../../src/recognize/runtime-bank';
import { checkCanAdd, mergeTemplateBank, userTemplateLabels } from '../../src/recognize/user-templates';
import type { UserTemplateSample } from '../../src/recognize/user-templates';
import { evaluatePrimitives } from './classification';
import type { LoadedFixture } from './load';
import type { SessionFixture } from './personal-sessions';

/** Simulated training: fixture primitives become personal samples under the SAME
 * rules the training screen enforces (single complete stroke, own label's geometry
 * gates, per-shape limit). Labels are manual fixture truth, never recognizer
 * output. Deterministic: fixture order, then primitive order.
 */
export interface SimulatedTraining {
  readonly samples: readonly UserTemplateSample[];
  readonly refused: readonly { readonly sampleId: string; readonly reason: string }[];
}
export function simulateTraining(fixtures: readonly LoadedFixture[]): SimulatedTraining {
  const samples: UserTemplateSample[] = [], refused: { sampleId: string; reason: string }[] = [];
  let clock = 0;
  for (const { fixture } of fixtures) {
    const strokes = new Map(fixture.document.strokes.map((s) => [s.id, s]));
    fixture.expected.primitives.forEach(({ label, strokeIds }, index) => {
      const known = userTemplateLabels.find((l) => l === label);
      if (!known) return; // unknown/unsupported ink is never a sample
      const id = `${fixture.name}#${index + 1}`;
      try {
        if (strokeIds.length !== 1) throw new Error('multi-stroke primitives are not supported');
        const stroke: Stroke = strokes.get(strokeIds[0]!)!;
        const sample: UserTemplateSample = { id, label: known, createdAt: ++clock, strokes: [stroke] };
        checkCanAdd(samples, sample);
        const rejections = sampleGeometryRejections(known, sample.strokes);
        if (rejections.length > 0) throw new Error(`fails its own geometry gates (${rejections.join(', ')})`);
        samples.push(sample);
      } catch (error) { refused.push({ sampleId: id, reason: error instanceof Error ? error.message : String(error) }); }
    });
  }
  return { samples, refused };
}

export interface PrimitiveScore { readonly total: number; readonly exact: number; readonly wrongAccepts: number; readonly knownRejects: number }
export interface EventScore { readonly expected: number; readonly proposedExactly: number; readonly wrongProposals: number }
export interface BankScore { readonly primitives: PrimitiveScore; readonly events: EventScore }
export interface FoldResult {
  readonly heldOut: string;
  readonly fixtures: readonly string[];
  readonly trainedFrom: readonly string[];
  readonly trainingFixtures: readonly string[];
  readonly samples: number;
  readonly refused: SimulatedTraining['refused'];
  readonly builtin: BankScore;
  readonly personal: BankScore;
}

function scorePrimitives(fixtures: readonly LoadedFixture[], bank: ReviewBank): PrimitiveScore {
  const rows = evaluatePrimitives(fixtures, bank.templates);
  return {
    total: rows.length,
    exact: rows.filter(({ expected, result }) => expected === result.label).length,
    wrongAccepts: rows.filter(({ expected, result }) => result.label !== 'unknown' && result.label !== expected).length,
    knownRejects: rows.filter(({ expected, result }) => expected !== 'unknown' && result.label === 'unknown').length,
  };
}

const sameEvent = (note: ReturnType<typeof prepareMusicReview>['candidates'][number]['note'], expected: ExpectedEvent): boolean =>
  expected.kind === 'note' && note.kind === 'note' && note.duration === expected.duration && note.dots === expected.dots &&
  note.accidental === expected.accidental && note.pitch.step === expected.pitch.step && note.pitch.octave === expected.pitch.octave &&
  [...note.strokeIds].sort().join() === [...expected.strokeIds].sort().join();

/** Note-level result with singleton grouping (what Review notes does today).
 * Fixtures with no expected events are skipped: an empty list is not a claim of
 * "no notes", so proposals there could not be scored fairly.
 */
function scoreEvents(fixtures: readonly LoadedFixture[], bank: ReviewBank): EventScore {
  let expected = 0, proposedExactly = 0, wrongProposals = 0;
  for (const { fixture } of fixtures) {
    if (fixture.expected.events.length === 0) continue;
    const { candidates } = prepareMusicReview(fixture.document, bank);
    expected += fixture.expected.events.length;
    proposedExactly += fixture.expected.events.filter((event) => candidates.some(({ note }) => sameEvent(note, event))).length;
    wrongProposals += candidates.filter(({ note }) => !fixture.expected.events.some((event) => sameEvent(note, event))).length;
  }
  return { expected, proposedExactly, wrongProposals };
}

export function scoreBank(fixtures: readonly LoadedFixture[], bank: ReviewBank): BankScore {
  return { primitives: scorePrimitives(fixtures, bank), events: scoreEvents(fixtures, bank) };
}

function fold(heldOut: string, held: readonly LoadedFixture[], training: readonly SessionFixture[]): FoldResult {
  const simulated = simulateTraining(training);
  const builtin = createRuntimeBank();
  return {
    heldOut, fixtures: held.map(({ fixture }) => fixture.name),
    trainedFrom: [...new Set(training.map(({ session }) => session))].sort(),
    trainingFixtures: training.map(({ fixture }) => fixture.name),
    samples: simulated.samples.length, refused: simulated.refused,
    builtin: scoreBank(held, builtin), personal: scoreBank(held, mergeTemplateBank(builtin, simulated.samples)),
  };
}

/** STRICT: each held-out session is scored with samples from OTHER sessions only. */
export function evaluateLeaveOneSessionOut(fixtures: readonly SessionFixture[]): FoldResult[] {
  return [...new Set(fixtures.map(({ session }) => session))].sort().map((session) =>
    fold(session, fixtures.filter((f) => f.session === session), fixtures.filter((f) => f.session !== session)));
}

/** OPTIMISTIC: leave one FIXTURE out, so other measures from the same sitting are
 * still training data. Shown only to expose how much same-session reuse inflates results.
 */
export function evaluateLeaveOneFixtureOut(fixtures: readonly SessionFixture[]): FoldResult[] {
  return fixtures.map((held) => fold(held.fixture.name, [held], fixtures.filter((f) => f !== held)));
}

export const sumScores = (folds: readonly FoldResult[], bank: 'builtin' | 'personal'): BankScore => ({
  primitives: folds.reduce((a, f) => ({ total: a.total + f[bank].primitives.total, exact: a.exact + f[bank].primitives.exact,
    wrongAccepts: a.wrongAccepts + f[bank].primitives.wrongAccepts, knownRejects: a.knownRejects + f[bank].primitives.knownRejects }),
  { total: 0, exact: 0, wrongAccepts: 0, knownRejects: 0 }),
  events: folds.reduce((a, f) => ({ expected: a.expected + f[bank].events.expected, proposedExactly: a.proposedExactly + f[bank].events.proposedExactly,
    wrongProposals: a.wrongProposals + f[bank].events.wrongProposals }), { expected: 0, proposedExactly: 0, wrongProposals: 0 }),
});

/** The pre-stated safety rule, not an accuracy target: personal samples must not
 * introduce a wrong accepted shape or a wrong proposed note that the built-in
 * bank did not already make. Per fold, so one fold cannot hide another.
 */
export function safetyViolations(folds: readonly FoldResult[]): string[] {
  return folds.flatMap((f) => [
    ...(f.personal.primitives.wrongAccepts > f.builtin.primitives.wrongAccepts
      ? [`${f.heldOut}: personal samples added wrong accepted shapes (${f.builtin.primitives.wrongAccepts} -> ${f.personal.primitives.wrongAccepts})`] : []),
    ...(f.personal.events.wrongProposals > f.builtin.events.wrongProposals
      ? [`${f.heldOut}: personal samples added wrong proposed notes (${f.builtin.events.wrongProposals} -> ${f.personal.events.wrongProposals})`] : []),
  ]);
}

const prim = (s: PrimitiveScore): string => `exact ${s.exact}/${s.total}, wrong accepts ${s.wrongAccepts}, known rejects ${s.knownRejects}`;
const evt = (s: EventScore): string => s.expected === 0 ? 'no scored notes' : `proposed ${s.proposedExactly}/${s.expected}, wrong proposals ${s.wrongProposals}`;

export function personalReport(strict: readonly FoldResult[], optimistic: readonly FoldResult[]): string {
  const lines = [
    'Personal templates — simulated training on recorded fixtures; oracle primitive groups and singleton review.',
    'Small, single-writer data. These numbers compare banks on the SAME held-out ink; they are not population accuracy.',
    'Samples obey the training screen rules. Development, evaluation, and synthetic fixtures are never used.',
    '',
    'STRICT leave-one-session-out (held-out session sees only OTHER sessions’ samples):',
  ];
  const block = (folds: readonly FoldResult[]): void => {
    for (const f of folds) {
      lines.push(`  ${f.heldOut} [${f.fixtures.join(', ')}] <- ${f.samples} samples from ${f.trainedFrom.join(', ') || 'none'}${f.refused.length ? `; ${f.refused.length} refused` : ''}`);
      for (const { sampleId, reason } of f.refused) lines.push(`    refused for training: ${sampleId} (${reason})`);
      lines.push(`    primitives  built-in: ${prim(f.builtin.primitives)}`);
      lines.push(`                personal: ${prim(f.personal.primitives)}`);
      lines.push(`    notes       built-in: ${evt(f.builtin.events)}`);
      lines.push(`                personal: ${evt(f.personal.events)}`);
    }
    const [b, p] = [sumScores(folds, 'builtin'), sumScores(folds, 'personal')];
    lines.push(`  TOTAL primitives  built-in: ${prim(b.primitives)}`, `                    personal: ${prim(p.primitives)}`,
      `  TOTAL notes       built-in: ${evt(b.events)}`, `                    personal: ${evt(p.events)}`);
  };
  block(strict);
  lines.push('', 'OPTIMISTIC leave-one-fixture-out (same-sitting measures still train; NOT held out; shown to expose reuse inflation):');
  block(optimistic);
  const violations = safetyViolations(strict);
  lines.push('', violations.length === 0 ? 'Safety rule (no added wrong accepts/proposals, strict folds): holds.' : `Safety rule VIOLATED:\n  ${violations.join('\n  ')}`);
  return lines.join('\n');
}
