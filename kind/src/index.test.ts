import {
  createColumnValueId,
  createGlobalPObjectId,
  createLocalPObjectId,
} from "@platforma-sdk/model";
import { describe, expect, test } from "vitest";
import { kind } from "./index";

const parse = (params: unknown) => kind.parseInitializationParams(params);

const REF = { __isRef: true, blockId: "mixcr", name: "clonotypes.abundance" };
const DATASET = createGlobalPObjectId("mixcr", "clonotypes.abundance");
const TIMEPOINT = createGlobalPObjectId("samples", "metadata.timepoint");
const DAY_7 = createColumnValueId({ column: TIMEPOINT, value: "day 7" });

describe.each(["datasetRef", "filterRef", "expectedFilterRef", "groupingRef"] as const)(
  "%s",
  (field) => {
    test("accepts the result-pool id of another block's output", () => {
      expect(parse({ [field]: DATASET })).toMatchObject({ [field]: DATASET });
    });

    test.each([
      ["a ref object, which earlier versions of the kind took", REF],
      ["a column id that is not another block's output", createLocalPObjectId(["main"], "x")],
      ["a string that is not a column id", "clonotypes.abundance"],
      ["a column value id rather than a column", DAY_7],
      ["a number", 42],
      ["null", null],
    ])("rejects %s", (_label, bad) => {
      expect(() => parse({ [field]: bad })).toThrow(`'${field}' must be an upstream column`);
    });
  },
);

describe("expectedValues", () => {
  test.each([
    ["an empty array, as an unconfigured block has", []],
    ["column value ids", [DAY_7, createColumnValueId({ column: TIMEPOINT, value: "day 30" })]],
  ])("accepts %s", (_label, expectedValues) => {
    expect(parse({ expectedValues })).toMatchObject({ expectedValues });
  });

  test.each([
    ["plain values, which earlier versions of the kind took", ["day 7"]],
    ["a bare column value id", DAY_7],
    ["an array holding a column id", [DAY_7, TIMEPOINT]],
  ])("rejects %s", (_label, expectedValues) => {
    expect(() => parse({ expectedValues })).toThrow("'expectedValues' must be an array");
  });
});

describe("the whole contract", () => {
  test("an empty object is a valid half-configured block", () => {
    expect(parse({})).toEqual({
      datasetRef: undefined,
      filterRef: undefined,
      processLightChain: undefined,
      thresholdH: undefined,
      thresholdL: undefined,
      nMin: undefined,
      alpha: undefined,
      applyClusterFilter: undefined,
      clusterMin: undefined,
      expectedFilterRef: undefined,
      expectedValues: undefined,
      groupingRef: undefined,
      customBlockLabel: undefined,
    });
  });

  test("a fully configured block round-trips", () => {
    const params = {
      datasetRef: DATASET,
      filterRef: createGlobalPObjectId("labeling", "labels.F"),
      processLightChain: true,
      thresholdH: 0.000961,
      thresholdL: 0.03,
      nMin: 100,
      alpha: 0.005,
      applyClusterFilter: true,
      clusterMin: 10,
      expectedFilterRef: TIMEPOINT,
      expectedValues: [DAY_7],
      groupingRef: createGlobalPObjectId("samples", "metadata.donor"),
      customBlockLabel: "Mine",
    };
    expect(parse(params)).toEqual(params);
  });

  test.each([
    ["processLightChain", "yes", "'processLightChain' must be a boolean"],
    ["thresholdH", "0.1", "'thresholdH' must be a number"],
    ["customBlockLabel", 7, "'customBlockLabel' must be a string"],
  ])("rejects a wrong %s", (field, bad, message) => {
    expect(() => parse({ [field]: bad })).toThrow(message);
  });
});
