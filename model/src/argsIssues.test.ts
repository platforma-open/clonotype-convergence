import {
  BlockStorageFacadeCallbacks,
  createBlockStorage,
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

const heavyFacts = {
  chains: ["IGHeavy"],
  hasAaCDR3: true,
  hasNtCDR3: true,
  hasAbundance: true,
  clonotypeKeyAxisName: "pl7.app/vdj/clonotypeKey",
  hasPgenHeavy: false,
  hasPgenLight: false,
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

// Internals

function deriveArgs(data: unknown): unknown {
  const derive = callbackRegistry[BlockStorageFacadeCallbacks.ArgsDerive];
  if (derive === undefined) throw new Error("The args derive callback is not registered");
  return derive(stringifyJson(createBlockStorage(data)));
}
