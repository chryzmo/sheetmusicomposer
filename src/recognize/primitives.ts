/** Recognition vocabulary shared with fixture ground truth. */
export const primitiveLabels = ['noteheadFilled', 'noteheadHollow', 'stem', 'flag', 'beam', 'restBlock', 'restHook', 'quarterRest', 'dot', 'sharp', 'flat', 'natural', 'unknown'] as const;
export type PrimitiveLabel = typeof primitiveLabels[number];
export type SimplePrimitive = Extract<PrimitiveLabel, 'noteheadFilled' | 'noteheadHollow' | 'stem'>;
