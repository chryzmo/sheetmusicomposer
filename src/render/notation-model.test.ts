import { expect, it } from 'vitest';
import { pitchSteps } from '../model/music';
import { notationSpec, reviewDuration, reviewDurationMessage } from './notation-model';

it.each([['whole', 'w'], ['half', 'h'], ['quarter', 'q']] as const)('maps %s to explicit VexFlow duration %s', (duration, expected) => {
  expect(notationSpec({ pitch: { step: 'E', octave: 4 }, duration })).toEqual({ clef: 'treble', keys: ['e/4'], duration: expected, autoStem: true });
});
it('maps every supported written pitch C0–B9 without transposition or clamping', () => {
  for (let octave = 0; octave <= 9; octave++) for (const step of pitchSteps) {
    expect(notationSpec({ pitch: { step, octave }, duration: 'quarter' }).keys).toEqual([`${step.toLowerCase()}/${octave}`]);
  }
});
it.each([['4/4', 4], ['3/4', 3], ['2/4', 2], ['6/8', 3]] as const)('shows %s capacity in quarter-note units, not metrical beat claims', (signature, target) => {
  expect(reviewDuration(['half', 'quarter'], signature)).toEqual({ units: 3, target });
});
it('counts partial/empty/overfull selections without inventing rests or fixing durations', () => {
  expect(reviewDuration([], '4/4')).toEqual({ units: 0, target: 4 });
  expect(reviewDuration(['whole'], '4/4')).toEqual({ units: 4, target: 4 });
  expect(reviewDuration(['whole', 'quarter'], '4/4')).toEqual({ units: 5, target: 4 });
});
it('words empty, underfull, matching, and overfull totals distinctly', () => {
  expect(reviewDurationMessage(0, 4, '4/4')).toEqual({ state: 'empty', text: 'No notes selected. A 4/4 measure holds 4 quarter-note units.' });
  expect(reviewDurationMessage(2, 3, '6/8')).toEqual({ state: 'under', text: 'Underfull: 2 of 3 quarter-note units in 6/8; 1 quarter-note unit short. No rests or durations are added automatically.' });
  expect(reviewDurationMessage(3, 3, '3/4')).toEqual({ state: 'match', text: 'Total matches: 3 quarter-note units in 3/4. This does not prove the notes are correct.' });
  expect(reviewDurationMessage(5, 4, '4/4')).toEqual({ state: 'over', text: 'Overfull: 5 quarter-note units selected but a 4/4 measure holds 4; 1 quarter-note unit over. Durations are not repaired automatically.' });
  expect(reviewDurationMessage(6, 2, '2/4').text).toContain('4 quarter-note units over');
});
