import { toDocument } from '../staff/coordinates';
import type { Position, ViewTransform } from '../staff/coordinates';
import type { InkPoint } from './types';

export interface PointerSample {
  clientX: number;
  clientY: number;
  timeStamp: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
}

/** DOM-free shape supports recorded input and browsers without coalesced events. */
export interface SampleEvent extends PointerSample {
  getCoalescedEvents?: () => PointerSample[];
}

export function collectSamples(
  event: SampleEvent, canvasOrigin: Position, view: ViewTransform,
): InkPoint[] {
  const coalesced = event.getCoalescedEvents?.() ?? [];
  const samples = coalesced.length > 0 ? [...coalesced] : [event];
  // Some implementations omit the dispatched event's final position from the batch.
  const last = samples.at(-1);
  if (last && (last.clientX !== event.clientX || last.clientY !== event.clientY ||
      last.timeStamp !== event.timeStamp)) samples.push(event);
  return samples.map((sample) => ({
    ...toDocument({
      x: sample.clientX - canvasOrigin.x,
      y: sample.clientY - canvasOrigin.y,
    }, view),
    t: sample.timeStamp,
    pressure: sample.pressure,
    tiltX: sample.tiltX,
    tiltY: sample.tiltY,
  }));
}
