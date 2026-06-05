import type { BlockData } from "./types";

/**
 * Chain / axis / anchor constants and small helpers shared between the
 * model's outputs and the workflow-facing args lambda. Kept separate
 * from `index.ts` so the model builder stays readable.
 */

// Datasets the dropdown offers — anchors on the clonotype-keyed axes
// (R10). Bulk uses pl7.app/vdj/clonotypeKey; single-cell uses
// pl7.app/vdj/scClonotypeKey.
export const inputAnchorSpecs = [
  {
    axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/clonotypeKey" }],
    annotations: { "pl7.app/isAnchor": "true" },
  },
  {
    axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/scClonotypeKey" }],
    annotations: { "pl7.app/isAnchor": "true" },
  },
];

export const SC_AXIS = "pl7.app/vdj/scClonotypeKey";

// MiXCR chain DOMAIN values (R28). Heavy = "IGHeavy"; light family
// includes IGLight (κ + λ combined) plus IGKappa / IGLambda when MiXCR
// surfaces them separately. TCR domain values are TCRAlpha/TCRBeta/
// TCRGamma/TCRDelta — filtered out at R10.
export const HEAVY_CHAIN = "IGHeavy";
export const LIGHT_CHAINS = new Set(["IGLight", "IGKappa", "IGLambda"]);

// SC anchors put receptor (not chain) in the axis domain. "IG" = BCR;
// TCRAB / TCRGD = TCR families. Chain identity in SC lives on the
// COLUMN domain via `scClonotypeChain` ("A" = heavy, "B" = light) plus
// `scClonotypeChain/index` (primary / secondary allele).
export const SC_BCR_RECEPTOR = "IG";
export const SC_CHAIN_FROM_LETTER: Record<string, string> = { A: HEAVY_CHAIN, B: "IGLight" };
export const SC_LETTER_FROM_CHAIN: Record<string, string> = {
  IGHeavy: "A",
  IGLight: "B",
  IGKappa: "B",
  IGLambda: "B",
};

export function isHeavy(chain: string | undefined): boolean {
  return chain === HEAVY_CHAIN;
}
export function isLight(chain: string | undefined): boolean {
  return !!chain && LIGHT_CHAINS.has(chain);
}

// Friendly chain name for user-facing strings (R64 — no raw IGHeavy /
// IGLight in copy). Subtitle (R55), section labels, etc.
export function friendlyChain(chain: string): string {
  if (chain === "IGHeavy") return "Heavy";
  if (chain === "IGLight") return "Light";
  if (chain === "IGKappa") return "Light (κ)";
  if (chain === "IGLambda") return "Light (λ)";
  return chain;
}

// R55 subtitle — "<dataset_label> <threshold>" in single-chain mode
// (bulk-heavy, bulk-light, SC heavy-only); "<dataset_label> <thresholdH>
// / Light <thresholdL>" in SC paired mode. Dataset label is snapshotted
// at pick time from the dropdown option. Empty when not enough is picked
// to be meaningful.
export function formatSubtitle(data: BlockData): string | undefined {
  const facts = data.mainRefFacts;
  if (!facts || !data.mainRefLabel) return undefined;

  const isSC = facts.axisName === SC_AXIS;
  const hasHeavyChain = facts.chains.some(isHeavy);

  // Main-pick threshold: heavy when the main carries heavy (bulk-heavy
  // or SC IG), light only for bulk-light (LC is the picked main).
  const mainThreshold = hasHeavyChain ? data.thresholdH : data.thresholdL;
  if (mainThreshold === undefined) return undefined;

  const parts = [`${data.mainRefLabel} ${mainThreshold}`];

  // SC paired (LC checkbox ticked) adds the LC suffix as a literal
  // "Light <thresholdL>", no friendly-chain mapping.
  if (isSC && data.lightRef !== undefined && data.thresholdL !== undefined) {
    parts.push(`Light ${data.thresholdL}`);
  }

  return parts.join(" / ");
}
