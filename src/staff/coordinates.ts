export interface Position {
  x: number;
  y: number;
}

/** Document coordinates are staff spaces; view coordinates are canvas-local CSS pixels. */
export interface ViewTransform {
  offsetX: number;
  offsetY: number;
  pixelsPerSpace: number;
}

function validateView(view: ViewTransform): void {
  if (!Number.isFinite(view.pixelsPerSpace) || view.pixelsPerSpace <= 0 ||
      !Number.isFinite(view.offsetX) || !Number.isFinite(view.offsetY)) {
    throw new RangeError('View transform must be finite with a positive scale');
  }
}

export function toDocument(point: Position, view: ViewTransform): Position {
  validateView(view);
  return {
    x: (point.x - view.offsetX) / view.pixelsPerSpace,
    y: (point.y - view.offsetY) / view.pixelsPerSpace,
  };
}

export function toView(point: Position, view: ViewTransform): Position {
  validateView(view);
  return {
    x: point.x * view.pixelsPerSpace + view.offsetX,
    y: point.y * view.pixelsPerSpace + view.offsetY,
  };
}
