import type { GraphMakerState } from "@milaboratories/graph-maker";
import type { PlDataTableStateV2, PlRef } from "@platforma-sdk/model";

/** Facts about the picked dataset as stored at `v1`: the clonotype axis name under `axisName`. */
export type UpstreamFactsV1 = {
  chains: string[];
  hasAaCDR3: boolean;
  hasNtCDR3: boolean;
  hasAbundance: boolean;
  axisName: string;
};

/**
 * Facts about the picked dataset as stored from `v2` to `v5`: the Generation Probability columns
 * as refs to upstream outputs.
 */
export type UpstreamFactsV2 = {
  chains: string[];
  hasAaCDR3: boolean;
  hasNtCDR3: boolean;
  hasAbundance: boolean;
  clonotypeKeyAxisName: string;
  hasPgenHeavy: boolean;
  hasPgenLight: boolean;
  pgenRefHeavy?: PlRef;
  pgenRefLight?: PlRef;
};

/**
 * Data as stored at `v1`: separate main and light dataset refs, each with its own snapshot. The
 * subset, expected-filter and grouping columns are refs to upstream outputs and the expected
 * values plain values of the expected-filter column. The expected values, the aggregated table
 * state and the two chart states are absent in blocks created before they existed.
 */
export type BlockDataV1 = AnalysisSettingsV1 & {
  mainRef?: PlRef;
  mainRefFacts?: UpstreamFactsV1;
  mainRefLabel?: string;
  lightRef?: PlRef;
  lightRefFacts?: UpstreamFactsV1;
};

/** Data as stored at `v2`: one dataset ref with its snapshot and the light-chain opt-in. */
export type BlockDataV2 = AnalysisSettingsV1 & {
  datasetRef?: PlRef;
  datasetFacts?: UpstreamFactsV2;
  datasetLabel?: string;
  processLightChain?: boolean;
};

/** Data as stored at `v3`: the expected values and the aggregated table state always present. */
export type BlockDataV3 = Omit<BlockDataV2, "expectedValues" | "aggregatedTableState"> & {
  expectedValues: string[];
  aggregatedTableState: PlDataTableStateV2;
};

/** Data as stored at `v4`: the two distribution chart states always present. */
export type BlockDataV4 = Omit<BlockDataV3, "graphStateAggregated" | "graphStatePerSample"> & {
  graphStateAggregated: GraphMakerState;
  graphStatePerSample: GraphMakerState;
};

/** Data as stored at `v5`: the same shape, with both table states reset. */
export type BlockDataV5 = BlockDataV4;

// Internals

/** The analysis settings and view states stored alike from `v1` to `v2`. */
type AnalysisSettingsV1 = {
  filterRef?: PlRef;
  thresholdH?: number;
  thresholdL?: number;
  nMin?: number;
  alpha?: number;
  applyClusterFilter: boolean;
  clusterMin?: number;
  expectedFilterRef?: PlRef;
  expectedValues?: string[];
  groupingRef?: PlRef;
  mainTableState: PlDataTableStateV2;
  aggregatedTableState?: PlDataTableStateV2;
  graphStateAggregated?: GraphMakerState;
  graphStatePerSample?: GraphMakerState;
  customBlockLabel: string;
};
