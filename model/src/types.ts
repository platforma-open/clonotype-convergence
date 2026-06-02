import type { GraphMakerState } from "@milaboratories/graph-maker";
import type { PlDataTableStateV2, PlRef } from "@platforma-sdk/model";

/**
 * Facts about the picked upstream input ref, snapshotted into BlockData
 * at user-gesture time (R7, R8). The args lambda validates from this
 * snapshot — never from ctx.resultPool — because args lambdas are
 * `data`-only (model.md: snapshot pattern).
 *
 * `chains` carries the verbatim VDJ chain DOMAIN values from MiXCR
 * (e.g. "IGHeavy", "IGLight", "TCRAlpha"). The presence flags are
 * aggregate across all detected BCR chains for the picked anchor.
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
  /** Heavy-chain anchor's chain domain value ("IGHeavy"). */
  chain: string;
  /** Heavy-chain threshold (Nb_freq cutoff). Per R16 default is 0.000961. */
  threshold: number;
  /** Sample-size floor (R12). Default 100. */
  nMin: number;

  // Light chain — present when the user picked one via the settings
  // picker AND it was discoverable in the upstream pool (Phase 7, R18).
  /** PlRef of the LC anchor from the same clonotyping run. */
  lightChainRef?: PlRef;
  /** Chain domain value (e.g. "IGLight"). Used to tag emitted LC
   *  PColumns and as the Python `--chain` arg. */
  lightChainName?: string;
  /** Light-chain threshold (R17 — defaults to same as heavy). */
  thresholdL?: number;
};

/** Unified V3 data model — block args inputs PLUS UI state. */
export type BlockData = {
  // Workflow-bound fields (projected into args by the .args() lambda).
  inputRef?: PlRef;
  inputDerivedFacts?: UpstreamFacts;
  chain?: string;
  threshold?: number;
  nMin?: number;

  // UI-only state (never projects to args).
  settingsOpen?: boolean;
  logsOpen?: boolean;
  /** Required (initialised by dataModel.init); PlAgDataTableV2's v-model
   *  expects a defined value. */
  mainTableState: PlDataTableStateV2;

  /** Heavy-chain histogram graph state. Required field — initialised
   *  by dataModel.init for GraphMaker v-model typing. */
  graphStateHistogramHeavy: GraphMakerState;

  // Light-chain processing (Phase 7, R18). Snapshot pattern: the
  // picker handler writes both `lightChainPick` AND `lightChainRef`
  // in one gesture, mirroring the inputRef snapshot. args lambda is
  // data-only and reads both.
  /** Chain domain string the user picked (e.g. "IGLight"). */
  lightChainPick?: string;
  /** PlRef of the LC anchor that matched the picked chain. Stored
   *  alongside `lightChainPick` so the args lambda can project it. */
  lightChainRef?: PlRef;
  /** Light-chain threshold (R17). */
  thresholdL?: number;

  /** Light-chain histogram graph state. Required field for GraphMaker
   *  v-model when the LC page renders. */
  graphStateHistogramLight: GraphMakerState;

  /** Light-chain table grid state (Phase 7). Required by
   *  PlAgDataTableV2's v-model typing. */
  lightMainTableState: PlDataTableStateV2;

  /** User-overridden block label. Empty string when the user hasn't
   *  set one — the derived chain/threshold label then shows as a
   *  placeholder in the page header. Mirrors the pattern in
   *  immune-assay-data / clonotype-clustering. */
  customBlockLabel: string;
};
