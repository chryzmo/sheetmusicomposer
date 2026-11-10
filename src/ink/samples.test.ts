import { describe, expect, it } from 'vitest';
import { collectSamples } from './samples';
import type { SampleEvent } from './samples';

const event: SampleEvent = {
  clientX: 90, clientY: 150, timeStamp: 100, pressure: 0.7, tiltX: 15, tiltY: -20,
};
const origin = { x: 10, y: 20 };
const view = { offsetX: 40, offsetY: 100, pixelsPerSpace: 20 };

describe('pointer sample conversion', () => {
  it('falls back without getCoalescedEvents and preserves metadata', () => {
    expect(collectSamples(event, origin, view)).toEqual([
      { x: 2, y: 1.5, t: 100, pressure: 0.7, tiltX: 15, tiltY: -20 },
    ]);
  });
  it('falls back for an empty coalesced list', () => {
    expect(collectSamples({ ...event, getCoalescedEvents: () => [] }, origin, view)).toHaveLength(1);
  });
  it('keeps ordered coalesced samples without duplicating the last position', () => {
    const points = collectSamples({ ...event, getCoalescedEvents: () => [
      { ...event, clientX: 70, timeStamp: 90, pressure: 0.2 }, event,
    ] }, origin, view);
    expect(points.map((point) => point.x)).toEqual([1, 2]);
    expect(points.map((point) => point.pressure)).toEqual([0.2, 0.7]);
  });
  it('preserves later coalesced timestamps followed by the earlier parent without sorting', () => {
    const points = collectSamples({ ...event, getCoalescedEvents: () => [
      { ...event, clientX: 70, timeStamp: 110 },
      { ...event, clientX: 80, timeStamp: 120 },
    ] }, origin, view);
    expect(points.map((point) => point.t)).toEqual([110, 120, 100]);
    expect(points.map((point) => point.x)).toEqual([1, 1.5, 2]);
  });
  it('includes the dispatched endpoint when omitted from coalesced samples', () => {
    const points = collectSamples({ ...event, getCoalescedEvents: () => [
      { ...event, clientX: 70, timeStamp: 90 },
    ] }, origin, view);
    expect(points.map((point) => point.t)).toEqual([90, 100]);
  });
});
