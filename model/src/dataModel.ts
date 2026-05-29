import { createPlDataTableStateV2, DataModelBuilder } from "@platforma-sdk/model";
import type { BlockData } from "./types";

export const blockDataModel = new DataModelBuilder().from<BlockData>("v1").init(() => ({
  settingsOpen: true,
  logsOpen: false,
  mainTableState: createPlDataTableStateV2(),
}));
