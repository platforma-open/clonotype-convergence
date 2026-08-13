import type { GraphMakerState } from "@milaboratories/graph-maker";
import type { PlDataTableStateV2, PlRef } from "@platforma-sdk/model";

/**
 * Facts about an upstream input ref, snapshotted into BlockData at
 * user-gesture time. One snapshot per populated chain.
 * The args lambda validates from these snapshots — never from
 * ctx.resultPool — because args lambdas are `data`-only (snapshot
 * pattern).
 *
 * `chains` carries the verbatim VDJ chain DOMAIN values from MiXCR
 * (e.g. "IGHeavy", "IGLight", "IGKappa", "IGLambda", "TCRAlpha"). The
 * presence flags are aggregate across all detected chains for the
 * picked anchor. `clonotypeKeyAxisName` carries the second-axis name
 * from the picked anchor's spec ("pl7.app/vdj/clonotypeKey" for bulk;
 * "pl7.app/vdj/scClonotypeKey" for single-cell) — drives mode
 * detection.
 */
export type UpstreamFacts = {
  chains: string[];
  hasAaCDR3: boolean;
  hasNtCDR3: boolean;
  hasAbundance: boolean;
  clonotypeKeyAxisName: string;
  /** Whether a per-clonotype Pgen column (from the Generation Probability
   *  block) is available for the heavy / light chain. Decides whether full-STAR
   *  is ADDED on that chain (A-0010) — fast-STAR runs either way. Captured at
   *  pick time (snapshot). Derived from the presence of the matching Pgen ref
   *  below (single source of truth). */
  hasPgenHeavy: boolean;
  hasPgenLight: boolean;
  /** PlRef to the Generation Probability block's per-clonotype Pgen column
   *  for the heavy / light chain, matched by name + this dataset's clonotype
   *  axis (so it can't grab a Pgen from another run). Carried into args so the
   *  platform records convergence's DEPENDENCY on gen-prob — that edge is what
   *  pulls gen-prob's Pgen export into the WORKFLOW's context pool (the model's
   *  full-project pool sees it regardless; the workflow only sees upstreams).
   *  Without it the workflow's anchored query finds no Pgen and full-STAR
   *  silently degrades to 0 hits. Snapshotted at pick time. */
  pgenRefHeavy?: PlRef;
  pgenRefLight?: PlRef;
};

/** Args passed to the workflow — output shape of `.args(...)`.
 *  Per-chain slots; at least one of chainH/chainL must be populated.
 *  The mode (bulk vs SC) is inferred from the chain facts'
 *  `clonotypeKeyAxisName`. */
export type BlockArgs = {
  /** Heavy-chain anchor; populated when the user's dataset pick has a
   *  heavy chain (bulk-heavy OR SC paired — SC anchors carry both
   *  chains as column-domain siblings, so chainH and chainL hold
   *  the SAME ref in that case). */
  chainH?: PlRef;
  /** Verbatim chain domain value of the heavy anchor (always
   *  "IGHeavy" when present). */
  chainHName?: string;
  /** Heavy-chain threshold (Nb_freq cutoff). Required iff chainH is
   *  populated. Default is 0.000961. */
  thresholdH?: number;
  /** SC scClonotypeChain letter for heavy ("A"). Only set in SC
   *  mode — drives the workflow's chain-specific column-domain
   *  filter. Undefined in bulk mode (workflow falls back to
   *  axis-domain chain matching). */
  chainHScLetter?: string;

  /** Light-chain anchor; populated when the dataset pick is bulk-light
   *  OR when SC paired data carries an IGLight sibling. */
  chainL?: PlRef;
  /** Verbatim chain domain value of the light anchor (e.g.
   *  "IGLight", "IGKappa", "IGLambda"). */
  chainLName?: string;
  /** Light-chain threshold (no default; user must enter
   *  explicitly). Required iff chainL is populated. */
  thresholdL?: number;
  /** SC scClonotypeChain letter for light ("B"). See chainHScLetter. */
  chainLScLetter?: string;

  /** Whether the heavy / light chain runs full-STAR (Pgen available) — from
   *  the dataset-facts snapshot. Drives the workflow's method per chain and
   *  whether it consumes the Pgen sibling. Set only for a processed chain. */
  hasPgenHeavy?: boolean;
  hasPgenLight?: boolean;
  /** PlRef to gen-prob's per-clonotype Pgen column for the heavy / light
   *  chain. Projected ONLY for a full-STAR chain (hasPgen*). Its presence in
   *  args establishes the cross-block dependency on gen-prob so the workflow
   *  can resolve the Pgen data by ref (bb.addSingle). */
  pgenRefHeavy?: PlRef;
  pgenRefLight?: PlRef;

  /** Sample-size floor. Default 100. */
  nMin: number;

  /** full-STAR FDR target (Benjamini–Hochberg alpha). Default 0.005. The
   *  full-STAR knob; the workflow also defaults it if absent. */
  alpha: number;

  // ---- Clonotype-only aggregation (A-0011) ---------------------------------
  // Optional metadata-driven refinements of the exported aggregate; all absent
  // → the default path (every sample an independent, eligible unit).
  /** PlRef to a sampleId-keyed metadata column (`pl7.app/metadata`) whose
   *  selected values mark the biologically-expected (post-exposure) samples.
   *  Its presence in args establishes the samples-block dependency (like the
   *  Pgen ref). Only expected samples enter the EXPORTED aggregate; the block's
   *  own per-sample table keeps all samples. */
  expectedFilterRef?: PlRef;
  /** Values of `expectedFilterRef` that count as expected. */
  expectedValues?: string[];
  /** PlRef to a sampleId-keyed metadata column marking independent units
   *  (e.g. donor) — drives the two-level aggregation: the units full-STAR's
   *  evidence is combined across, the units fast-STAR's median is taken over,
   *  and the units the reproducibility ratio counts. Unset → every sample is
   *  its own unit. `alpha` is the only statistical knob (A-0011). */
  groupingRef?: PlRef;

  // Optional cluster filter.
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
  /** The user's input dataset pick (accepts any BCR-compatible
   *  anchor: heavy bulk, light bulk, or single-cell IG). Drives
   *  args.chainH or args.chainL depending on the picked chain's
   *  identity. */
  datasetRef?: PlRef;
  /** Snapshot facts for `datasetRef`. Written by the picker handler in
   *  the same user-gesture as `datasetRef`. */
  datasetFacts?: UpstreamFacts;
  /** Snapshot label for `datasetRef` — the exact dropdown text the user
   *  saw when they picked. Used as the dataset prefix in the page
   *  subtitle so the subtitle reads e.g. "MyMixcrBulk 0.000961"
   *  (single chain) or "MyMixcrSc 0.000961 / Light 0.03" (SC paired). */
  datasetLabel?: string;

  /** Whether to also process the light chain (SC paired mode). The
   *  light chain is a column-domain sibling on the SAME anchor as the
   *  dataset pick, so no separate ref is needed — this is the explicit
   *  opt-in for LC processing. Ignored in bulk mode (bulk is single-chain:
   *  the light chain, when it is the pick, is processed as the primary chain). */
  processLightChain?: boolean;

  /** Heavy-chain threshold. Required iff dataset pick is heavy
   *  (bulk-heavy or SC-heavy). */
  thresholdH?: number;
  /** Light-chain threshold. Required iff a light chain is processed
   *  (bulk-light dataset OR SC + light-chain opt-in). */
  thresholdL?: number;
  /** Sample-size floor. */
  nMin?: number;
  /** full-STAR FDR target (Benjamini–Hochberg alpha). Advanced setting;
   *  initialised to 0.005. */
  alpha?: number;

  // Cluster filter. Toggle + cluster-min. Toggle is required
  // (initialised to false by dataModel.init); the v-model binding on
  // the Advanced-settings PlCheckbox requires a strict boolean.
  applyClusterFilter: boolean;
  clusterMin?: number;

  // Clonotype-only aggregation controls (A-0011). All optional; unset → the
  // default aggregation (every sample an independent, eligible unit).
  /** Sample-metadata column marking biologically-expected samples. */
  expectedFilterRef?: PlRef;
  /** Selected expected values of `expectedFilterRef`. */
  expectedValues?: string[];
  /** Sample-metadata column marking independent units (e.g. donor). Setting it
   *  makes a donor's samples collapse together before the cross-donor
   *  aggregation and defines the reproducibility denominator (A-0011); no
   *  separate toggle, threshold or weight. */
  groupingRef?: PlRef;

  // UI-only state (never projects to args).
  settingsOpen?: boolean;
  logsOpen?: boolean;
  /** Required (initialised by dataModel.init); PlAgDataTableV2's
   *  v-model expects a defined value. */
  mainTableState: PlDataTableStateV2;
  /** Table state for the clonotype-only aggregated EXPORT table (its own page). */
  aggregatedTableState: PlDataTableStateV2;

  /** Aggregated (clonotype-only) distribution chart state — one selector-driven
   *  page over every aggregated score across chain × mode (A-0015). */
  graphStateAggregated: GraphMakerState;
  /** Per-sample distribution chart state — one selector-driven page over every
   *  per-sample score across chain × mode. */
  graphStatePerSample: GraphMakerState;

  /** User-overridden block label. Empty string when the user hasn't
   *  set one — the derived chain/threshold label then shows as a
   *  placeholder in the page header. Mirrors the pattern in
   *  immune-assay-data / clonotype-clustering. */
  customBlockLabel: string;
};

/** Legacy (v1) persisted facts shape — uses `axisName` where the current
 *  shape uses `clonotypeKeyAxisName`. Used only by the data-model migration. */
export type UpstreamFactsV1 = Omit<
  UpstreamFacts,
  "clonotypeKeyAxisName" | "hasPgenHeavy" | "hasPgenLight" | "pgenRefHeavy" | "pgenRefLight"
> & { axisName: string };

/** Legacy (v1) persisted block data — carries separate main/light ref
 *  snapshots. Used only by the data-model migration. */
export type BlockDataV1 = Omit<
  BlockData,
  "datasetRef" | "datasetFacts" | "datasetLabel" | "processLightChain"
> & {
  mainRef?: PlRef;
  mainRefFacts?: UpstreamFactsV1;
  mainRefLabel?: string;
  lightRef?: PlRef;
  lightRefFacts?: UpstreamFactsV1;
};
