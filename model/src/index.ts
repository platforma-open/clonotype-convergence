import type { InferOutputsType, PColumnSpec, PlRef, RenderCtxBase } from "@platforma-sdk/model";
import { BlockModelV3, createPlDataTableV3 } from "@platforma-sdk/model";
import canonicalize from "canonicalize";
import { blockDataModel } from "./dataModel";
import type { BlockArgs, BlockData, UpstreamFacts } from "./types";

export type { BlockArgs, BlockData, UpstreamFacts };
export { blockDataModel } from "./dataModel";

// Datasets the dropdown offers — anchors on the clonotype-keyed axes
// (R10). Single-cell variant uses scClonotypeKey instead of clonotypeKey.
const inputAnchorSpecs = [
  {
    axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/clonotypeKey" }],
    annotations: { "pl7.app/isAnchor": "true" },
  },
  {
    axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/scClonotypeKey" }],
    annotations: { "pl7.app/isAnchor": "true" },
  },
];

// MiXCR's chain DOMAIN values (used in `domain["pl7.app/vdj/chain"]` on
// column/axis specs — what we filter against): IGHeavy, IGLight,
// TCRAlpha, TCRBeta, TCRGamma, TCRDelta. From `chainInfos` keys in
// mixcr-clonotyping/workflow/src/process.tpl.tengo.
//
// MiXCR also exposes a `topChains` per-clonotype VALUE column whose
// values are "IGH"/"IGK"/"IGL"/"TRA"/... — those are the codes from the
// `pl7.app/discreteValues` annotation, used for filtering ROWS, not for
// tagging which chain a column belongs to. Spec R28 was based on the
// second namespace and is wrong for our domain queries.

/**
 * Walk the siblings of `ref` on its shared axes and aggregate facts:
 * which chains appear and whether the required CDR3 + abundance siblings
 * are present anywhere among them. Used both by the live `upstreamFacts`
 * output (UI mirror, R9) and by the UI's snapshot writer (R8) — same
 * shape, evaluated on every render against the current pool.
 */
function discoverUpstreamFacts<A, U>(
  ctx: RenderCtxBase<A, U>,
  ref: PlRef,
): UpstreamFacts | undefined {
  // MiXCR partitions its outputs across two axis frames:
  //  - per-(sample, clonotype): abundance columns (axes = [sampleId, clonotypeKey])
  //  - per-clonotype:          CDR3 sequence + V/J + per-clonotype fields (axes = [clonotypeKey])
  // The anchored selector matches axes exactly, so we need both queries.
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
  let hasAaCDR3 = false;
  let hasNtCDR3 = false;
  let hasAbundance = false;

  for (const col of [...perSampleClonotype, ...perClonotype]) {
    const spec = col.spec;
    // Chain lives on column domain (abundance/CDR3 sequence on MiXCR's
    // per-sample table) OR on the clonotype-key axis domain. Try both
    // axes — for the per-clonotype frame the axis is at index 0.
    const chain =
      spec.domain?.["pl7.app/vdj/chain"] ??
      spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"] ??
      spec.axesSpec[0]?.domain?.["pl7.app/vdj/chain"];
    if (chain) chains.add(chain);

    if (spec.name === "pl7.app/vdj/sequence" && spec.domain?.["pl7.app/vdj/feature"] === "CDR3") {
      const alphabet = spec.domain["pl7.app/alphabet"];
      if (alphabet === "aminoacid") hasAaCDR3 = true;
      if (alphabet === "nucleotide") hasNtCDR3 = true;
    }
    if (spec.annotations?.["pl7.app/isAbundance"] === "true") {
      hasAbundance = true;
    }
  }

  return {
    chains: Array.from(chains).sort(),
    hasAaCDR3,
    hasNtCDR3,
    hasAbundance,
  };
}

export const platforma = BlockModelV3.create(blockDataModel)
  .args((data): BlockArgs => {
    if (!data.inputRef) throw new Error("Input dataset is required");
    if (!data.inputDerivedFacts) {
      throw new Error("Input snapshot missing — re-select the input dataset");
    }
    const facts = data.inputDerivedFacts;

    // The dropdown is filtered to IGHeavy anchors, so the picked ref is
    // the dataset's heavy-chain entry. The checks below are a safety net
    // for stale snapshots (upstream changed after the user picked).
    if (facts.chains.length === 0) {
      throw new Error("Selected input has no detectable chain — re-select an input");
    }
    if (facts.chains.length > 1) {
      throw new Error(
        `Selected input spans multiple chains (${facts.chains.join(", ")}); ` +
          "expected a single chain per anchor",
      );
    }

    const chain = facts.chains[0];
    if (chain !== "IGHeavy") {
      throw new Error(
        `Selected input chain is "${chain}", not IGHeavy. ` +
          "Pick the IG Heavy anchor — light-chain processing lands in Phase 7.",
      );
    }

    if (!facts.hasAaCDR3) throw new Error("Selected input has no aa CDR3 column");
    if (!facts.hasNtCDR3) throw new Error("Selected input has no nt CDR3 column");
    if (!facts.hasAbundance) throw new Error("Selected input has no abundance column");

    return {
      inputRef: data.inputRef,
      inputDerivedFacts: facts,
      chain,
      // R16 — paper-calibrated ≈5% FDR threshold on Abbate et al. 2024
      // human IgH reference data. User-tunable in UI.
      threshold: data.threshold ?? 0.000961,
      // R12 — sample-size floor.
      nMin: data.nMin ?? 100,
    };
  })

  // Dropdown candidates: one option per BCR mixcr-clonotyping run, via
  // its IGHeavy anchor (always present in a BCR run, so it's a sound
  // run identifier). The user picks a "dataset" — what they get is the
  // heavy-chain entry for that dataset's clonotyping run.
  //
  // Phase 7 will discover IGLight siblings on the same clonotypingRunId
  // (different axes, different chain domain) when a light-chain picker
  // is added — multi-chain processing from one user pick.
  //
  // TCR and any non-IGHeavy chain are hidden here; args lambda is the
  // final gate. Multi-run label disambiguation is deferred — auto-labels
  // suffice for single-dataset projects.
  .output("datasetOptions", (ctx) => {
    const broad = ctx.resultPool.getOptions(inputAnchorSpecs, { refsWithEnrichments: true });
    return broad.filter((opt) => {
      const spec = ctx.resultPool.getPColumnSpecByRef(opt.ref);
      if (!spec) return false;
      const chain =
        spec.domain?.["pl7.app/vdj/chain"] ?? spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"];
      return chain === "IGHeavy";
    });
  })

  // Live facts about the currently picked ref — feeds the UI's
  // `PlAlert` mirror (R9). Re-derives each render so a stale snapshot
  // surfaces a fresh mismatch banner without waiting for the user to
  // re-touch the dropdown.
  .output("upstreamFacts", (ctx) => {
    if (!ctx.data.inputRef) return undefined;
    return discoverUpstreamFacts(ctx, ctx.data.inputRef);
  })

  // Parallel map keyed by canonical(PlRef) → UpstreamFacts for every
  // candidate dropdown option. The UI dropdown's user-gesture handler
  // reads this to write `data.inputRef` and `data.inputDerivedFacts`
  // in the same tick — the snapshot pattern from model.md, no
  // watcher-driven hairpin (R8).
  .output("factsByRef", (ctx) => {
    const options = ctx.resultPool.getOptions(inputAnchorSpecs, { refsWithEnrichments: true });
    const result: Record<string, UpstreamFacts> = {};
    for (const opt of options) {
      const facts = discoverUpstreamFacts(ctx, opt.ref);
      if (facts) {
        const key = canonicalize(opt.ref as unknown as Record<string, unknown>);
        if (key !== undefined) result[key] = facts;
      }
    }
    return result;
  })

  // Single log handle from Stage 1 (the bulk of per-sample info — drops,
  // unique counts, warnings). Stage 2 logs are exposed separately for
  // Phase 5 to decide on combining vs. picking. R45.
  .output("runLogs", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "stage1Logs",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getLogHandle(),
  )

  .output("stage2Logs", (ctx) =>
    ctx.outputs
      ?.resolve({
        field: "stage2Logs",
        assertFieldType: "Input",
        allowPermanentAbsence: true,
      })
      ?.getLogHandle(),
  )

  .output("isRunning", (ctx) => ctx.outputs?.getIsReadyOrError() === false)

  // Main page table (R52). Anchored discovery from `data.inputRef`;
  // non-convergence columns hidden by default — convergence outputs
  // already carry "default"/"optional" in their pcolumn annotations
  // (R52, pcolumn-schema.md).
  //
  // `withStatus` lets PlAgDataTableV2 render its own loading/error UI
  // by consuming the OutputWithStatus<T> wrapper directly. The "absent
  // cells" flicker mid-run is a known quirk — `retentive: true` would
  // normally suppress it, but enabling retentive on this output causes
  // the table to get stuck in "no previous stable value" perpetually;
  // root cause TBD (likely a SDK interaction with anchored discovery).
  // Phase 6 / a SDK update can revisit.
  .outputWithStatus("mainTable", (ctx) => {
    if (!ctx.data.inputRef) return undefined;
    return createPlDataTableV3(ctx, {
      columns: {
        anchors: { main: ctx.data.inputRef },
        selector: { mode: "enrichment" },
      },
      tableState: ctx.data.mainTableState,
      displayOptions: {
        visibility: [
          // Hide everything by default; convergence outputs flip back
          // to "default" via their own annotation. Phase 5 may refine.
          {
            match: (spec: PColumnSpec) => !spec.name.startsWith("pl7.app/vdj/convergence/"),
            visibility: "hidden",
          },
        ],
      },
    });
  })

  .sections((ctx) => {
    // Heavy-chain histogram page lands in Phase 6. The section entry
    // appears here so the model output shape is stable; the UI plugin
    // renders the actual page once it exists.
    const showHeavy = ctx.data.inputRef !== undefined && ctx.activeArgs !== undefined;
    return [
      { type: "link" as const, href: "/" as const, label: "Clonotypes" },
      ...(showHeavy
        ? [{ type: "link" as const, href: "/convergence/heavy" as const, label: "Heavy chain" }]
        : []),
    ];
  })

  .title(() => "Clonotype Convergence")

  .done();

export type Platforma = typeof platforma;
export type BlockOutputs = InferOutputsType<typeof platforma>;
