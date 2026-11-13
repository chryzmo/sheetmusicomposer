import type { Duration, Measure, MusicEvent } from '../model/music';

/** MusicXML time units per quarter note. 16 makes a double-dotted sixteenth
 * (7/16 of a quarter) a whole number, so no rounding is ever needed.
 */
const divisions = 16;

const quarterUnits: Record<Duration, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };
const typeNames: Record<Duration, string> = { whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', sixteenth: '16th' };
const alters = { sharp: 1, flat: -1, natural: 0 } as const;

/** Length of an event in MusicXML divisions: each dot adds half the previous value. */
export function eventDivisions(event: Pick<MusicEvent, 'duration' | 'dots'>): number {
  const base = quarterUnits[event.duration] * divisions;
  return base * (2 - 0.5 ** event.dots);
}

function measureDivisions(signature: Measure['timeSignature']): number {
  const [beats, beatType] = signature.split('/').map(Number);
  return beats! * (4 / beatType!) * divisions;
}

function eventXml(event: MusicEvent): string {
  const timing = `<duration>${eventDivisions(event)}</duration><type>${typeNames[event.duration]}</type>${'<dot/>'.repeat(event.dots)}`;
  if (event.kind === 'rest') return `<note><rest/>${timing}</note>`;
  const { step, octave } = event.pitch;
  const alter = event.accidental === null ? '' : `<alter>${alters[event.accidental]}</alter>`;
  const written = event.accidental === null ? '' : `<accidental>${event.accidental}</accidental>`;
  // Element order follows the MusicXML schema: pitch, duration, type, dot, accidental.
  return `<note><pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch>${timing}${written}</note>`;
}

/** MusicXML 4.0 score-partwise for one treble staff and one voice. Measures are
 * written as kept, even if they do not add up to the time signature, because a
 * sketch export should not refuse or silently repair. An empty measure becomes a
 * whole-measure rest. Ink that was never read as music is not exported.
 */
export function measuresToMusicXml(measures: readonly Measure[], title = 'Sketch'): string {
  const parts = measures.map((measure, index) => {
    const [beats, beatType] = measure.timeSignature.split('/');
    const attributes = index === 0
      ? `<attributes><divisions>${divisions}</divisions><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
      : '';
    const body = measure.events.length === 0
      ? `<note><rest measure="yes"/><duration>${measureDivisions(measure.timeSignature)}</duration></note>`
      : measure.events.map(eventXml).join('');
    return `<measure number="${index + 1}">${attributes}${body}</measure>`;
  });
  const escaped = title.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${escaped}</work-title></work><part-list><score-part id="P1"><part-name>Staff</part-name></score-part></part-list><part id="P1">${parts.join('')}</part></score-partwise>\n`;
}
