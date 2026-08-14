/*
  End-to-end block test (review finding 4a, spec M2 "wired end-to-end").

  Builds a real project — Samples & Data → MiXCR Clonotyping → this block — and
  asserts the part that only an integration run can reach: that the per-sample
  fan-out, the per-mode aggregation stage and the export wiring actually produce
  the clonotype-only convergence family the downstream repertoire score / lead
  selection consume.

  What is checked:
   - the block discovers the MiXCR dataset and its facts (the snapshot the args
     lambda validates from), on the same path the Settings picker uses;
   - a fast-STAR-only chain (no Generation Probability upstream) emits
     nbFreq / fastStar / fastStarReproducibility on the CLONOTYPE-only axis
     (no sampleId), plus the per-sample family for the QC table;
   - the reproducibility ratio lands in [0,1] and is a multiple of 1/D over the
     donor cohort defined by the independence grouping;
   - the aggregated Main table and the per-sample QC table both render.

  GAP (not covered here): the full-STAR path — it needs the Generation
  Probability block upstream, whose Pgen column is full-STAR's input. See the
  second test below.
*/

import { blockSpec as clonotypingBlockSpec } from "@platforma-open/milaboratories.mixcr-clonotyping-2";
import { SamplesAndDataBlockPointer } from "@platforma-open/milaboratories.samples-and-data";
import { createPlDataTableStateV2, uniquePlId } from "@platforma-sdk/model";
import { awaitStableState, blockTest } from "@platforma-sdk/test";
import canonicalize from "canonicalize";
import { ClonotypeConvergenceBlockPointer } from "this-block";

const CONV_PREFIX = "pl7.app/vdj/convergence/";
const AGGREGATED_FAST = [
  `${CONV_PREFIX}nbFreq`,
  `${CONV_PREFIX}fastStar`,
  `${CONV_PREFIX}fastStarReproducibility`,
];

/** Set up Samples & Data with the three bulk IGH samples, two of which share a
 *  donor — so the independence grouping has something to collapse (Level 1) and
 *  the reproducibility cohort D is 2, not 3. */
async function setUpSamplesAndData(project: any, helpers: any) {
  const sndBlockId = await project.addBlock("Samples & Data", SamplesAndDataBlockPointer);

  const metaColumnDonorId = uniquePlId();
  const metaColumnTimepointId = uniquePlId();
  const datasetId = uniquePlId();

  const s652 = uniquePlId();
  const s663 = uniquePlId();
  const s664 = uniquePlId();
  const handles = {
    s652R1: await helpers.getLocalFileHandle("./assets/SRR11233652_sampledBulk_R1.fastq.gz"),
    s652R2: await helpers.getLocalFileHandle("./assets/SRR11233652_sampledBulk_R2.fastq.gz"),
    s663R1: await helpers.getLocalFileHandle("./assets/SRR11233663_sampledBulk_R1.fastq.gz"),
    s663R2: await helpers.getLocalFileHandle("./assets/SRR11233663_sampledBulk_R2.fastq.gz"),
    s664R1: await helpers.getLocalFileHandle("./assets/SRR11233664_sampledBulk_R1.fastq.gz"),
    s664R2: await helpers.getLocalFileHandle("./assets/SRR11233664_sampledBulk_R2.fastq.gz"),
  };

  // Samples & Data is a V3 block (modelAPIVersion 2): setBlockArgs hardcodes
  // version 1 and throws, so drive it through its block DATA instead. The
  // branded PlId does not unify across the facade .d.ts boundary and the
  // mutate value is typed `unknown`, so the literal is constructed directly.
  await project.mutateBlockStorage(sndBlockId, {
    operation: "update-block-data",
    value: {
      suggestedImport: false,
      h5adFilesToPreprocess: [],
      seuratFilesToPreprocess: [],
      metadata: [
        {
          id: metaColumnDonorId,
          label: "Donor",
          global: false,
          valueType: "String",
          // Two samples of Donor-02 → one unit holding m = 2 samples.
          data: { [s652]: "Donor-01", [s663]: "Donor-02", [s664]: "Donor-02" },
        },
        {
          id: metaColumnTimepointId,
          label: "Timepoint",
          global: false,
          valueType: "String",
          data: { [s652]: "Day 7", [s663]: "Day 0", [s664]: "Day 7" },
        },
      ],
      sampleIds: [s652, s663, s664],
      sampleLabelColumnLabel: "Sample Name",
      sampleLabels: { [s652]: "SRR11233652", [s663]: "SRR11233663", [s664]: "SRR11233664" },
      datasets: [
        {
          id: datasetId,
          label: "Dataset 1",
          content: {
            type: "Fastq",
            readIndices: ["R1", "R2"],
            gzipped: true,
            data: {
              [s652]: { R1: handles.s652R1, R2: handles.s652R2 },
              [s663]: { R1: handles.s663R1, R2: handles.s663R2 },
              [s664]: { R1: handles.s664R1, R2: handles.s664R2 },
            },
          },
        },
      ],
    },
  });

  await project.runBlock(sndBlockId);
  await helpers.awaitBlockDone(sndBlockId, 100000);
  await helpers.awaitBlockDoneAndGetStableBlockState(sndBlockId, 200000);
  return sndBlockId;
}

/** Run MiXCR clonotyping on the imported dataset, heavy chain only. Also V3, so
 *  it is driven through its block data (BlockArgs + tableState + runMode). */
async function runClonotyping(project: any, helpers: any) {
  const clonotypingBlockId = await project.addBlock("MiXCR Clonotyping", clonotypingBlockSpec);
  // awaitStableState is generic over the block's state and resolves `unknown`
  // for an untyped upstream block, so the shape is asserted here.
  const state = (await awaitStableState(project.getBlockState(clonotypingBlockId), 200000)) as {
    outputs?: Record<string, any>;
  };
  const outputs = state.outputs ?? {};
  const inputOptions = outputs.inputOptions?.value ?? outputs.inputOptions ?? [];
  if (inputOptions.length === 0) throw new Error("MiXCR offered no input dataset");

  await project.mutateBlockStorage(clonotypingBlockId, {
    operation: "update-block-data",
    value: {
      defaultBlockLabel: "",
      customBlockLabel: "",
      input: inputOptions[0].ref,
      preset: { type: "name", name: "neb-human-rna-xcr-umi-nebnext" },
      chains: ["IGHeavy"],
      tableState: createPlDataTableStateV2(),
      runMode: "full",
    },
  });

  await project.runBlock(clonotypingBlockId);
  await helpers.awaitBlockDoneAndGetStableBlockState(clonotypingBlockId, 900000);
  return clonotypingBlockId;
}

/** The Settings-panel pick, headless: choose the dataset and snapshot its facts
 *  and label in the same write, exactly like onPickDataset does. Returns the
 *  BlockData the block would hold after the pick. */
function pickDataset(outputs: Record<string, any>, opts: { groupingRef?: unknown } = {}) {
  const datasetOptions = outputs.datasetOptions?.value ?? outputs.datasetOptions ?? [];
  const option = datasetOptions[0];
  if (!option) throw new Error("convergence offered no input dataset");
  const factsByRef = outputs.factsByRef?.value ?? outputs.factsByRef ?? {};
  const facts = factsByRef[canonicalize(option.ref as Record<string, unknown>)!];
  if (!facts) throw new Error("no dataset facts for the offered dataset");
  return {
    datasetRef: option.ref,
    datasetFacts: facts,
    datasetLabel: option.label,
    processLightChain: false,
    // A permissive threshold: the shipped default (0.000961, calibrated on full
    // human IgH repertoires) produces no hits on a few-hundred-read fixture, and
    // a run with zero hits would not exercise the reproducibility numerator.
    thresholdH: 1e-9,
    // The fixtures are subsampled FASTQs — a few hundred reads per sample — so
    // the shipped nMin (100 unique nt CDR3s) would skip every sample and the
    // block would legitimately aggregate nothing. The floor is a QC knob, not
    // what this test is about.
    nMin: 1,
    alpha: 0.005,
    applyClusterFilter: false,
    clusterMin: 10,
    expectedValues: [],
    groupingRef: opts.groupingRef,
    settingsOpen: false,
    logsOpen: false,
    mainTableState: createPlDataTableStateV2(),
    aggregatedTableState: createPlDataTableStateV2(),
    graphStateAggregated: { title: "Score distribution", template: "bins", currentTab: null },
    graphStatePerSample: { title: "Per-sample distribution", template: "bins", currentTab: null },
    customBlockLabel: "",
  };
}

/** Read the block's outputs after its workflow is done, polling until they
 *  carry what we assert on.
 *
 *  Deliberately NOT `awaitStableState`: that waits for EVERY computable in the
 *  block state to settle, including the PFrame handles this block hands to its
 *  chart pages (`createPFrame`). A PFrame handle reports `no_data` until the
 *  driver has pulled every column behind it, which never happens unprompted in
 *  a headless run — so the whole-state wait times out even though the workflow
 *  finished and the outputs are correct. The values below are settled once the
 *  workflow is done; we poll for them and assert on the plain value. */
async function readOutputsWhen(
  project: any,
  blockId: string,
  ready: (outputs: Record<string, any>) => boolean,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let outputs: Record<string, any> = {};
  for (;;) {
    const state = await project.getBlockState(blockId).getValue();
    outputs = (state?.outputs ?? {}) as Record<string, any>;
    if (ready(outputs) || Date.now() > deadline) return outputs;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/** Unwrap a model output. `outputWithStatus` outputs arrive as
 *  `{ ok, value, ... }`, so a missing value reads as `{ ok: true, value:
 *  undefined }` — not as `undefined`. Plain outputs arrive bare. */
function val(outputs: Record<string, any>, key: string) {
  const o = outputs[key];
  return o && typeof o === "object" && "value" in o ? o.value : o;
}

/** Specs of the p-columns behind a model table/pframe output, by column name. */
function specsByName(pcols: readonly { spec: { name: string } }[] | undefined) {
  const byName = new Map<string, { spec: any }[]>();
  for (const c of pcols ?? []) {
    const list = byName.get(c.spec.name) ?? [];
    list.push(c as { spec: any });
    byName.set(c.spec.name, list);
  }
  return byName;
}

blockTest(
  "bulk IGH without Generation Probability: fast-STAR only, aggregated to the clonotype axis",
  { timeout: 1500000 },
  async ({ rawPrj: project, ml, helpers, expect }) => {
    await setUpSamplesAndData(project, helpers);
    await runClonotyping(project, helpers);

    const convergenceBlockId = await project.addBlock(
      "Clonotype Convergence",
      ClonotypeConvergenceBlockPointer,
    );
    const discovered = await awaitStableState(project.getBlockState(convergenceBlockId), 300000);
    const discoveredOutputs = discovered.outputs as Record<string, any>;

    // The dataset gate + the facts snapshot the args lambda validates from.
    const blockData = pickDataset(discoveredOutputs);
    expect(blockData.datasetFacts.hasAaCDR3, "aa CDR3 discovered").toBe(true);
    expect(blockData.datasetFacts.hasNtCDR3, "nt CDR3 discovered").toBe(true);
    expect(blockData.datasetFacts.chains, "heavy chain detected").toContain("IGHeavy");
    // No Generation Probability block in this project → fast-STAR only.
    expect(blockData.datasetFacts.hasPgenHeavy, "no Pgen upstream").toBe(false);

    // Pick a donor column so the aggregation runs its two-level path.
    const metadataOptions = await (async () => {
      await project.mutateBlockStorage(convergenceBlockId, {
        operation: "update-block-data",
        value: blockData,
      });
      const s = await awaitStableState(project.getBlockState(convergenceBlockId), 120000);
      const o = s.outputs as Record<string, any>;
      return o.metadataOptions?.value ?? o.metadataOptions ?? [];
    })();
    const donorOption = metadataOptions.find((o: any) => o.label?.includes("Donor"));
    expect(donorOption, "Donor metadata column offered").toBeDefined();

    await project.mutateBlockStorage(convergenceBlockId, {
      operation: "update-block-data",
      value: { ...blockData, groupingRef: donorOption.ref },
    });

    await project.runBlock(convergenceBlockId);
    await helpers.awaitBlockDone(convergenceBlockId, 900000);
    const outputs = await readOutputsWhen(
      project,
      convergenceBlockId,
      (o) => {
        const cols = val(o, "aggregatedDistributionPfPcols");
        return (
          Array.isArray(cols) &&
          AGGREGATED_FAST.every((n) => cols.some((c: any) => c.spec.name === n))
        );
      },
      300000,
    );

    // --- the exported, clonotype-only family ---------------
    const aggregated = val(outputs, "aggregatedDistributionPfPcols");
    const aggregatedByName = specsByName(aggregated);
    for (const name of AGGREGATED_FAST) {
      const cols = aggregatedByName.get(name);
      expect(cols, `${name} is emitted`).toBeDefined();
      // Clonotype-only: the aggregation collapsed the sampleId axis away.
      for (const c of cols!) {
        expect(
          c.spec.axesSpec.map((a: any) => a.name),
          `${name} keys on the clonotype axis alone`,
        ).not.toContain("pl7.app/sampleId");
      }
    }
    // full-STAR is NOT added on a chain without Pgen.
    expect(aggregatedByName.has(`${CONV_PREFIX}fullStarScore`), "no full-STAR score").toBe(false);
    expect(aggregatedByName.has(`${CONV_PREFIX}fullStar`), "no full-STAR hit").toBe(false);

    // --- the per-sample family stays available for QC ----------------------
    const perSample = val(outputs, "perSampleDistributionPfPcols");
    const perSampleByName = specsByName(perSample);
    expect(perSampleByName.has(`${CONV_PREFIX}neighbours`), "per-sample neighbours").toBe(true);
    for (const c of perSampleByName.get(`${CONV_PREFIX}nbFreq`) ?? []) {
      expect(
        c.spec.axesSpec.map((a: any) => a.name),
        "the per-sample family keeps the sampleId axis",
      ).toContain("pl7.app/sampleId");
    }

    // --- the aggregation produced clonotypes -------------------------------
    // The hit-count badge is computed by the workflow over the aggregated TSV
    // itself, so it is the direct evidence that Stage 4 emitted rows (the table
    // below is a rendering of them, and loads lazily).
    const fastStats = val(outputs, "heavyFastStats");
    expect(fastStats, "fast-STAR hit stats").toBeDefined();
    expect(fastStats.total, "aggregation emitted clonotypes").toBeGreaterThan(0);
    // full-STAR did not run on this chain, so it has no stats.
    expect(val(outputs, "heavyFullStats"), "no full-STAR stats").toBeUndefined();

    // --- both tables render ------------------------------------------------
    expect(outputs.aggregatedTable?.ok, "aggregated (Main) table").toBe(true);
    expect(outputs.mainTable?.ok, "per-sample QC table").toBe(true);
    const handle = val(outputs, "aggregatedTable")?.fullTableHandle;
    expect(handle, "aggregated table handle").toBeDefined();
    const shape = await ml.driverKit.pFrameDriver.getShape(handle);
    expect(shape.rows, "the aggregated table renders the clonotypes").toBe(fastStats.total);

    // --- the reproducibility ratio --------------------------------
    // D = the donor cohort (2 donors here), so every value is k/2 in [0,1].
    const reproId = (aggregated ?? []).find(
      (c: any) => c.spec.name === `${CONV_PREFIX}fastStarReproducibility`,
    )?.columnId;
    expect(reproId, "reproducibility column id").toBeDefined();
    const aggregatedPf = val(outputs, "aggregatedDistributionPf");
    expect(aggregatedPf, "aggregated p-frame handle").toBeDefined();
    const reproData = await ml.driverKit.pFrameDriver.getUniqueValues(aggregatedPf, {
      columnId: reproId,
      filters: [],
      limit: 100,
    });
    const values = [...(reproData?.values.data ?? [])].map(Number);
    expect(values.length, "reproducibility has values").toBeGreaterThan(0);
    for (const v of values) {
      expect(v, "reproducibility in [0,1]").toBeGreaterThanOrEqual(0);
      expect(v, "reproducibility in [0,1]").toBeLessThanOrEqual(1);
      expect(
        Number.isInteger(Math.round(v * 2 * 1e6) / 1e6),
        `reproducibility ${v} is a multiple of 1/D with D = 2 donors`,
      ).toBe(true);
    }
  },
);
