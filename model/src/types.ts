import type { PlRef } from "@platforma-sdk/model";

/** Args passed to the workflow — output shape of `.args(...)`. */
export type BlockArgs = {
  inputRef: PlRef;
};

/** Unified V3 data model: block args plus UI state in one object. */
export type BlockData = {
  inputRef?: PlRef;
};
