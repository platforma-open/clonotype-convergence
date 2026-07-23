import type { GraphMakerState } from "@milaboratories/graph-maker";
import { createPlDataTableStateV2, DataModelBuilder } from "@platforma-sdk/model";
import { DEFAULT_ALPHA, DEFAULT_NMIN } from "./chains";
import type { BlockData, BlockDataV1 } from "./types";

// Default distribution chart state (A-0015 v2). One state per selector-driven
// page. Linear Y for the aggregated page (the blend is a percentile in [0,1] —
// no long tail); log Y for the per-sample page (nbFreq / -log10 p is
// long-tailed). Shared by init() and the v4 backfill migration.
const distGraphState = (title: string, scale: "linear" | "log"): GraphMakerState => ({
  title,
  template: "bins",
  currentTab: null,
  layersSettings: { bins: { fillColor: "#5a9bd4" } },
  axesSettings: { axisY: { axisLabelsAngle: 90, scale }, other: { binsCount: 30 } },
});

export const blockDataModel = new DataModelBuilder()
  .from<BlockDataV1>("v1")
  // v2 — collapse the v1 dual-ref (mainRef/lightRef) into a single dataset
  // snapshot plus a `processLightChain` boolean, and map `axisName` →
  // `clonotypeKeyAxisName`.
  .migrate<BlockData>(
    "v2",
    ({ mainRef, mainRefFacts, mainRefLabel, lightRef, lightRefFacts, ...rest }) => {
      void lightRefFacts; // dropped — equal to mainRefFacts
      return {
        ...rest,
        datasetRef: mainRef,
        datasetLabel: mainRefLabel,
        processLightChain: lightRef !== undefined,
        datasetFacts: mainRefFacts && {
          chains: mainRefFacts.chains,
          hasAaCDR3: mainRefFacts.hasAaCDR3,
          hasNtCDR3: mainRefFacts.hasNtCDR3,
          hasAbundance: mainRefFacts.hasAbundance,
          clonotypeKeyAxisName: mainRefFacts.axisName,
          // v1 predates Pgen — no full-STAR facts. Left false; the user
          // re-picks the dataset to capture current Pgen availability.
          hasPgenHeavy: false,
          hasPgenLight: false,
        },
      };
    },
  )
  // v3 — backfill the fields added for the aggregated export (A-0011/A-0015):
  // the starScore weight, the expected-values multiselect, the aggregated-table
  // state, and the two aggregated-score histogram states. Blocks created at v2
  // (before these existed) otherwise have them undefined, which crashes
  // GraphMaker (undefined graph state). Existing values are preserved.
  .migrate<BlockData>("v3", (prev) => {
    const p = prev as Partial<BlockData>;
    return {
      ...prev,
      scoreWeight: p.scoreWeight ?? 0.5,
      expectedValues: p.expectedValues ?? [],
      aggregatedTableState: p.aggregatedTableState ?? createPlDataTableStateV2(),
    };
  })
  // v4 — parallel fast/full modes (spec v2). The four per-chain histogram
  // states (graphStateHistogram/Score Heavy/Light) are replaced by two
  // selector-driven chart states (aggregated + per-sample). Backfill the two so
  // GraphMaker never gets an undefined state; the old fields, if present on
  // legacy data, are simply left unused.
  .migrate<BlockData>("v4", (prev) => {
    const p = prev as Partial<BlockData>;
    return {
      ...prev,
      graphStateAggregated:
        p.graphStateAggregated ?? distGraphState("Score distribution", "linear"),
      graphStatePerSample:
        p.graphStatePerSample ?? distGraphState("Per-sample distribution", "log"),
    };
  })
  .init(() => ({
    settingsOpen: true,
    logsOpen: false,
    mainTableState: createPlDataTableStateV2(),
    aggregatedTableState: createPlDataTableStateV2(),
    // Empty string = user hasn't customised the label; the derived
    // chain/threshold subtitle shows as a placeholder in the page header.
    customBlockLabel: "",
    // Heavy-chain fast-STAR threshold default 0.000961 (≈5% FDR target on
    // Abbate et al. 2024 human IgH calibration). fast-STAR runs on every chain,
    // so this is always in effect once heavy is processed.
    // thresholdL deliberately has NO default (A-0015): the heavy-calibrated
    // value over-flags the lower-diversity light chain, so the user must enter
    // it explicitly. Until they do, a processed light chain leaves the block
    // non-runnable (the args gate throws → Run disabled).
    thresholdH: 0.000961,
    nMin: DEFAULT_NMIN,
    // full-STAR FDR target (Benjamini–Hochberg). STAR default 0.005.
    alpha: DEFAULT_ALPHA,
    // Cluster filter — off by default. Paper default 10 for cluster_min
    // when the toggle is on.
    applyClusterFilter: false,
    clusterMin: 10,
    // Clonotype-only aggregation (A-0011). Defaults = the default path: no
    // metadata refs, every sample an independent eligible unit, k = 1. The
    // expected-values multiselect + the starScore weight are initialised so
    // their v-model bindings are well-typed. `w` default 0.5 (50/50).
    expectedValues: [],
    scoreWeight: 0.5,
    // Two selector-driven distribution chart states (A-0015 v2) — see
    // distGraphState. Aggregated = the exported blend (linear Y); per-sample =
    // the long-tailed per-sample statistic (log Y).
    graphStateAggregated: distGraphState("Score distribution", "linear"),
    graphStatePerSample: distGraphState("Per-sample distribution", "log"),
  }));
