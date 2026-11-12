import { expect, it } from 'vitest';
import { config } from '../config';
import { buildScript, nextPrompt, shapeProgress } from './script';

const empty = { noteheadFilled: 0, noteheadHollow: 0, stem: 0 } as const;

it('rotates through the three shapes so the hand switches as it does when writing', () => {
  const script = buildScript(8);
  expect(script).toHaveLength(24);
  expect(script.slice(0, 6).map(({ label }) => label)).toEqual(['noteheadFilled', 'noteheadHollow', 'stem', 'noteheadFilled', 'noteheadHollow', 'stem']);
  for (const label of ['noteheadFilled', 'noteheadHollow', 'stem'] as const) expect(script.filter((p) => p.label === label)).toHaveLength(8);
});

it('varies the hint within a round so each shape is drawn in different ways', () => {
  const script = buildScript(8);
  for (const label of ['noteheadFilled', 'noteheadHollow', 'stem'] as const) {
    const used = script.filter((p) => p.label === label).map((p) => p.hint);
    expect(new Set(used).size).toBe(used.length);
  }
  // Coverage that matters for free sketching: size, speed, position above/below the staff, direction, slant.
  const all = script.map((p) => p.hint).join(' ').toLowerCase();
  for (const word of ['small', 'large', 'quick', 'above', 'below', 'top to bottom', 'bottom to top', 'slanted']) expect(all).toContain(word);
});

it('shifts the hints in a later round instead of repeating the first one', () => {
  const first = buildScript(8, 0), second = buildScript(8, 1);
  expect(second.map((p) => p.label)).toEqual(first.map((p) => p.label));
  expect(second.slice(0, 3).map((p) => p.hint)).not.toEqual(first.slice(0, 3).map((p) => p.hint));
});

it('rejects an unusable prompt count', () => {
  for (const bad of [0, -1, 1.5, config.maxUserTemplatesPerLabel + 1]) expect(() => buildScript(bad)).toThrow('Invalid prompts per shape');
  expect(buildScript(1)).toHaveLength(3);
});

it('skips prompts for a shape that is at its limit, and ends when none remain', () => {
  const script = buildScript(2);
  expect(nextPrompt(script, 0, empty)).toBe(0);
  const hollowFull = { ...empty, noteheadHollow: config.maxUserTemplatesPerLabel };
  expect(nextPrompt(script, 1, hollowFull)).toBe(2);
  expect(nextPrompt(script, 4, hollowFull)).toBe(5);
  const allFull = { noteheadFilled: config.maxUserTemplatesPerLabel, noteheadHollow: config.maxUserTemplatesPerLabel, stem: config.maxUserTemplatesPerLabel };
  expect(nextPrompt(script, 0, allFull)).toBeNull();
  expect(nextPrompt(script, script.length, empty)).toBeNull();
});

it('reports per-shape progress within the round', () => {
  const script = buildScript(4);
  expect(shapeProgress(script, 0, 'noteheadFilled')).toEqual({ current: 1, total: 4 });
  expect(shapeProgress(script, 4, 'noteheadHollow')).toEqual({ current: 2, total: 4 });
  expect(shapeProgress(script, 11, 'stem')).toEqual({ current: 4, total: 4 });
});
