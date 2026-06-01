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
}));
