export interface InkPoint {
  /** Position in document staff spaces, not screen pixels. */
  readonly x: number;
  readonly y: number;
  /** Pointer event timestamp in milliseconds. */
  readonly t: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
}

export interface Stroke {
  readonly id: string;
  readonly points: readonly InkPoint[];
  /** Interrupted strokes preserve all samples received before interruption. */
  readonly completion: 'complete' | 'interrupted';
}
