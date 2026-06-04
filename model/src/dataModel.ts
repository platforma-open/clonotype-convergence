import { createPlDataTableStateV2, DataModelBuilder } from "@platforma-sdk/model";
import type { BlockData } from "./types";

export const blockDataModel = new DataModelBuilder().from<BlockData>("v1").init(() => ({
  settingsOpen: true,
  logsOpen: false,
  mainTableState: createPlDataTableStateV2(),
  // Empty string = user hasn't customised the label; the derived
  // chain/threshold subtitle shows as a placeholder in the page header.
  customBlockLabel: "",
  // R16 — heavy-chain threshold default 0.000961 (≈5% FDR target on
  // Abbate et al. 2024 human IgH calibration).
  // R17 — thresholdL deliberately has NO default; user must enter it
  // explicitly so they don't ship an inappropriate value silently.
  thresholdH: 0.000961,
  nMin: 100,
  // Cluster filter (R58, Phase 7.5) — off by default to preserve v1
  // semantics. Paper default 10 for cluster_min when the toggle is on.
  applyClusterFilter: false,
  clusterMin: 10,
  // Heavy-chain histogram graph state (Phase 6). Initial settings:
  // bins template, log Y axis (long-tail signal — most clones have
  // small Nb_freq, a few have very large).
  graphStateHistogramHeavy: {
    title: "Convergent neighbour frequency (heavy chain)",
    template: "bins",
    currentTab: null,
    layersSettings: {
      bins: { fillColor: "#99e099" },
    },
    axesSettings: {
      axisY: {
        axisLabelsAngle: 90,
        scale: "log",
      },
      other: { binsCount: 30 },
    },
  },
  // Light-chain histogram graph state (Phase 7). Same shape as heavy;
  // different fill colour to disambiguate at a glance.
  graphStateHistogramLight: {
    title: "Convergent neighbour frequency (light chain)",
    template: "bins",
    currentTab: null,
    layersSettings: {
      bins: { fillColor: "#99c4e0" },
    },
    axesSettings: {
      axisY: {
        axisLabelsAngle: 90,
        scale: "log",
      },
      other: { binsCount: 30 },
    },
  },
}));
