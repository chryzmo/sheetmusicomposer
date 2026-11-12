import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseFixture } from '../fixtures/schema';
import type { Stroke } from '../ink/types';
import { labelNames, sampleProblem } from './validate';

// Real Pencil strokes (mechanics only): stroke 1 is a filled head, stroke 2 its stem.
const fixture = parseFixture(readFileSync(new URL('../../fixtures/recorded/sample-fail.json', import.meta.url), 'utf8'));
const [head, stem] = fixture.document.strokes as [Stroke, Stroke];
const dot: Stroke = { ...head, id: 'dot', points: [head.points[0]!, { ...head.points[0]!, x: head.points[0]!.x + 0.02 }] };

it('accepts a stroke that passes its own label\'s gates', () => {
  expect(sampleProblem(stem, 'stem')).toBe('');
  expect(sampleProblem(head, 'noteheadFilled')).toBe('');
});

it('explains in plain words why a stroke cannot be a sample', () => {
  expect(sampleProblem(dot, 'noteheadFilled')).toMatch(/^Not saved: Too small or too large for a notehead\./);
  expect(sampleProblem(head, 'stem')).toMatch(/^Not saved: .*stem/);
  expect(sampleProblem({ ...head, completion: 'interrupted' }, 'noteheadFilled')).toBe('Not saved: this stroke was interrupted. Draw it again.');
});

it('names every supported shape', () => {
  expect(Object.values(labelNames)).toEqual(['Filled notehead', 'Hollow notehead', 'Stem']);
});
