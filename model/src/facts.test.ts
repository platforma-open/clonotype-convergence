import { describe, expect, test } from "vitest";
import { toColumnId } from "./columns";
import { pgenUsableFor } from "./facts";

const F = toColumnId({ __isRef: true, blockId: "labeling", name: "labels.F" });
const G = toColumnId({ __isRef: true, blockId: "labeling", name: "labels.G" });

describe("pgenUsableFor", () => {
  test.for([
    { pgen: undefined, run: undefined, usable: true, why: "full-data Pgen, full-data run" },
    { pgen: undefined, run: F, usable: true, why: "full-data Pgen serves any subset" },
    { pgen: F, run: F, usable: true, why: "subset Pgen, same subset" },
    { pgen: F, run: undefined, usable: false, why: "subset Pgen, full-data run" },
    { pgen: F, run: G, usable: false, why: "subset Pgen, a different subset" },
  ])("$why", ({ pgen, run, usable }) => {
    expect(pgenUsableFor(pgen, run)).toBe(usable);
  });
});

describe("toColumnId", () => {
  test("is the pool's canonical id, the value Generation Probability stamps", () => {
    expect(toColumnId({ __isRef: true, blockId: "b", name: "n" })).toBe(
      '{"__isRef":true,"blockId":"b","name":"n"}',
    );
  });
});
