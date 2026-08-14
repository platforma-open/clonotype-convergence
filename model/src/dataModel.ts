import type { GraphMakerState } from "@milaboratories/graph-maker";
import { createPlDataTableStateV2, DataModelBuilder } from "@platforma-sdk/model";
import { DEFAULT_ALPHA, DEFAULT_NMIN, DEFAULT_THRESHOLD_H } from "./chains";
import type { BlockData, BlockDataV1 } from "./types";

// Default distribution chart state. One state per selector-driven
// page. Log Y on both — not a parameter: every score these pages plot is
// long-tailed (the upper-median nbFreq, and -log10 of the combined p), so a
// linear default would flatten all of them into the first bin. Shared by
// init() and the migrations.
const distGraphState = (title: string): GraphMakerState => ({
  title,
  template: "bins",
  currentTab: null,
  layersSettings: { bins: { fillColor: "#5a9bd4" } },
  axesSettings: { axisY: { axisLabelsAngle: 90, scale: "log" }, other: { binsCount: 30 } },
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
  // v3 — backfill the fields added for the aggregated export:
  // the expected-values multiselect and the aggregated-table state. Blocks
  // created at v2 (before these existed) otherwise have them undefined, which
  // crashes GraphMaker (undefined graph state). Existing values are preserved.
  // (This step also used to backfill a starScore weight; the aggregation no
  // longer has a weight, so the field is gone. Legacy data may
  // still carry it; it is simply unused.)
  .migrate<BlockData>("v3", (prev) => {
    const p = prev as Partial<BlockData>;
    return {
      ...prev,
      expectedValues: p.expectedValues ?? [],
      aggregatedTableState: p.aggregatedTableState ?? createPlDataTableStateV2(),
    };
  })
  // v4 — parallel fast/full modes. The four per-chain histogram
  // states (graphStateHistogram/Score Heavy/Light) are replaced by two
  // selector-driven chart states (aggregated + per-sample). Backfill the two so
  // GraphMaker never gets an undefined state; the old fields, if present on
  // legacy data, are simply left unused.
  .migrate<BlockData>("v4", (prev) => {
    const p = prev as Partial<BlockData>;
    return {
      ...prev,
      graphStateAggregated: p.graphStateAggregated ?? distGraphState("Score distribution"),
      graphStatePerSample: p.graphStatePerSample ?? distGraphState("Per-sample distribution"),
    };
  })
  .init(() => ({
    mainTableState: createPlDataTableStateV2(),
    aggregatedTableState: createPlDataTableStateV2(),
    // Empty string = user hasn't customised the label; the derived
    // chain/threshold subtitle shows as a placeholder in the page header.
    customBlockLabel: "",
    // Heavy-chain fast-STAR threshold default 0.000961 (≈5% FDR target on
    // Abbate et al. 2024 human IgH calibration). fast-STAR runs on every chain,
    // so this is always in effect once heavy is processed.
    // thresholdL deliberately has NO default: the heavy-calibrated
    // value over-flags the lower-diversity light chain, so the user must enter
    // it explicitly. Until they do, a processed light chain leaves the block
    // non-runnable (the args gate throws → Run disabled).
    thresholdH: DEFAULT_THRESHOLD_H,
    nMin: DEFAULT_NMIN,
    // full-STAR FDR target (Benjamini–Hochberg). STAR default 0.005.
    alpha: DEFAULT_ALPHA,
    // Cluster filter — off by default. Paper default 10 for cluster_min
    // when the toggle is on.
    applyClusterFilter: false,
    clusterMin: 10,
    // Clonotype-only aggregation. Defaults = the default path: no
    // metadata refs, every sample an independent eligible unit. The
    // expected-values multiselect is initialised so its v-model binding is
    // well-typed. `alpha` above is the only statistical knob.
    expectedValues: [],
    // Two selector-driven distribution chart states — see
    // distGraphState. Both plot long-tailed scores, so both default to log Y.
    graphStateAggregated: distGraphState("Score distribution"),
    graphStatePerSample: distGraphState("Per-sample distribution"),
  }));
