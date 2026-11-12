import { config } from '../config';
import type { SketchDocument } from '../model/document';
import { accidentals, durations, isPitch, timeSignatures } from '../model/music';
import type { NoteEvent, RestEvent, TimeSignature } from '../model/music';
import { decodeSketch, object } from '../store/schema';
import { primitiveLabels } from '../recognize/primitives';
import type { PrimitiveLabel } from '../recognize/primitives';

export interface ExpectedPrimitive {
  readonly label: PrimitiveLabel;
  readonly strokeIds: readonly string[];
}
/** Manual ground truth has musical event fields but no inferred confidence/ID. */
export type ExpectedEvent = Omit<NoteEvent, 'id' | 'confidence'> | Omit<RestEvent, 'id' | 'confidence'>;
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
    readonly timeSignature: TimeSignature;
  };
  /** Fixtures retain their v1 ink-only shape; model music is never ground truth. */
  readonly document: Pick<SketchDocument, 'strokes'>;
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
    if (!isPitch(pitch)) throw new Error('Invalid pitch; expected a written note from C0 through B9');
    const accidental = entry.accidental === null ? null : choice(entry.accidental, accidentals, 'accidental');
    return { ...base, kind: 'note', pitch: { step: pitch.step, octave: pitch.octave }, accidental };
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
