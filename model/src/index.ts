import type { InferOutputsType } from "@platforma-sdk/model";
import { BlockModelV3, DataModelBuilder } from "@platforma-sdk/model";
import type { BlockArgs, BlockData } from "./types";

export type { BlockArgs, BlockData };

const dataModel = new DataModelBuilder().from<BlockData>("v1").init(() => ({}));

export const platforma = BlockModelV3.create(dataModel)
  .args((data) => {
    if (!data.inputRef) throw new Error("Input dataset is required");
    return {
      inputRef: data.inputRef,
      // Default threshold from Abbate et al. 2024 (≈5% FDR on the paper's
      // human IgH calibration dataset). User-tunable via UI in later phases.
      threshold: data.threshold ?? 0.000961,
      // Sample-size floor (R12).
      nMin: data.nMin ?? 100,
    } satisfies BlockArgs;
  })
  .sections(() => [{ type: "link" as const, href: "/" as const, label: "Main" }])
  .title(() => "Clonotype Convergence")
  .done();

export type Platforma = typeof platforma;
export type BlockOutputs = InferOutputsType<typeof platforma>;
