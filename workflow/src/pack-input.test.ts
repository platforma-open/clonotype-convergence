/*
  Whole-dataset preamble (:pack-input), template level — the isotype filter.

  Renders :pack-input through the :test-pack-input harness on hand-made columns
  and reads back which clonotypes were packed.

  Fixture — one sample, six clonotypes:

    key  isotype
    k1   IgG     kept
    k2   IgM     kept
    k3   IgA     dropped: not selected
    k4   (none)  dropped: unknown isotype
    k5   IgE     dropped
    k6   cant_distinguish  dropped: MiXCR's "isotype not resolved" is unknown too
*/

import { tplTest } from "@platforma-sdk/test";
import type { MiddleLayerDriverKit } from "@milaboratories/pl-middle-layer";
import type { PlTreeNodeAccessor } from "@milaboratories/pl-tree";
import type { ComputableCtx } from "@milaboratories/computable";

const KEYS = ["k1", "k2", "k3", "k4", "k5", "k6"];

const CDR3_TSV = [
  "clonotypeKey\taaSeqCDR3\tnSeqCDR3",
  ...KEYS.map((k, i) => `${k}\tCARAA${i}W\tTGTAA${i}`),
].join("\n");

const ABUNDANCE_TSV = [
  "sampleId\tclonotypeKey\tabundance",
  ...KEYS.map((k) => `s1\t${k}\t10`),
].join("\n");

// k4 has no row at all: the column has no value for it.
const ISOTYPE_TSV = [
  "clonotypeKey\tisotype",
  "k1\tIgG",
  "k2\tIgM",
  "k3\tIgA",
  "k5\tIgE",
  "k6\tcant_distinguish",
].join("\n");

async function packedKeys(
  helper: any,
  driverKit: MiddleLayerDriverKit,
  opts: { isotypeTsv?: string; isotypeValues?: string[] },
): Promise<string[]> {
  const result = await helper.renderTemplate(
    true,
    "test-pack-input",
    ["packedTsv"],
    (tx: any) => ({
      cdr3Tsv: helper.createObject(tx, CDR3_TSV),
      abundanceTsv: helper.createObject(tx, ABUNDANCE_TSV),
      ...(opts.isotypeTsv !== undefined && {
        isotypeTsv: helper.createObject(tx, opts.isotypeTsv),
        isotypeValues: helper.createObject(tx, opts.isotypeValues ?? []),
      }),
    }),
  );

  const handle = await result
    .computeOutput("packedTsv", (acc: PlTreeNodeAccessor | undefined, ctx: ComputableCtx) => {
      if (!acc) return undefined;
      return driverKit.blobDriver.getOnDemandBlob(acc.persist(), ctx).handle;
    })
    .awaitStableValue();

  const lines = (await driverKit.blobDriver.getContent(handle!)).toString().trim().split("\n");
  const keyIdx = lines[0].split("\t").indexOf("clonotypeKey");
  return lines
    .slice(1)
    .map((l) => l.split("\t")[keyIdx])
    .sort();
}

tplTest(
  "pack-input: the isotype filter keeps only the selected isotypes, dropping unknown ones",
  async ({ helper, expect, driverKit }) => {
    const keys = await packedKeys(helper, driverKit, {
      isotypeTsv: ISOTYPE_TSV,
      isotypeValues: ["IgG", "IgM"],
    });
    expect(keys).toEqual(["k1", "k2"]);
  },
);

tplTest("pack-input: without an isotype filter every clonotype is packed", async ({
  helper,
  expect,
  driverKit,
}) => {
  const keys = await packedKeys(helper, driverKit, {});
  expect(keys).toEqual(KEYS);
});
