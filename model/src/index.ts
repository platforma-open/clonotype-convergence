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

const TCR_CHAINS = new Set(["TRA", "TRB", "TRG", "TRD"]);

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
  // Broad anchored query: every PColumn sharing the input anchor's
  // (sampleId, clonotypeKey) axes. We classify each by spec.
  const siblings = ctx.resultPool.getAnchoredPColumns({ main: ref }, [
    {
      axes: [
        { anchor: "main", idx: 0 },
        { anchor: "main", idx: 1 },
      ],
    },
  ]);
  if (!siblings) return undefined;

  const chains = new Set<string>();
  let hasAaCDR3 = false;
  let hasNtCDR3 = false;
  let hasAbundance = false;

  for (const col of siblings) {
    const spec = col.spec;
    // Chain may live on the column's own domain (CDR3 sequence columns,
    // abundance columns) or be inherited via the clonotype-key axis
    // domain (mixcr-clonotyping puts it on the axis). Try both.
    const chain =
      spec.domain?.["pl7.app/vdj/chain"] ?? spec.axesSpec[1]?.domain?.["pl7.app/vdj/chain"];
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

    // R5: reject TCR datasets (this block is BCR-only).
    const tcrFound = facts.chains.filter((c) => TCR_CHAINS.has(c));
    if (tcrFound.length > 0) {
      throw new Error(
        `Selected dataset contains TCR chains (${tcrFound.join(", ")}); ` +
          "this block is BCR-only. Re-select a BCR clonotyping run.",
      );
    }

    // R6: heavy chain required.
    if (!facts.chains.includes("IGH")) {
      throw new Error("Selected dataset has no heavy-chain (IGH) input — re-select an input");
    }

    // R5: required sibling PColumns must be present somewhere on the axes.
    if (!facts.hasAaCDR3) {
      throw new Error("Selected dataset has no aa CDR3 column");
    }
    if (!facts.hasNtCDR3) {
      throw new Error("Selected dataset has no nt CDR3 column");
    }
    if (!facts.hasAbundance) {
      throw new Error("Selected dataset has no abundance column");
    }

    return {
      inputRef: data.inputRef,
      inputDerivedFacts: facts,
      chain: data.chain ?? "IGH",
      // R16 — paper-calibrated 5% FDR threshold on Abbate et al. 2024
      // human IgH reference data. User-tunable in UI.
      threshold: data.threshold ?? 0.000961,
      // R12 — sample-size floor.
      nMin: data.nMin ?? 100,
    };
  })

  // Dropdown candidates — broad anchor query (R10). Per-candidate
  // BCR-validity filtering is intentionally deferred; the args lambda
  // throws on TCR / missing-IGH / missing-siblings, which prevents
  // running the block on invalid picks even if they appear in the list.
  // Tighter pre-filter is a Phase 5 polish — keeps the UI tidy.
  .output("datasetOptions", (ctx) =>
    ctx.resultPool.getOptions(inputAnchorSpecs, { refsWithEnrichments: true }),
  )

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
