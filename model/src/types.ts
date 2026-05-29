import type { PlDataTableStateV2, PlRef } from "@platforma-sdk/model";

/**
 * Facts about the picked upstream input ref, snapshotted into BlockData
 * at user-gesture time (R7, R8). The args lambda validates from this
 * snapshot — never from ctx.resultPool — because args lambdas are
 * `data`-only (model.md: snapshot pattern).
 *
 * `chains` carries the verbatim VDJ chain values from MiXCR (e.g. "IGH",
 * "IGK", "IGL", "TRA"). The presence flags are aggregate across all
 * detected BCR chains — Phase 7 may refine to per-chain flags when the
 * light-chain picker lands.
 */
export type UpstreamFacts = {
  chains: string[];
  hasAaCDR3: boolean;
  hasNtCDR3: boolean;
  hasAbundance: boolean;
};

/** Args passed to the workflow — output shape of `.args(...)`. */
export type BlockArgs = {
  inputRef: PlRef;
  inputDerivedFacts: UpstreamFacts;
  /** Chain currently being processed. "IGH" for v1 heavy-chain runs. */
  chain: string;
  /** Heavy-chain threshold (Nb_freq cutoff). Per R16 default is 0.000961. */
  threshold: number;
  /** Sample-size floor (R12). Default 100. */
  nMin: number;
};

/** Unified V3 data model — block args inputs PLUS UI state. */
export type BlockData = {
  // Workflow-bound fields (projected into args by the .args() lambda).
  inputRef?: PlRef;
  inputDerivedFacts?: UpstreamFacts;
  chain?: string;
  threshold?: number;
  nMin?: number;

  // UI-only state (never projects to args). Phase 5 wires these.
  settingsOpen?: boolean;
  logsOpen?: boolean;
  mainTableState?: PlDataTableStateV2;

  // Phase 7 placeholders (light-chain picker + LC threshold).
  lightChainPick?: "IGK" | "IGL";
  thresholdL?: number;
};
