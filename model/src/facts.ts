import type { PlRef, RenderCtxBase } from "@platforma-sdk/model";
import { SC_AXIS, SC_CHAIN_FROM_LETTER } from "./chains";
import type { UpstreamFacts } from "./types";

/**
 * Walk the siblings of `ref` on its shared axes and aggregate facts:
 * which chains appear, whether the required CDR3 + abundance siblings
 * are present, and the axis name (drives R61 mode detection).
 */
export function discoverUpstreamFacts<A, U>(
  ctx: RenderCtxBase<A, U>,
  ref: PlRef,
): UpstreamFacts | undefined {
  const refSpec = ctx.resultPool.getPColumnSpecByRef(ref);
  if (!refSpec) return undefined;
  // Name of the second axis = clonotype-key axis. Drives R61
  // mode detection and the BULK-vs-SC handling below.
  const clonotypeKeyAxisName = refSpec.axesSpec[1]?.name ?? "";
  const isSC = clonotypeKeyAxisName === SC_AXIS;

  // MiXCR partitions outputs across two axis frames: per-(sample,
  // clonotype) and per-clonotype. The anchored selector matches axes
  // exactly, so we need both queries.
  const perSampleClonotype =
    ctx.resultPool.getAnchoredPColumns({ main: ref }, [
      {
        axes: [
          { anchor: "main", idx: 0 },
          { anchor: "main", idx: 1 },
        ],
      },
    ]) ?? [];
  const perClonotype =
    ctx.resultPool.getAnchoredPColumns({ main: ref }, [{ axes: [{ anchor: "main", idx: 1 }] }]) ??
    [];

  const chains = new Set<string>();
  // Aggregate (dataset-level) presence: does the dataset carry ANY aa-CDR3 /
  // nt-CDR3 / abundance sibling? These feed only the dropdown's "is this
  // dataset usable" gate. Per-chain validation is the workflow's job — it
  // fetches each chain's CDR3/abundance columns separately and errors if any
  // are missing.
  let hasAaCDR3 = false;
  let hasNtCDR3 = false;
  let hasAbundance = false;

  for (const col of [...perSampleClonotype, ...perClonotype]) {
    const spec = col.spec;

    // Chain identity differs between bulk and SC outputs from MiXCR:
    //   - Bulk: chain in axis domain or column domain via `pl7.app/vdj/chain`.
    //   - SC: chain in column domain via `pl7.app/vdj/scClonotypeChain`
    //         (letter "A"/"B"; map to IGHeavy/IGLight). Skip secondary
    //         alleles — only the primary allele counts as a valid input
    //         (matches sequence-properties' deviation A).
    let chain: string | undefined;
    if (isSC) {
      const idx = spec.domain?.["pl7.app/vdj/scClonotypeChain/index"];
      if (idx !== undefined && idx !== "primary") continue;
      const letter = spec.domain?.["pl7.app/vdj/scClonotypeChain"];
      if (letter) chain = SC_CHAIN_FROM_LETTER[letter];
    } else {
      chain =
        spec.domain?.["pl7.app/vdj/chain"] ??
        spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"] ??
        spec.axesSpec[0]?.domain?.["pl7.app/vdj/chain"];
    }
    if (chain) chains.add(chain);

    if (spec.name === "pl7.app/vdj/sequence" && spec.domain?.["pl7.app/vdj/feature"] === "CDR3") {
      const alphabet = spec.domain?.["pl7.app/alphabet"];
      if (alphabet === "aminoacid") hasAaCDR3 = true;
      if (alphabet === "nucleotide") hasNtCDR3 = true;
    }
    if (spec.annotations?.["pl7.app/isAbundance"] === "true") hasAbundance = true;
  }

  return {
    chains: Array.from(chains).sort(),
    hasAaCDR3,
    hasNtCDR3,
    hasAbundance,
    clonotypeKeyAxisName,
  };
}
