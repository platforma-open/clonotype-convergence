import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import type { PColumnIdAndSpec } from "@platforma-sdk/model";

// The convergence SCORE columns across chain × mode (A-0015 v2). The two
// distribution chart pages offer these as the Y-axis choices; the user picks
// one, and grouping is its matching hit call.
const NB_FREQ = "pl7.app/vdj/convergence/nbFreq";
const FULL_SCORE = "pl7.app/vdj/convergence/fullStarScore";
const HIT_FOR: Record<string, string> = {
  [NB_FREQ]: "pl7.app/vdj/convergence/fastStar",
  [FULL_SCORE]: "pl7.app/vdj/convergence/fullStar",
};

// Y-axis predicate: only convergence score columns are selectable (the hit call
// is used for grouping, not as a Y option), so units never mix.
export const isScoreColumn = (spec: { name: string }): boolean =>
  spec.name === NB_FREQ || spec.name === FULL_SCORE;

const chainOf = (spec: { domain?: Record<string, string> }): string | undefined =>
  spec.domain?.["pl7.app/vdj/chain"] ?? spec.domain?.["pl7.app/vdj/scClonotypeChain"];

// Default value + grouping: prefer the full-STAR score where present, else
// fast-STAR; group by the matching hit on the SAME chain. The threshold line
// (nbFreq carries pl7.app/graph/thresholds) appears automatically when a
// fast-STAR score is the selected value.
export function distributionDefaults(
  pcols: readonly PColumnIdAndSpec[] | undefined,
): PredefinedGraphOption<"histogram">[] | undefined {
  if (!pcols) return undefined;
  const score =
    pcols.find((p) => p.spec.name === FULL_SCORE) ?? pcols.find((p) => p.spec.name === NB_FREQ);
  if (!score) return undefined;
  const chain = chainOf(score.spec);
  const hit = pcols.find(
    (p) => p.spec.name === HIT_FOR[score.spec.name] && chainOf(p.spec) === chain,
  );
  const defaults: PredefinedGraphOption<"histogram">[] = [
    { inputName: "value", selectedSource: score.spec },
  ];
  if (hit) defaults.push({ inputName: "grouping", selectedSource: hit.spec });
  return defaults;
}
