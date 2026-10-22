import { kind } from "@platforma-open/milaboratories.clonotype-convergence.kind";
import {
  createColumnValueId,
  createGlobalPObjectId,
  createPlDataTableStateV2,
} from "@platforma-sdk/model";
import { describe, expect, test } from "vitest";
import { blockDataModel } from "./dataModel";

const ref = (blockId: string, name: string) => ({ __isRef: true, blockId, name });

const dataset = ref("mixcr", "abundance");
const subset = ref("labeling", "labels.F");
const pgen = ref("genprob", "pgen");
const timepoint = ref("samples", "metadata.timepoint");
const donor = ref("samples", "metadata.donor");

const storedAtV5 = {
  datasetRef: dataset,
  filterRef: subset,
  datasetFacts: {
    chains: ["IGHeavy"],
    hasAaCDR3: true,
    hasNtCDR3: true,
    hasAbundance: true,
    clonotypeKeyAxisName: "pl7.app/vdj/clonotypeKey",
    hasPgenHeavy: true,
    hasPgenLight: false,
    pgenRefHeavy: pgen,
  },
  datasetLabel: "MiXCR",
  applyClusterFilter: false,
  expectedFilterRef: timepoint,
  expectedValues: ["day 7"],
  groupingRef: donor,
  customBlockLabel: "",
};

describe("v6 migration", () => {
  const { data } = blockDataModel.migrate({ version: "v5", data: storedAtV5 });

  test("refs to upstream outputs become their result-pool ids", () => {
    expect(data.datasetRef).toBe(createGlobalPObjectId("mixcr", "abundance"));
    expect(data.filterRef).toBe(createGlobalPObjectId("labeling", "labels.F"));
    expect(data.datasetFacts?.pgenRefHeavy).toBe(createGlobalPObjectId("genprob", "pgen"));
    expect(data.expectedFilterRef).toBe(createGlobalPObjectId("samples", "metadata.timepoint"));
    expect(data.groupingRef).toBe(createGlobalPObjectId("samples", "metadata.donor"));
  });

  test("plain expected values become values of the converted expected-filter column", () => {
    const column = createGlobalPObjectId("samples", "metadata.timepoint");
    expect(data.expectedValues).toEqual([createColumnValueId({ column, value: "day 7" })]);
  });

  test("picks keep their order and duplicates; numbers become text, column value ids stay", () => {
    const column = createGlobalPObjectId("samples", "metadata.timepoint");
    const picked = createColumnValueId({ column, value: "day 0" });
    const { expectedValues } = blockDataModel.migrate({
      version: "v5",
      data: { ...storedAtV5, expectedValues: ["day 7", picked, "7", "day 7", 3, Number.NaN, null] },
    }).data;
    expect(expectedValues).toEqual([
      createColumnValueId({ column, value: "day 7" }),
      picked,
      createColumnValueId({ column, value: "7" }),
      createColumnValueId({ column, value: "day 7" }),
      createColumnValueId({ column, value: "3" }),
    ]);
  });

  test("plain expected values without an expected-filter column are dropped", () => {
    const migrated = blockDataModel.migrate({
      version: "v5",
      data: { ...storedAtV5, expectedFilterRef: undefined },
    }).data;
    expect(migrated.expectedFilterRef).toBeUndefined();
    expect(migrated.expectedValues).toEqual([]);
  });

  test("both table states are reset, their source id format changed", () => {
    const stale = { ...createPlDataTableStateV2(), pTableParams: { sourceId: "stale" } };
    const migrated = blockDataModel.migrate({
      version: "v5",
      data: { ...storedAtV5, mainTableState: stale, aggregatedTableState: stale },
    }).data;
    expect(migrated.mainTableState).toEqual(createPlDataTableStateV2());
    expect(migrated.aggregatedTableState).toEqual(createPlDataTableStateV2());
  });

  test("the rest of the dataset snapshot is kept", () => {
    expect(data.datasetFacts?.hasPgenHeavy).toBe(true);
    expect(data.datasetFacts?.pgenRefLight).toBeUndefined();
    expect(data.datasetLabel).toBe("MiXCR");
  });

  test("the migrated picks are what the kind accepts", () => {
    const { datasetRef, filterRef, expectedFilterRef, expectedValues, groupingRef } = data;
    expect(() =>
      kind.parseInitializationParams({
        datasetRef,
        filterRef,
        expectedFilterRef,
        expectedValues,
        groupingRef,
      }),
    ).not.toThrow();
    expect(() => kind.parseInitializationParams({ expectedValues: ["day 7"] })).toThrow(
      "'expectedValues' must be an array of column values",
    );
    expect(() => kind.parseInitializationParams({ datasetRef: dataset })).toThrow(
      "'datasetRef' must be an upstream column",
    );
  });

  test("a v1 block reaches the current shape through every step", () => {
    const migrated = blockDataModel.migrate({
      version: "v1",
      data: { mainRef: dataset, applyClusterFilter: false, customBlockLabel: "" },
    }).data;
    expect(migrated.datasetRef).toBe(createGlobalPObjectId("mixcr", "abundance"));
    expect(migrated.expectedValues).toEqual([]);
    expect(migrated.processLightChain).toBe(false);
  });
});
