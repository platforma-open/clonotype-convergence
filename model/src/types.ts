import type { PlRef } from "@platforma-sdk/model";

/** Args passed to the workflow — output shape of `.args(...)`. */
export type BlockArgs = {
  inputRef: PlRef;
  /** Heavy-chain threshold (Nb_freq cutoff). Per R16 default is 0.000961. */
  threshold: number;
  /** Sample-size floor (R12). Default 100. */
  nMin: number;
};

/** Unified V3 data model: block args plus UI state in one object. */
export type BlockData = {
  inputRef?: PlRef;
  threshold?: number;
  nMin?: number;
};
