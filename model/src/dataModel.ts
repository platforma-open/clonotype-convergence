import { createPlDataTableStateV2, DataModelBuilder } from "@platforma-sdk/model";
import type { BlockData } from "./types";

export const blockDataModel = new DataModelBuilder().from<BlockData>("v1").init(() => ({
  settingsOpen: true,
  logsOpen: false,
  mainTableState: createPlDataTableStateV2(),
  // Surface defaults in the UI from the start. The args lambda has the
  // same fallbacks as a safety net, but seeding here means PlNumberField
  // shows 0.000961 / 100 immediately rather than empty fields.
  threshold: 0.000961,
  nMin: 100,
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
}));
