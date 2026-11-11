import { config } from '../config';
import type { SketchDocument } from '../model/document';
import { decodeSketch, object } from '../store/schema';

export const primitiveLabels = ['noteheadFilled', 'noteheadHollow', 'stem', 'flag', 'beam', 'restBlock', 'restHook', 'quarterRest', 'dot', 'sharp', 'flat', 'natural', 'unknown'] as const;
export const durations = ['whole', 'half', 'quarter', 'eighth', 'sixteenth'] as const;
export const timeSignatures = ['4/4', '3/4', '2/4', '6/8'] as const;
export const accidentals = ['sharp', 'flat', 'natural'] as const;
export const pitchSteps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type PrimitiveLabel = typeof primitiveLabels[number];
export interface ExpectedPrimitive {
  readonly label: PrimitiveLabel;
  readonly strokeIds: readonly string[];
}
interface ExpectedEventBase {
  readonly duration: typeof durations[number];
  readonly dots: number;
  readonly strokeIds: readonly string[];
}
export type ExpectedEvent = ExpectedEventBase & (
  { readonly kind: 'rest' } |
  { readonly kind: 'note'; readonly pitch: { readonly step: typeof pitchSteps[number]; readonly octave: number }; readonly accidental: typeof accidentals[number] | null }
);
export interface InkFixture {
  readonly format: 'sheetmusicomposer-fixture';
  readonly version: 1;
  readonly name: string;
  readonly set: string;
  readonly notes: string;
  readonly provenance: 'recorded' | 'synthetic';
  readonly staff: {
    readonly units: 'staff-space';
    readonly lineYs: readonly [0, 1, 2, 3, 4];
    readonly width: number;
    readonly clef: 'treble';
    readonly timeSignature: typeof timeSignatures[number];
  };
  readonly document: SketchDocument;
  readonly expected: { readonly primitives: readonly ExpectedPrimitive[]; readonly events: readonly ExpectedEvent[] };
}

function choice<const T extends readonly string[]>(value: unknown, choices: T, name: string): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`Invalid ${name}`);
  return value as T[number];
}
function text(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > config.maxFixtureTextLength) throw new Error(`Invalid ${name}`);
  return value;
}

/** DOM-free fixture decoder. All raw samples retain their original order/values. */
export function decodeFixture(value: unknown): InkFixture {
  const file = object(value);
  if (file.format !== 'sheetmusicomposer-fixture' || file.version !== 1) throw new Error('Unsupported fixture format or version');
  const document = decodeSketch({ format: 'sheetmusicomposer', version: 1, document: file.document });
  if (document.strokes.length === 0) throw new Error('A fixture needs ink');
  const known = new Set(document.strokes.map((stroke) => stroke.id));
  const covered = new Set<string>();
  const staff = object(file.staff);
  if (staff.units !== 'staff-space' || staff.clef !== 'treble' ||
      !Array.isArray(staff.lineYs) || staff.lineYs.length !== 5 || staff.lineYs.some((y: unknown, index: number) => y !== index) ||
      typeof staff.width !== 'number' || !Number.isFinite(staff.width) || staff.width <= 0) throw new Error('Invalid staff geometry');
  const expected = object(file.expected);
  function decodeList<T>(raw: unknown, decode: (entry: Record<string, unknown>, strokeIds: string[]) => T): T[] {
    if (!Array.isArray(raw) || raw.length > document.strokes.length) throw new Error('Invalid expected result list');
    const used = new Set<string>();
    return raw.map((value: unknown) => {
      const entry = object(value);
      if (!Array.isArray(entry.strokeIds) || entry.strokeIds.length === 0) throw new Error('Expected result needs stroke IDs');
      const strokeIds = entry.strokeIds.map((id: unknown) => {
        if (typeof id !== 'string' || !known.has(id) || used.has(id)) throw new Error('Unknown or repeated expected stroke ID');
        used.add(id);
        covered.add(id);
        return id;
      });
      return decode(entry, strokeIds);
    });
  }
  const primitives = decodeList<ExpectedPrimitive>(expected.primitives, (entry, strokeIds) => ({
    label: choice(entry.label, primitiveLabels, 'primitive label'), strokeIds,
  }));
  const events = decodeList<ExpectedEvent>(expected.events, (entry, strokeIds) => {
    const duration = choice(entry.duration, durations, 'duration');
    if (typeof entry.dots !== 'number' || !Number.isInteger(entry.dots) || entry.dots < 0 || entry.dots > config.maxFixtureDots) throw new Error('Invalid dots');
    const base = { duration, dots: entry.dots, strokeIds };
    if (entry.kind === 'rest') {
      if ('pitch' in entry || 'accidental' in entry) throw new Error('Rest must not have pitch or accidental');
      return { ...base, kind: 'rest' };
    }
    if (entry.kind !== 'note') throw new Error('Invalid event kind');
    const pitch = object(entry.pitch);
    const step = choice(pitch.step, pitchSteps, 'pitch step');
    if (typeof pitch.octave !== 'number' || !Number.isInteger(pitch.octave) || pitch.octave < 0 || pitch.octave > 9) throw new Error('Invalid pitch octave');
    const accidental = entry.accidental === null ? null : choice(entry.accidental, accidentals, 'accidental');
    return { ...base, kind: 'note', pitch: { step, octave: pitch.octave }, accidental };
  });
  if (covered.size !== known.size) throw new Error('Label every stroke, using unknown for unsupported or ambiguous ink');
  return {
    format: 'sheetmusicomposer-fixture', version: 1,
    name: text(file.name, 'fixture name'), set: text(file.set, 'fixture set'), notes: text(file.notes, 'notes', true),
    provenance: choice(file.provenance, ['recorded', 'synthetic'], 'provenance'),
    staff: { units: 'staff-space', lineYs: [0, 1, 2, 3, 4], width: staff.width, clef: 'treble', timeSignature: choice(staff.timeSignature, timeSignatures, 'time signature') },
    document, expected: { primitives, events },
  };
}

export function parseFixture(text: string): InkFixture {
  if (new TextEncoder().encode(text).byteLength > config.maxBackupBytes) throw new Error('Fixture exceeds the 10 MiB import limit');
  const value: unknown = JSON.parse(text);
  return decodeFixture(value);
}

export function serializeFixture(value: unknown): string {
  const result = JSON.stringify(decodeFixture(value), null, 2);
  // Never create a fixture that the test loader cannot read back.
  if (new TextEncoder().encode(result).byteLength > config.maxBackupBytes) throw new Error('Fixture exceeds the 10 MiB import limit; record a smaller measure');
  return result;
}
