import { config } from '../config';
import type { Position, ViewTransform } from '../staff/coordinates';
import { toDocument } from '../staff/coordinates';

interface Contact {
  position: Position;
  suppressed: boolean;
}

export interface NavigationState {
  contacts: Map<number, Contact>;
}

export function createNavigationState(): NavigationState {
  return { contacts: new Map() };
}

export function startTouch(
  state: NavigationState, id: number, position: Position, penActive: boolean,
): void {
  state.contacts.set(id, { position, suppressed: penActive });
}

/** Keep palm contacts suppressed until lifted, even between Pencil strokes.
 * This is a conservative gesture policy, not hardware palm classification.
 */
export function suppressTouches(state: NavigationState): void {
  for (const contact of state.contacts.values()) contact.suppressed = true;
}

export function endTouch(state: NavigationState, id: number): void {
  state.contacts.delete(id);
}

function midpoint(a: Position, b: Position): Position {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function moveTouch(
  state: NavigationState, id: number, position: Position, view: ViewTransform,
): ViewTransform {
  const contact = state.contacts.get(id);
  if (!contact) return view;
  // Ignore additional fingers until one of the first two is lifted. Never use
  // contact size as a guess at palm identity; that varies between devices.
  const active = [...state.contacts.values()].filter((item) => !item.suppressed).slice(0, 2);
  const first = active[0];
  const second = active[1];
  const before = first && second ? midpoint(first.position, second.position) : first?.position;
  const distance = first && second
    ? Math.hypot(first.position.x - second.position.x, first.position.y - second.position.y) : 0;
  contact.position = position;
  if (contact.suppressed || !active.includes(contact) || !first || !before) return view;
  const after = second ? midpoint(first.position, second.position) : first.position;
  const nextDistance = second
    ? Math.hypot(first.position.x - second.position.x, first.position.y - second.position.y) : 0;
  const scale = distance > 0 && nextDistance > 0
    ? Math.min(config.maxSpaceSize, Math.max(config.minSpaceSize, view.pixelsPerSpace * nextDistance / distance))
    : view.pixelsPerSpace;
  const anchor = toDocument(before, view);
  return {
    pixelsPerSpace: scale,
    offsetX: after.x - anchor.x * scale,
    offsetY: after.y - anchor.y * scale,
  };
}
