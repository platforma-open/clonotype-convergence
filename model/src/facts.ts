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
  // Axis name of the second axis = clonotype-key axis. Drives R61
  // mode detection and the BULK-vs-SC handling below.
  const axisName = refSpec.axesSpec[1]?.name ?? "";
  const isSC = axisName === SC_AXIS;

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
  // Track presence flags PER CHAIN — necessary in SC mode where the
  // SAME anchor carries siblings for both heavy and light chains and
  // we need to know whether each chain has its full CDR3 + abundance
  // sibling set. In bulk mode there's only one chain so this
  // collapses to the old behaviour.
  const hasAaCDR3: Record<string, boolean> = {};
  const hasNtCDR3: Record<string, boolean> = {};
  const hasAbundance: Record<string, boolean> = {};

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

    // Track per-chain sibling presence. `chain ?? ""` buckets
    // chain-agnostic siblings under "" — useful for bulk where the
    // chain is implicit on the anchor itself.
    const key = chain ?? "";
    if (spec.name === "pl7.app/vdj/sequence" && spec.domain?.["pl7.app/vdj/feature"] === "CDR3") {
      const alphabet = spec.domain?.["pl7.app/alphabet"];
      if (alphabet === "aminoacid") hasAaCDR3[key] = true;
      if (alphabet === "nucleotide") hasNtCDR3[key] = true;
    }
    if (spec.annotations?.["pl7.app/isAbundance"] === "true") {
      hasAbundance[key] = true;
    }
  }

  // Bulk mode: presence flags hang under the lone detected chain (or
  // "" for chain-agnostic). Reduce to scalars by ORing across keys.
  const anyTrue = (m: Record<string, boolean>) => Object.values(m).some(Boolean);

  return {
    chains: Array.from(chains).sort(),
    hasAaCDR3: anyTrue(hasAaCDR3),
    hasNtCDR3: anyTrue(hasNtCDR3),
    hasAbundance: anyTrue(hasAbundance),
    axisName,
  };
}
