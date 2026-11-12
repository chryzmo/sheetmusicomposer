import type { SketchDocument } from '../model/document';
import type { MusicReview } from '../recognize/review';

/** Private same-origin worker protocol; document is validated committed state.
 * Never echo a cloned base back and mistake it for main-thread identity.
 */
export interface ReviewRequest { readonly token: number; readonly document: SketchDocument }
export type ReviewResponse = { readonly token: number } & (
  | { readonly kind: 'ready'; readonly review: Omit<MusicReview, 'base'> }
  | { readonly kind: 'error'; readonly message: string }
);
