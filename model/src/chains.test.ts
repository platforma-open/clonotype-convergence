import { createPlDataTableStateV2 } from "@platforma-sdk/model";
import { describe, expect, test } from "vitest";
import { getDefaultBlockLabel, keptIsotypes } from "./chains";
import type { BlockData, UpstreamFacts } from "./types";

const facts = (hasIsotype: boolean | undefined): UpstreamFacts => ({
  chains: ["IGHeavy"],
  hasAaCDR3: true,
  hasNtCDR3: true,
  hasAbundance: true,
  clonotypeKeyAxisName: "pl7.app/vdj/clonotypeKey",
  hasPgenHeavy: false,
  hasPgenLight: false,
  hasIsotype,
});

const data = (hasIsotype: boolean | undefined, isotypeValues: string[] | undefined) =>
  ({
    datasetFacts: facts(hasIsotype),
    isotypeValues,
    applyClusterFilter: false,
    customBlockLabel: "",
    mainTableState: createPlDataTableStateV2(),
    aggregatedTableState: createPlDataTableStateV2(),
  }) as unknown as BlockData;

describe("keptIsotypes", () => {
  test.for([
    { hasIsotype: true, values: ["IgM", "IgG"], kept: ["IgG", "IgM"], why: "sorted selection" },
    { hasIsotype: true, values: [], kept: undefined, why: "empty selection keeps everything" },
    { hasIsotype: false, values: ["IgG"], kept: undefined, why: "no heavy isotype column" },
    {
      hasIsotype: undefined,
      values: ["IgG"],
      kept: undefined,
      why: "snapshot predates the filter",
    },
  ])("$why", ({ hasIsotype, values, kept }) => {
    expect(keptIsotypes(data(hasIsotype, values))).toEqual(kept);
  });
});

describe("getDefaultBlockLabel — isotypes", () => {
  test.for([
    { values: ["IgG", "IgM"], label: "", why: "the default, in any order, adds nothing" },
    {
      values: [],
      label: "",
      why: "all isotypes adds nothing (pre-filter blocks keep their label)",
    },
    { values: ["IgG"], label: "IgG", why: "a custom selection is named" },
    { values: ["IgM", "IgA", "IgG"], label: "IgA+IgG+IgM", why: "sorted, joined with +" },
  ])("$why", ({ values, label }) => {
    expect(getDefaultBlockLabel(data(true, values))).toBe(label);
  });
});
