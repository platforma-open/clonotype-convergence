import type { AxisSpec, ColumnRecipe, ColumnUniversalId } from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import {
  isHeavy,
  isLight,
  PGEN_NAME,
  SC_AXIS,
  SC_CHAIN_FROM_LETTER,
  inputSubsetOf,
} from "./chains";
import { axisSelector, exact, findColumn, resultPool } from "./columns";
import type { UpstreamFacts } from "./types";

/**
 * Whether a Pgen stamped with `pgenSubset` (undefined = computed on full data) can serve a run
 * on `subsetId` (undefined = full data). Full-data Pgen always can: Pgen is per sequence. A
 * subset's Pgen only serves that same subset; anywhere else the clonotypes outside it would be
 * untestable.
 */
export function pgenUsableFor(
  pgenSubset: string | undefined,
  subsetId: string | undefined,
): boolean {
  return pgenSubset === undefined || pgenSubset === subsetId;
}

/**
 * Walk the siblings of the dataset on its shared axes and aggregate facts:
 * which chains appear, whether the required CDR3 + abundance siblings
 * are present, and the axis name (drives mode detection). `undefined` while
 * the dataset column is still resolving and once it is gone.
 *
 * `subsetId` is the column id of the subset this block runs on, undefined for a full-data
 * run. A Pgen computed on a subset is taken only for that same subset: for any other input,
 * clonotypes outside it would be untestable, and full-STAR would silently lose their hits.
 * A full-data Pgen is always valid (Pgen is per sequence).
 */
export function discoverUpstreamFacts(
  datasetId: ColumnUniversalId,
  subsetId: ColumnUniversalId | undefined,
): UpstreamFacts | undefined {
  const datasetSpec = findColumn(datasetId)?.getSpec();
  if (!datasetSpec) return undefined;
  const [sampleAxis, cloneAxis] = datasetSpec.axesSpec;
  // Name of the second axis = clonotype-key axis. Drives
  // mode detection and the BULK-vs-SC handling below.
  const clonotypeKeyAxisName = cloneAxis?.name ?? "";
  const isSC = clonotypeKeyAxisName === SC_AXIS;

  const chains = new Set<string>();
  // Aggregate (dataset-level) presence: does the dataset carry ANY aa-CDR3 /
  // nt-CDR3 / abundance sibling? These feed only the args issues. Per-chain
  // validation is the workflow's job — it fetches each chain's CDR3/abundance
  // columns separately and errors if any are missing.
  let hasAaCDR3 = false;
  let hasNtCDR3 = false;
  let hasAbundance = false;

  for (const column of siblingColumns(sampleAxis, cloneAxis)) {
    const spec = column.getSpec();

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

  // Pgen columns — gen-prob's per-clonotype Pgen column(s) for THIS dataset,
  // each attributed to a chain. Their result-pool ids are the dependency
  // handle the args lambda needs to make convergence depend on gen-prob.
  // Matched by name + the dataset's OWN clonotype axis, so a Pgen from a
  // different clonotyping run in the same project can't be grabbed. hasPgen*
  // is derived purely from id presence (single source of truth) so args and
  // the workflow can never disagree — a stale "has Pgen but no id" would make
  // full-STAR silently produce 0 hits.
  let pgenRefHeavy: ColumnUniversalId | undefined;
  let pgenRefLight: ColumnUniversalId | undefined;
  if (cloneAxis) {
    const cloneAxisKey = axisKey(cloneAxis);
    // Bulk is single-chain — the (chain-less) Pgen is attributed to whichever
    // chain the dataset carries.
    const bulkChain = isSC ? undefined : Array.from(chains).find((c) => isHeavy(c) || isLight(c));
    const pgenColumns = resultPool()
      .filter({ include: { name: [exact(PGEN_NAME)] } })
      .getColumns();
    for (const pgen of pgenColumns) {
      const s = pgen.getSpec();
      const a = s.axesSpec[0];
      if (!a) continue;
      // Same clonotype axis as the dataset ⇒ same clonotyping run.
      if (axisKey(a) !== cloneAxisKey) continue;
      // Generation Probability stamps a subset run's Pgen with `pl7.app/inputSubset`.
      if (!pgenUsableFor(inputSubsetOf(s.domain), subsetId)) continue;
      if (isSC) {
        const idx = s.domain?.["pl7.app/vdj/scClonotypeChain/index"];
        if (idx !== undefined && idx !== "primary") continue;
        const letter = s.domain?.["pl7.app/vdj/scClonotypeChain"];
        if (letter === "A") pgenRefHeavy = pgen.id;
        else if (letter === "B") pgenRefLight = pgen.id;
      } else if (isHeavy(bulkChain)) {
        pgenRefHeavy = pgen.id;
      } else if (isLight(bulkChain)) {
        pgenRefLight = pgen.id;
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

// Internals

/**
 * Columns of the dataset's clonotyping run. MiXCR partitions its outputs
 * across two axis frames: per-(sample, clonotype) and per-clonotype, so both
 * are matched exactly. Only specs are read, never data, so columns another
 * block is still computing on the same axes cost nothing.
 */
function siblingColumns(
  sampleAxis: AxisSpec | undefined,
  cloneAxis: AxisSpec | undefined,
): ColumnRecipe[] {
  if (sampleAxis === undefined || cloneAxis === undefined) return [];
  return resultPool()
    .filter({
      include: [
        { axes: [axisSelector(sampleAxis), axisSelector(cloneAxis)], partialAxesMatch: false },
        { axes: [axisSelector(cloneAxis)], partialAxesMatch: false },
      ],
    })
    .getColumns();
}

/** An axis identity: name, type and domain. */
function axisKey(axis: AxisSpec): string | undefined {
  return canonicalize({ name: axis.name, type: axis.type, domain: axis.domain ?? {} });
}
