import { config } from '../config';
import { prepareMusicReview } from '../recognize/review';
import { createRuntimeBank } from '../recognize/runtime-bank';
import type { ReviewRequest, ReviewResponse } from './review-protocol';

// No DOM/font rendering or event IDs in this worker. Recognition is opt-in and
// off the ink-render thread; cancellation terminates the worker outright.
self.addEventListener('message', (event: MessageEvent<ReviewRequest>) => {
  const { token, document } = event.data;
  let response: ReviewResponse;
  try {
    const result = prepareMusicReview(document, createRuntimeBank());
    if (result.candidates.length > config.reviewMaxDisplayNotes) throw new Error(`Too many proposals for this preview (limit ${config.reviewMaxDisplayNotes}). No proposals were truncated.`);
    response = { token, kind: 'ready', review: { bankId: result.bankId, grouping: result.grouping,
      supportPolicy: result.supportPolicy, classifications: result.classifications, assembly: result.assembly, candidates: result.candidates } };
  } catch (error) {
    response = { token, kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
});
