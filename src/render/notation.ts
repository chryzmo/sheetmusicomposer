import { Annotation, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura';
import type { TimeSignature } from '../model/music';
import type { ReviewCandidate } from '../recognize/review';
import { notationSpec } from './notation-model';

// The /bravura entry embeds Bravura + Academico data fonts. Do NOT call
// VexFlow.loadFonts(), which would fetch from an external font CDN.
export const notationReady = Promise.all(['Bravura', 'Academico'].map(async (family) => {
  const faces = await document.fonts.load(`20px "${family}"`);
  if (faces.length === 0 || faces.some((face) => face.status !== 'loaded')) throw new Error(`Local notation font ${family} unavailable`);
}));

/** DOM-only, read-only proposed notation, deliberately BESIDE original ink.
 * SOFT voice supports partial/overfull proposals without invented rests. Labels
 * map to checkboxes, not raw horizontal spacing. Caller awaits local fonts and
 * checks its generation again before drawing. No model/ink mutation.
 */
export function drawNotation(host: HTMLDivElement, candidates: readonly ReviewCandidate[], signature: TimeSignature): void {
  host.replaceChildren();
  const width = Math.max(460, 150 + candidates.length * 100);
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, 180);
  const context = renderer.getContext();
  const stave = new Stave(10, 40, width - 20).addClef('treble').addTimeSignature(signature);
  stave.setContext(context).draw();
  const notes = candidates.map(({ note }, index) => {
    const n = new StaveNote(notationSpec(note));
    n.addModifier(new Annotation(String(index + 1)).setFont('Arial', 12).setVerticalJustification(Annotation.VerticalJustify.TOP), 0);
    return n;
  });
  if (notes.length) {
    const voice = new Voice(signature).setMode(Voice.Mode.SOFT).addTickables(notes);
    new Formatter().joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(context, stave);
  }
  const svg = host.querySelector('svg');
  if (!svg) throw new Error('Notation SVG unavailable');
  // Include extreme ledger notes/stems/annotations, not just the nominal staff.
  const bounds = svg.getBBox(), top = Math.min(0, bounds.y - 16), bottom = Math.max(180, bounds.y + bounds.height + 16);
  svg.setAttribute('viewBox', `0 ${top} ${width} ${bottom - top}`);
  svg.setAttribute('height', String(bottom - top));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Proposed notation: all ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}, numbered to match the checkboxes`);
}
