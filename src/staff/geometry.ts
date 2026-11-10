export interface StaffLine {
  x1: number;
  x2: number;
  y: number;
}

/** Five staff lines in staff-space coordinates; pixel scaling belongs to the view. */
export function staffLines(width: number): StaffLine[] {
  if (!Number.isFinite(width) || width <= 0) {
    throw new RangeError('Staff width must be finite and positive');
  }
  return Array.from({ length: 5 }, (_, y) => ({ x1: 0, x2: width, y }));
}
