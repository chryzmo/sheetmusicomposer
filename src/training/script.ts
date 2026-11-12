import { config } from '../config';
import type { SimplePrimitive } from '../recognize/primitives';
import { userTemplateLabels } from '../recognize/user-templates';

/** One thing to draw. The label is the ground truth for the stroke, so nothing
 * has to be annotated afterwards. Hints vary what the user does, not what is
 * drawn: free sketching differs from careful copying in size, speed, direction,
 * slant, and where a shape sits on the staff, and training should cover that.
 */
export interface Prompt { readonly label: SimplePrimitive; readonly hint: string }

// Sizes are in staff spaces (the distance between two staff lines).
const hints: Readonly<Record<SimplePrimitive, readonly string[]>> = {
  noteheadFilled: [
    'About one staff space wide, centered on a line.',
    'About one staff space wide, centered in a space.',
    'Small and quick.',
    'Large and relaxed.',
    'Quick, as you would write it in the middle of a phrase.',
    'Just above the top line, as a high note would sit.',
    'Just below the bottom line, as a low note would sit.',
    'Neat and careful.',
  ],
  noteheadHollow: [
    'An open oval about one staff space wide, centered on a line.',
    'An open oval about one staff space wide, centered in a space.',
    'Small and quick.',
    'Large and relaxed.',
    'Quick, as you would write it in the middle of a phrase.',
    'Just above the top line, as a high note would sit.',
    'Just below the bottom line, as a low note would sit.',
    'Neat and careful.',
  ],
  stem: [
    'About three staff spaces tall, drawn from top to bottom.',
    'About three staff spaces tall, drawn from bottom to top.',
    'Short (about two spaces) and quick.',
    'Slightly slanted, as in fast writing.',
    'Long and relaxed (about four spaces).',
    'Medium height, quick, from bottom to top.',
    'Medium height, neat and careful.',
    'About three spaces, as if beside a notehead on a line.',
  ],
};

/** A rotation through the shapes (filled, hollow, stem, ...) so the hand switches
 * between them as it does when writing music. `round` shifts which hint each
 * shape starts on, so a later round does not repeat the first one.
 */
export function buildScript(perShape: number, round = 0): Prompt[] {
  if (!Number.isInteger(perShape) || perShape < 1 || perShape > config.maxUserTemplatesPerLabel) throw new RangeError('Invalid prompts per shape');
  const script: Prompt[] = [];
  for (let i = 0; i < perShape; i++) {
    for (const label of userTemplateLabels) {
      const list = hints[label];
      script.push({ label, hint: list[(i + round * 3) % list.length]! });
    }
  }
  return script;
}

/** Index of the first prompt at or after `from` whose shape still has room, or
 * null when the script is finished (or every shape is at its limit).
 */
export function nextPrompt(script: readonly Prompt[], from: number, counts: Readonly<Record<SimplePrimitive, number>>): number | null {
  for (let i = Math.max(0, from); i < script.length; i++) {
    if (counts[script[i]!.label] < config.maxUserTemplatesPerLabel) return i;
  }
  return null;
}

/** How many prompts for `label` this script has at or before `index`, and in total. */
export function shapeProgress(script: readonly Prompt[], index: number, label: SimplePrimitive): { current: number; total: number } {
  const all = script.map((p, i) => ({ p, i })).filter(({ p }) => p.label === label);
  return { current: all.filter(({ i }) => i <= index).length, total: all.length };
}
