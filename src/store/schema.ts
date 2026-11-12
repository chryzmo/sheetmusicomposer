import { config } from '../config';
import type { InkPoint, Stroke } from '../ink/types';
import type { SketchDocument } from '../model/document';
import { decodeMeasures } from '../model/validate-music';

export interface SketchFile {
  readonly format: 'sheetmusicomposer';
  readonly version: 1 | 2;
  readonly document: SketchDocument;
}

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

function finite(value: unknown, name: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export function sketchFile(document: SketchDocument): SketchFile {
  return { format: 'sheetmusicomposer', version: document.measures === undefined ? 1 : 2, document };
}

/** Explicit v1 compatibility: keep ink-only documents ink-only, with unchanged
 * sample values/order. V2 adds validated measures; never silently strip music
 * from a v1 envelope or downgrade an unknown version to empty ink.
 */
export function decodeSketch(value: unknown): SketchDocument {
  const file = object(value);
  if (file.format !== 'sheetmusicomposer') throw new Error('Not a Sheet Music Composer backup');
  if (file.version !== 1 && file.version !== 2) throw new Error('Unsupported sketch version; use a compatible app version');
  const document = object(file.document);
  if (file.version === 1 && document.measures !== undefined) throw new Error('Musical measures require sketch version 2');
  const raw = document.strokes;
  if (!Array.isArray(raw) || raw.length > config.maxStoredStrokes) throw new Error('Invalid stroke list or too many strokes');
  const ids = new Set<string>();
  let count = 0;
  const strokes: Stroke[] = raw.map((value: unknown) => {
    const stroke = object(value);
    if (typeof stroke.id !== 'string' || stroke.id.length === 0 || ids.has(stroke.id)) throw new Error('Invalid or duplicate stroke ID');
    ids.add(stroke.id);
    if (stroke.completion !== 'complete' && stroke.completion !== 'interrupted') throw new Error('Invalid stroke completion');
    if (!Array.isArray(stroke.points) || stroke.points.length === 0) throw new Error('Stroke has no points');
    count += stroke.points.length;
    if (count > config.maxStoredPoints) throw new Error('Too many ink points');
    const points: InkPoint[] = stroke.points.map((value: unknown) => {
      const point = object(value);
      // Preserve raw event times, including zero and decreases. Coalesced
      // samples and their dispatched parent need not share timestamp ordering;
      // collectSamples can append the parent after later-timestamped samples.
      // Sorting/clamping here would alter the captured ink rather than validate it.
      const t = finite(point.t, 'timestamp', 0);
      return {
        x: finite(point.x, 'x'), y: finite(point.y, 'y'), t,
        pressure: finite(point.pressure, 'pressure', 0, 1),
        tiltX: finite(point.tiltX, 'tiltX', -90, 90),
        tiltY: finite(point.tiltY, 'tiltY', -90, 90),
      };
    });
    return { id: stroke.id, completion: stroke.completion, points };
  });
  return file.version === 1 ? { strokes } : { strokes, measures: decodeMeasures(document.measures, strokes) };
}

export function parseBackup(text: string): SketchDocument {
  if (new TextEncoder().encode(text).byteLength > config.maxBackupBytes) throw new Error('Backup exceeds the 10 MiB import limit');
  const value: unknown = JSON.parse(text);
  return decodeSketch(value);
}

export function serializeBackup(document: SketchDocument): string {
  return JSON.stringify(sketchFile(document));
}
