import type { PlRef, RenderCtxBase } from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import { isHeavy, isLight, PGEN_NAME, SC_AXIS, SC_CHAIN_FROM_LETTER } from "./chains";
import type { UpstreamFacts } from "./types";

/**
 * Walk the siblings of `ref` on its shared axes and aggregate facts:
 * which chains appear, whether the required CDR3 + abundance siblings
 * are present, and the axis name (drives mode detection).
 */
export function discoverUpstreamFacts<A, U>(
  ctx: RenderCtxBase<A, U>,
  ref: PlRef,
): UpstreamFacts | undefined {
  const refSpec = ctx.resultPool.getPColumnSpecByRef(ref);
  if (!refSpec) return undefined;
  // Name of the second axis = clonotype-key axis. Drives
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
    //         alleles — only the primary allele counts as a valid input.
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

  // Pgen refs — resolve gen-prob's per-clonotype Pgen column(s) for THIS
  // dataset and attribute each to a chain. Uses getOptions (which returns
  // PlRefs — the dependency handle the args lambda needs to make convergence
  // depend on gen-prob) rather than getAnchoredPColumns (specs, no ref).
  // Matched by name + the dataset's OWN clonotype axis, so a Pgen from a
  // different clonotyping run in the same project can't be grabbed. hasPgen*
  // is derived purely from ref presence (single source of truth) so args and
  // the workflow can never disagree — a stale "has Pgen but no ref" would make
  // full-STAR silently produce 0 hits.
  let pgenRefHeavy: PlRef | undefined;
  let pgenRefLight: PlRef | undefined;
  const cloneAxis = refSpec.axesSpec[1];
  if (cloneAxis) {
    const axisKey = (a: { name: string; type: string; domain?: Record<string, string> }) =>
      canonicalize({ name: a.name, type: a.type, domain: a.domain ?? {} } as unknown as Record<
        string,
        unknown
      >);
    const cloneAxisKey = axisKey(cloneAxis);
    // Bulk is single-chain — the (chain-less) Pgen is attributed to whichever
    // chain the dataset carries.
    const bulkChain = isSC ? undefined : Array.from(chains).find((c) => isHeavy(c) || isLight(c));
    for (const opt of ctx.resultPool.getOptions({ name: PGEN_NAME })) {
      const s = ctx.resultPool.getPColumnSpecByRef(opt.ref);
      const a = s?.axesSpec[0];
      if (!s || !a) continue;
      // Same clonotype axis as the dataset ⇒ same clonotyping run.
      if (axisKey(a) !== cloneAxisKey) continue;
      if (isSC) {
        const idx = s.domain?.["pl7.app/vdj/scClonotypeChain/index"];
        if (idx !== undefined && idx !== "primary") continue;
        const letter = s.domain?.["pl7.app/vdj/scClonotypeChain"];
        if (letter === "A") pgenRefHeavy = opt.ref;
        else if (letter === "B") pgenRefLight = opt.ref;
      } else if (isHeavy(bulkChain)) {
        pgenRefHeavy = opt.ref;
      } else if (isLight(bulkChain)) {
        pgenRefLight = opt.ref;
      }
    }
  }

  return {
    chains: Array.from(chains).sort(),
    hasAaCDR3,
    hasNtCDR3,
    hasAbundance,
    clonotypeKeyAxisName,
    hasPgenHeavy: pgenRefHeavy !== undefined,
    hasPgenLight: pgenRefLight !== undefined,
    pgenRefHeavy,
    pgenRefLight,
  };
}
