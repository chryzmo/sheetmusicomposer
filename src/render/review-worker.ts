import { config } from '../config';
import { prepareMusicReview } from '../recognize/review';
import { createRuntimeBank } from '../recognize/runtime-bank';
import { mergeTemplateBank } from '../recognize/user-templates';
import type { ReviewRequest, ReviewResponse } from './review-protocol';

// No DOM/font rendering or event IDs in this worker. Recognition is opt-in and
// off the ink-render thread; cancellation terminates the worker outright.
self.addEventListener('message', (event: MessageEvent<ReviewRequest>) => {
  const { token, document, samples } = event.data;
  let response: ReviewResponse;
  try {
    // Fail closed: a personal-template problem is reported, never silently dropped
    // (which would quietly review with a different bank than the user expects).
    let bank;
    try { bank = mergeTemplateBank(createRuntimeBank(), samples); }
    catch (error) { throw new Error(`personal templates could not be used (${error instanceof Error ? error.message : String(error)}); open Personal templates to delete damaged samples`, { cause: error }); }
    const result = prepareMusicReview(document, bank);
    if (result.candidates.length > config.reviewMaxDisplayNotes) throw new Error(`Too many proposals for this preview (limit ${config.reviewMaxDisplayNotes}). No proposals were truncated.`);
    response = { token, kind: 'ready', review: { bankId: result.bankId, userSampleCount: result.userSampleCount, grouping: result.grouping,
      supportPolicy: result.supportPolicy, classifications: result.classifications, assembly: result.assembly, candidates: result.candidates } };
  } catch (error) {
    response = { token, kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
});
