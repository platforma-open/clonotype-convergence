import {
  BlockStorageFacadeCallbacks,
  createBlockStorage,
  createColumnValueId,
  createGlobalPObjectId,
  stringifyJson,
} from "@platforma-sdk/model";
import { beforeAll, describe, expect, test } from "vitest";

const callbackRegistry: Record<string, (storageJson: string) => unknown> = {};

beforeAll(async () => {
  Object.assign(globalThis, { cfgRenderCtx: { callbackRegistry } });
  await import("./index");
});

const dataset = createGlobalPObjectId("mixcr", "abundance");

const subset = createGlobalPObjectId("labeling", "labels.F");
const pgenHeavy = createGlobalPObjectId("genprob", "pgen.A");
const pgenLight = createGlobalPObjectId("genprob", "pgen.B");
const timepoint = createGlobalPObjectId("samples", "metadata.timepoint");
const donor = createGlobalPObjectId("samples", "metadata.donor");
const day7 = createColumnValueId({ column: timepoint, value: "day 7" });

const heavyFacts = {
  chains: ["IGHeavy"],
  hasAaCDR3: true,
  hasNtCDR3: true,
  hasAbundance: true,
  clonotypeKeyAxisName: "pl7.app/vdj/clonotypeKey",
  hasPgenHeavy: false,
  hasPgenLight: false,
};

const scPairedFacts = {
  ...heavyFacts,
  chains: ["IGHeavy", "IGLight"],
  clonotypeKeyAxisName: "pl7.app/vdj/scClonotypeKey",
};

const configured = {
  datasetRef: dataset,
  datasetFacts: heavyFacts,
  thresholdH: 0.000961,
  nMin: 100,
  alpha: 0.005,
  applyClusterFilter: false,
  clusterMin: 10,
  expectedValues: [],
  customBlockLabel: "",
};

describe("args issues", () => {
  test("a configured block derives runnable args", () => {
    expect(deriveArgs(configured)).toMatchObject({
      value: { chainH: dataset, chainHName: "IGHeavy", thresholdH: 0.000961, nMin: 100 },
      issues: [],
    });
  });

  test("without a dataset the args still derive, and Run is blocked", () => {
    const { datasetRef: _, datasetFacts: __, ...data } = configured;
    expect(deriveArgs(data)).toEqual({
      error: "Select a dataset",
      args: expect.objectContaining({ nMin: 100, applyClusterFilter: false }),
      issues: [{ severity: "error", message: "Select a dataset" }],
    });
  });

  test.for([
    {
      why: "a dataset picked without its details",
      data: { ...configured, datasetFacts: undefined },
      message: "Select a dataset",
    },
    {
      why: "missing amino-acid CDR3 columns",
      data: { ...configured, datasetFacts: { ...heavyFacts, hasAaCDR3: false } },
      message:
        "This dataset has no amino-acid and nucleotide CDR3 columns — convergence needs both",
    },
    {
      why: "missing CDR3 columns",
      data: { ...configured, datasetFacts: { ...heavyFacts, hasNtCDR3: false } },
      message:
        "This dataset has no amino-acid and nucleotide CDR3 columns — convergence needs both",
    },
    {
      why: "missing abundance",
      data: { ...configured, datasetFacts: { ...heavyFacts, hasAbundance: false } },
      message: "This dataset has no abundance column",
    },
    {
      why: "no BCR chain",
      data: { ...configured, datasetFacts: { ...heavyFacts, chains: [] } },
      message: "No BCR chain detected in this dataset — re-select it to refresh",
    },
    {
      why: "no heavy threshold",
      data: { ...configured, thresholdH: undefined },
      message: "Heavy-chain threshold is required",
    },
    {
      why: "no light threshold on a bulk-light dataset",
      data: { ...configured, datasetFacts: { ...heavyFacts, chains: ["IGLight"] } },
      message: "Light-chain threshold is required",
    },
    {
      why: "no light threshold with the SC light chain opted in",
      data: {
        ...configured,
        processLightChain: true,
        datasetFacts: { ...heavyFacts, chains: ["IGHeavy", "IGLight"] },
      },
      message: "Light-chain threshold is required",
    },
    {
      why: "no nMin",
      data: { ...configured, nMin: undefined },
      message: "Minimum unique CDR3 per sample is required",
    },
    {
      why: "cluster filter on without its minimum",
      data: { ...configured, applyClusterFilter: true, clusterMin: undefined },
      message: "Minimum cluster size is required",
    },
  ])("$why blocks Run with its message", ({ data, message }) => {
    expect(deriveArgs(data)).toMatchObject({
      error: message,
      issues: [{ severity: "error", message }],
    });
  });

  test("a light chain that is not opted in needs no light threshold", () => {
    const data = { ...configured, datasetFacts: { ...heavyFacts, chains: ["IGHeavy", "IGLight"] } };
    expect(deriveArgs(data)).toMatchObject({ issues: [] });
  });

  test("the cluster minimum is not needed while the filter is off", () => {
    expect(deriveArgs({ ...configured, clusterMin: undefined })).toMatchObject({ issues: [] });
  });

  test("an empty expected value list is runnable", () => {
    const expectedFilterRef = createGlobalPObjectId("samples", "metadata.timepoint");
    expect(deriveArgs({ ...configured, expectedFilterRef })).toMatchObject({
      value: { expectedFilterRef },
      issues: [],
    });
  });
});

describe("args", () => {
  test("a subset is passed as its column id, the value the outputs are stamped with", () => {
    expect(deriveArgs({ ...configured, filterRef: subset })).toMatchObject({
      value: { inputFilter: subset },
    });
  });

  test("a chain with Generation Probability carries its Pgen column id", () => {
    const datasetFacts = { ...heavyFacts, hasPgenHeavy: true, pgenRefHeavy: pgenHeavy };
    expect(deriveArgs({ ...configured, datasetFacts })).toMatchObject({
      value: { hasPgenHeavy: true, pgenRefHeavy: pgenHeavy },
    });
  });

  test("SC paired with the light chain opted in processes both chains off the same anchor", () => {
    const datasetFacts = { ...scPairedFacts, hasPgenLight: true, pgenRefLight: pgenLight };
    const data = { ...configured, datasetFacts, processLightChain: true, thresholdL: 0.03 };
    expect(deriveArgs(data)).toMatchObject({
      value: {
        chainH: dataset,
        chainHScLetter: "A",
        chainL: dataset,
        chainLName: "IGLight",
        chainLScLetter: "B",
        thresholdL: 0.03,
        hasPgenLight: true,
        pgenRefLight: pgenLight,
      },
      issues: [],
    });
  });

  test("SC paired without the opt-in processes the heavy chain only", () => {
    const derived = deriveArgs({ ...configured, datasetFacts: scPairedFacts });
    expect(derived).toMatchObject({ value: { chainH: dataset }, issues: [] });
    expect(derived).not.toHaveProperty("value.chainL");
  });

  test("the expected values go with their column, the grouping on its own", () => {
    const withMetadata = {
      ...configured,
      expectedFilterRef: timepoint,
      expectedValues: [day7],
      groupingRef: donor,
    };
    expect(deriveArgs(withMetadata)).toMatchObject({
      value: { expectedFilterRef: timepoint, expectedValues: [day7], groupingRef: donor },
    });
    expect(deriveArgs({ ...withMetadata, expectedFilterRef: undefined })).not.toHaveProperty(
      "value.expectedValues",
    );
  });
});

// Internals

function deriveArgs(data: unknown): unknown {
  const derive = callbackRegistry[BlockStorageFacadeCallbacks.ArgsDerive];
  if (derive === undefined) throw new Error("The args derive callback is not registered");
  return derive(stringifyJson(createBlockStorage(data)));
}
