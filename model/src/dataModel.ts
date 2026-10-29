import type { GraphMakerState } from "@milaboratories/graph-maker";
import { kind } from "@platforma-open/milaboratories.clonotype-convergence.kind";
import type { ColumnUniversalId, ColumnValueId } from "@platforma-sdk/model";
import {
  createColumnValueId,
  createPlDataTableStateV2,
  DataModelBuilder,
  isGlobalPObjectId,
  isPlRef,
} from "@platforma-sdk/model";
import { DEFAULT_ALPHA, DEFAULT_ISOTYPES, DEFAULT_NMIN, DEFAULT_THRESHOLD_H } from "./chains";
import { toColumnId } from "./columns";
import type {
  BlockDataV1,
  BlockDataV2,
  BlockDataV3,
  BlockDataV4,
  BlockDataV5,
  BlockDataV6,
  UpstreamFactsV2,
} from "./stored_data";
import type { BlockData, UpstreamFacts } from "./types";

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

export const blockDataModel = new DataModelBuilder({ kind })
  .from<BlockDataV1>("v1")
  // v2 — collapse the v1 dual-ref (mainRef/lightRef) into a single dataset
  // snapshot plus a `processLightChain` boolean, and map `axisName` →
  // `clonotypeKeyAxisName`.
  .migrate<BlockDataV2>(
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
  .migrate<BlockDataV3>("v3", (prev) => ({
    ...prev,
    expectedValues: prev.expectedValues ?? [],
    aggregatedTableState: prev.aggregatedTableState ?? createPlDataTableStateV2(),
  }))
  // v4 — parallel fast/full modes. The four per-chain histogram
  // states (graphStateHistogram/Score Heavy/Light) are replaced by two
  // selector-driven chart states (aggregated + per-sample). Backfill the two so
  // GraphMaker never gets an undefined state; the old fields, if present on
  // legacy data, are simply left unused.
  .migrate<BlockDataV4>("v4", (prev) => ({
    ...prev,
    graphStateAggregated: prev.graphStateAggregated ?? distGraphState("Score distribution"),
    graphStatePerSample: prev.graphStatePerSample ?? distGraphState("Per-sample distribution"),
  }))
  // v5 — reset both table states. A state saved under an older
  // `mainTableSourceId` format keeps that stale sourceId, and PlAgDataTableV2
  // then serves an empty datasource and waits for a state write that a table
  // without sheets never makes, so the table stays on "Loading" forever.
  .migrate<BlockDataV5>("v5", (prev) => ({
    ...prev,
    mainTableState: createPlDataTableStateV2(),
    aggregatedTableState: createPlDataTableStateV2(),
  }))
  // v6 — columns become result-pool ids, the expected values column value ids.
  // `mainTableSourceId` now carries the dataset's result-pool id, so both table
  // states are reset for the same reason as in v5.
  .migrate<BlockDataV6>("v6", (prev) => ({
    ...toColumnIds(prev),
    mainTableState: createPlDataTableStateV2(),
    aggregatedTableState: createPlDataTableStateV2(),
  }))
  // v7 — isotype filter and per-isotype scores. Blocks created before them keep
  // every clonotype (empty selection) and no per-isotype scores, so a re-run
  // reproduces their results; only new blocks start from DEFAULT_ISOTYPES (see
  // init).
  .migrate<BlockData>("v7", (prev) => ({
    ...prev,
    isotypeValues: [],
    perIsotype: false,
  }))
  .init(({ params }) => ({
    mainTableState: createPlDataTableStateV2(),
    aggregatedTableState: createPlDataTableStateV2(),
    // Empty string = user hasn't customised the label; the derived
    // chain/threshold subtitle shows as a placeholder in the page header.
    customBlockLabel: params?.customBlockLabel ?? "",
    // Heavy-chain fast-STAR threshold default 0.000961 (≈5% FDR target on
    // Abbate et al. 2024 human IgH calibration). fast-STAR runs on every chain,
    // so this is always in effect once heavy is processed.
    // thresholdL deliberately has NO default: the heavy-calibrated
    // value over-flags the lower-diversity light chain, so the user must enter
    // it explicitly. Until they do, a processed light chain leaves the block
    // non-runnable (the args issues report an error → Run disabled).
    thresholdH: params?.thresholdH ?? DEFAULT_THRESHOLD_H,
    nMin: params?.nMin ?? DEFAULT_NMIN,
    // full-STAR FDR target (Benjamini–Hochberg). STAR default 0.005.
    alpha: params?.alpha ?? DEFAULT_ALPHA,
    // Cluster filter — off by default. Paper default 10 for cluster_min
    // when the toggle is on.
    applyClusterFilter: params?.applyClusterFilter ?? false,
    clusterMin: params?.clusterMin ?? 10,
    // Clonotype-only aggregation. Defaults = the default path: no
    // metadata refs, every sample an independent eligible unit. The
    // expected-values multiselect is initialised so its v-model binding is
    // well-typed. `alpha` above is the only statistical knob.
    expectedValues: params?.expectedValues ?? [],
    // Isotype filter — keep IgM and IgG. The picker narrows this to the
    // isotypes the picked dataset actually has (see SettingsPanel).
    isotypeValues: params?.isotypeValues ?? [...DEFAULT_ISOTYPES],
    perIsotype: params?.perIsotype ?? false,
    // Two selector-driven distribution chart states — see
    // distGraphState. Both plot long-tailed scores, so both default to log Y.
    graphStateAggregated: distGraphState("Score distribution"),
    graphStatePerSample: distGraphState("Per-sample distribution"),
    // No init default of their own — unset unless a template seeds them.
    // `thresholdL` deliberately stays absent (see above).
    datasetRef: params?.datasetRef,
    filterRef: params?.filterRef,
    processLightChain: params?.processLightChain,
    thresholdL: params?.thresholdL,
    expectedFilterRef: params?.expectedFilterRef,
    groupingRef: params?.groupingRef,
  }));

// Internals

/**
 * Moves stored data to column ids. A ref to an upstream output becomes the result-pool id of that
 * output, which names the same block and column: the dataset, its subset, the Generation
 * Probability columns of the dataset snapshot, and the expected-filter and grouping columns. A
 * stored column that is neither is dropped, and the dataset's snapshot and label go with it. A
 * plain expected value becomes the column value id of that value, as text, in the converted
 * expected-filter column; without that column it is dropped.
 */
function toColumnIds(data: BlockDataV5): BlockDataV6 {
  const datasetRef = toStoredColumnId(data.datasetRef);
  const expectedFilterRef = toStoredColumnId(data.expectedFilterRef);
  return {
    ...data,
    datasetRef,
    filterRef: toStoredColumnId(data.filterRef),
    datasetFacts:
      datasetRef === undefined || data.datasetFacts === undefined
        ? undefined
        : factsWithColumnIds(data.datasetFacts),
    datasetLabel: datasetRef === undefined ? undefined : data.datasetLabel,
    expectedFilterRef,
    expectedValues: expectedValueIds(data.expectedValues, expectedFilterRef),
    groupingRef: toStoredColumnId(data.groupingRef),
  };
}

/** The snapshot with its Generation Probability columns as ids; availability follows the ids. */
function factsWithColumnIds(facts: UpstreamFactsV2): UpstreamFacts {
  const pgenRefHeavy = toStoredColumnId(facts.pgenRefHeavy);
  const pgenRefLight = toStoredColumnId(facts.pgenRefLight);
  return {
    ...facts,
    hasPgenHeavy: pgenRefHeavy !== undefined,
    hasPgenLight: pgenRefLight !== undefined,
    pgenRefHeavy,
    pgenRefLight,
  };
}

/**
 * Plain values of the expected-filter column as column value ids of `column`, in their stored
 * order: text stays as stored, a number becomes its decimal text.
 */
function expectedValueIds(
  values: readonly unknown[],
  column: ColumnUniversalId | undefined,
): ColumnValueId[] {
  if (column === undefined) return [];
  return values.flatMap((value) =>
    typeof value === "string" || typeof value === "number"
      ? [createColumnValueId({ column, value: String(value) })]
      : [],
  );
}

/**
 * A stored column as a result-pool id: a ref to an upstream output becomes the id of that output,
 * an id of another block's output is kept, anything else is dropped.
 */
function toStoredColumnId(stored: unknown): ColumnUniversalId | undefined {
  if (isPlRef(stored)) return toColumnId(stored);
  return isGlobalPObjectId(stored) ? stored : undefined;
}
