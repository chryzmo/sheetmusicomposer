import type { InkPoint, Stroke } from './types';

export interface InkState {
  active: { pointerId: number; stroke: { id: string; points: InkPoint[] } } | null;
}

export function createInkState(): InkState {
  return { active: null };
}

/** Explicit mutable collector: append samples without copying the whole stroke per move. */
export function beginStroke(
  state: InkState, pointerType: string, pointerId: number, id: string, points: InkPoint[],
): boolean {
  if (pointerType !== 'pen' || state.active || points.length === 0) return false;
  state.active = { pointerId, stroke: { id, points: [...points] } };
  return true;
}

export function appendPoints(state: InkState, pointerId: number, points: InkPoint[]): boolean {
  if (!state.active || state.active.pointerId !== pointerId) return false;
  for (const point of points) state.active.stroke.points.push(point);
  return true;
}

/** Detach captured ink; the coordinator commits it to the document via a command. */
export function finishStroke(
  state: InkState, pointerId: number, completion: Stroke['completion'],
): Stroke | null {
  if (!state.active || state.active.pointerId !== pointerId) return null;
  const stroke: Stroke = { ...state.active.stroke, completion };
  state.active = null;
  return stroke;
}
