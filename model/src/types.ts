import type { GraphMakerState } from "@milaboratories/graph-maker";
import type { PlDataTableStateV2, PlRef } from "@platforma-sdk/model";

/**
 * Facts about an upstream input ref, snapshotted into BlockData at
 * user-gesture time (R7, R8, R24). One snapshot per populated chain.
 * The args lambda validates from these snapshots — never from
 * ctx.resultPool — because args lambdas are `data`-only (model.md:
 * snapshot pattern).
 *
 * `chains` carries the verbatim VDJ chain DOMAIN values from MiXCR
 * (e.g. "IGHeavy", "IGLight", "IGKappa", "IGLambda", "TCRAlpha"). The
 * presence flags are aggregate across all detected chains for the
 * picked anchor. `axisName` carries the second-axis name from the
 * picked anchor's spec ("pl7.app/vdj/clonotypeKey" for bulk;
 * "pl7.app/vdj/scClonotypeKey" for single-cell) — used by R61 mode
 * detection.
 */
export type UpstreamFacts = {
  chains: string[];
  hasAaCDR3: boolean;
  hasNtCDR3: boolean;
  hasAbundance: boolean;
  axisName: string;
};

/** Args passed to the workflow — output shape of `.args(...)` (R15).
 *  Per-chain slots; at least one of chainH/chainL must be populated
 *  (R6). The mode (bulk vs SC) is inferred from the chain facts'
 *  `axisName` (R61). */
export type BlockArgs = {
  /** Heavy-chain anchor; populated when the user's main pick has a
   *  heavy chain (bulk-heavy OR SC paired — SC anchors carry both
   *  chains as column-domain siblings, so chainH and chainL hold
   *  the SAME ref in that case). */
  chainH?: PlRef;
  /** Verbatim chain domain value of the heavy anchor (always
   *  "IGHeavy" when present). */
  chainHName?: string;
  /** Heavy-chain threshold (Nb_freq cutoff). Required iff chainH is
   *  populated. Default per R16 is 0.000961. */
  thresholdH?: number;
  /** SC scClonotypeChain letter for heavy ("A"). Only set in SC
   *  mode — drives the workflow's chain-specific column-domain
   *  filter. Undefined in bulk mode (workflow falls back to
   *  axis-domain chain matching). */
  chainHScLetter?: string;

  /** Light-chain anchor; populated when the main pick is bulk-light
   *  OR when SC paired data carries an IGLight sibling. */
  chainL?: PlRef;
  /** Verbatim chain domain value of the light anchor (e.g.
   *  "IGLight", "IGKappa", "IGLambda"). */
  chainLName?: string;
  /** Light-chain threshold (R17 — no default; user must enter
   *  explicitly). Required iff chainL is populated. */
  thresholdL?: number;
  /** SC scClonotypeChain letter for light ("B"). See chainHScLetter. */
  chainLScLetter?: string;

  /** Sample-size floor (R12). Default 100. */
  nMin: number;

  // Optional cluster filter (R58).
  /** When true, run Stage 3 (binder cluster filter) after Stage 2
   *  and emit the additional `fastStarClusterFiltered` column. Off
   *  by default. */
  applyClusterFilter: boolean;
  /** DBSCAN min_samples for the binder cluster filter. Projected
   *  only when applyClusterFilter is true. */
  clusterMin?: number;

  // Labels projected into the workflow trace step so downstream blocks
  // can disambiguate columns from multiple convergence blocks.
  /** User-overridden block label (empty when unset). */
  customBlockLabel: string;
  /** Parameter-encoding fallback label (threshold(s), nMin, cluster) —
   *  see getDefaultBlockLabel. Used as the trace label when
   *  customBlockLabel is empty. */
  defaultBlockLabel: string;
};

/** Unified V3 data model — block args inputs PLUS UI state. */
export type BlockData = {
  // Workflow-bound fields (projected into args by the .args() lambda).
  /** The user's main input pick (R18 — accepts any BCR-compatible
   *  anchor: heavy bulk, light bulk, or single-cell IG). Drives
   *  args.chainH or args.chainL depending on the picked chain's
   *  identity. */
  mainRef?: PlRef;
  /** Snapshot facts for `mainRef`. Written by the main-picker handler
   *  in the same user-gesture as `mainRef` (R8, R24). */
  mainRefFacts?: UpstreamFacts;
  /** Snapshot label for `mainRef` — the exact dropdown text the user
   *  saw when they picked. Used as the dataset prefix in the page
   *  subtitle so the subtitle reads e.g. "MyMixcrBulk 0.000961"
   *  (single chain) or "MyMixcrSc 0.000961 / Light 0.03" (SC paired). */
  mainRefLabel?: string;

  /** Optional secondary light-chain pick. Visible when the main pick
   *  CAN pair with a light chain:
   *   - bulk-heavy main → LC options are bulk-LC anchors;
   *   - SC main → LC options are the same SC anchor (heavy and light
   *     hang off it as column-domain siblings; the picker is the
   *     explicit opt-in for LC processing, R66).
   *  When unset, only the main pick's chain is processed. */
  lightRef?: PlRef;
  /** Snapshot facts for `lightRef`. Written in the same user-gesture
   *  as `lightRef`. */
  lightRefFacts?: UpstreamFacts;

  /** Heavy-chain threshold. Required iff main pick is heavy
   *  (bulk-heavy or SC-heavy). */
  thresholdH?: number;
  /** Light-chain threshold. Required iff a light chain is processed
   *  (bulk-light main pick OR SC-heavy main + secondary LC pick). */
  thresholdL?: number;
  /** Sample-size floor (R12). */
  nMin?: number;

  // Cluster filter (R58). Toggle + cluster-min. Toggle is required
  // (initialised to false by dataModel.init); the v-model binding on
  // the Advanced-settings PlCheckbox requires a strict boolean.
  applyClusterFilter: boolean;
  clusterMin?: number;

  // UI-only state (never projects to args).
  settingsOpen?: boolean;
  logsOpen?: boolean;
  /** Required (initialised by dataModel.init); PlAgDataTableV2's
   *  v-model expects a defined value. */
  mainTableState: PlDataTableStateV2;

  /** Heavy-chain histogram graph state. */
  graphStateHistogramHeavy: GraphMakerState;
  /** Light-chain histogram graph state. */
  graphStateHistogramLight: GraphMakerState;

  /** User-overridden block label. Empty string when the user hasn't
   *  set one — the derived chain/threshold label then shows as a
   *  placeholder in the page header. Mirrors the pattern in
   *  immune-assay-data / clonotype-clustering. */
  customBlockLabel: string;
};
