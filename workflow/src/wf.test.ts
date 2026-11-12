/*
  Per-sample chain, template level.

  Renders :per-sample-neighbours through the :test-per-sample harness against a
  hand-made packed slice, so the whole chain runs for real —

      pt collapse (unique aa + nt multiplicity)
        -> compute_neighbours.py (trie + neighbour count)
          -> pt inner join back onto the clonotype rows
            -> hit call against the threshold

  — with no upstream block, no MiXCR run and no FASTQ fixtures.

  The fixture is small enough that every expected number is derived by hand
  below rather than snapshotted, so a wrong answer names itself.
*/

import { tplTest } from "@platforma-sdk/test";
import type { MiddleLayerDriverKit } from "@milaboratories/pl-middle-layer";
import type { PlTreeNodeAccessor } from "@milaboratories/pl-tree";
import type { ComputableCtx } from "@milaboratories/computable";

/*
  Fixture — 4 clonotypes over 3 distinct aa CDR3s, N = 4 unique nt CDR3s.

    key  aaSeqCDR3   nSeqCDR3   note
    k1   CARAAAW     TGTAAAA    \ same aa, two nt variants
    k2   CARAAAW     TGTAAAC    /  -> multiplicity 2
    k3   CARAACW     TGTAACG    Hamming-1 from CARAAAW (one substitution)
    k4   CDEFGHW     TGTCDEF    isolated, no neighbour at distance 1

  Multiplicities: CARAAAW=2, CARAACW=1, CDEFGHW=1  (sum = 4 = N, as it must be)

  neighbours(s) = (sum of multiplicities over aa within Hamming-1, self
  included) - 1, and Nb_freq = neighbours / N:

    CARAAAW: {CARAAAW:2, CARAACW:1} -> 3 - 1 = 2   Nb_freq 2/4 = 0.5
    CARAACW: {CARAACW:1, CARAAAW:2} -> 3 - 1 = 2   Nb_freq 2/4 = 0.5
    CDEFGHW: {CDEFGHW:1}            -> 1 - 1 = 0   Nb_freq 0/4 = 0

  k1 and k2 must BOTH carry the CARAAAW row's stats — that fan-back-out is the
  join the per-aa rewrite introduced, and the thing most likely to break.
*/
const PACKED_TSV = [
  "clonotypeKey\tpacked",
  "k1\tCARAAAW|TGTAAAA",
  "k2\tCARAAAW|TGTAAAC",
  "k3\tCARAACW|TGTAACG",
  "k4\tCDEFGHW|TGTCDEF",
].join("\n");

/** Same slice plus two unusable rows: an empty aa CDR3 and an empty nt CDR3.
 *  Both must be dropped, and must not inflate N (which stays 4). */
const PACKED_TSV_WITH_UNUSABLE = [
  PACKED_TSV,
  "k5\t|TGTZZZZ",
  "k6\tCARZZZW|",
].join("\n");

type Row = Record<string, string>;

function parseTsv(text: string): { header: string[]; rows: Row[] } {
  const lines = text.trim().split("\n").filter((l) => l.length > 0);
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => {
    const cells = l.split("\t");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { header, rows };
}

async function runPerSample(
  helper: any,
  driverKit: MiddleLayerDriverKit,
  opts: {
    packedTsv?: string;
    hasPgen?: boolean;
    nMin?: number;
    threshold?: number;
    perIsotype?: boolean;
    compartments?: string[];
  },
): Promise<{ header: string[]; rows: Row[] }> {
  const result = await helper.renderTemplate(
    true,
    "test-per-sample",
    ["resultTsv"],
    (tx: any) => ({
      packedTsv: helper.createObject(tx, opts.packedTsv ?? PACKED_TSV),
      hasPgen: helper.createObject(tx, opts.hasPgen ?? false),
      nMin: helper.createObject(tx, opts.nMin ?? 1),
      chain: helper.createObject(tx, "IGHeavy"),
      threshold: helper.createObject(tx, opts.threshold ?? 0.1),
      alpha: helper.createObject(tx, 0.005),
      applyClusterFilter: helper.createObject(tx, false),
      clusterMin: helper.createObject(tx, 10),
      perIsotype: helper.createObject(tx, opts.perIsotype ?? false),
      compartments: helper.createObject(tx, opts.compartments ?? []),
    }),
  );

  const handle = await result.computeOutput(
    "resultTsv",
    (acc: PlTreeNodeAccessor | undefined, ctx: ComputableCtx) => {
      if (!acc) return undefined;
      return driverKit.blobDriver.getOnDemandBlob(acc.persist(), ctx).handle;
    },
  ).awaitStableValue();

  const content = await driverKit.blobDriver.getContent(handle!);
  return parseTsv(content.toString());
}

tplTest(
  "per-sample chain: collapse, neighbour count and fan-back-out",
  async ({ helper, expect, driverKit }) => {
    const { header, rows } = await runPerSample(helper, driverKit, {});

    // The join must return one row per CLONOTYPE, not per unique aa CDR3.
    expect(rows.length, "one row per clonotype").toBe(4);
    for (const c of ["clonotypeKey", "aaSeqCDR3", "multiplicity", "neighbours", "Nb_freq"]) {
      expect(header, `${c} present`).toContain(c);
    }

    const byKey = Object.fromEntries(rows.map((r) => [r.clonotypeKey, r]));

    // k1 and k2 share an aa CDR3, so both carry that aa's stats — the fan-out.
    for (const k of ["k1", "k2"]) {
      expect(byKey[k].aaSeqCDR3, `${k} aa`).toBe("CARAAAW");
      expect(Number(byKey[k].multiplicity), `${k} multiplicity`).toBe(2);
      expect(Number(byKey[k].neighbours), `${k} neighbours`).toBe(2);
      expect(Number(byKey[k].Nb_freq), `${k} Nb_freq`).toBeCloseTo(0.5, 10);
    }

    // One substitution away from CARAAAW, so it sees that aa's multiplicity.
    expect(Number(byKey.k3.multiplicity), "k3 multiplicity").toBe(1);
    expect(Number(byKey.k3.neighbours), "k3 neighbours").toBe(2);
    expect(Number(byKey.k3.Nb_freq), "k3 Nb_freq").toBeCloseTo(0.5, 10);

    // Isolated: neighbours excludes the clone itself, so zero rather than one.
    expect(Number(byKey.k4.multiplicity), "k4 multiplicity").toBe(1);
    expect(Number(byKey.k4.neighbours), "k4 neighbours").toBe(0);
    expect(Number(byKey.k4.Nb_freq), "k4 Nb_freq").toBeCloseTo(0, 10);

    // Hit call is Nb_freq > threshold (0.1 here), so only the isolated clone misses.
    expect(byKey.k1.fastStar, "k1 hit").toBe("Hit");
    expect(byKey.k3.fastStar, "k3 hit").toBe("Hit");
    expect(byKey.k4.fastStar, "k4 not hit").toBe("Not hit");
  },
);

tplTest(
  "per-sample chain: rows with an empty CDR3 are dropped and do not count toward N",
  async ({ helper, expect, driverKit }) => {
    const { rows } = await runPerSample(helper, driverKit, {
      packedTsv: PACKED_TSV_WITH_UNUSABLE,
    });

    const keys = rows.map((r) => r.clonotypeKey).sort();
    expect(keys, "unusable rows dropped by the inner join").toEqual(["k1", "k2", "k3", "k4"]);

    // If the dropped rows had reached the collapse, N would be 6 and every
    // Nb_freq would shift — this pins the drop to BEFORE the normalisation.
    const k1 = rows.find((r) => r.clonotypeKey === "k1")!;
    expect(Number(k1.Nb_freq), "N unchanged at 4").toBeCloseTo(0.5, 10);
  },
);

tplTest(
  "per-sample chain: a sample under nMin is skipped and yields no rows",
  async ({ helper, expect, driverKit }) => {
    // N = 4 unique nt CDR3s, well under the floor.
    const { rows } = await runPerSample(helper, driverKit, { nMin: 100 });
    expect(rows.length, "skipped sample emits no clonotype rows").toBe(0);
  },
);

/*
  Per-isotype fixture — compartments IgG and IgM, both kept.

    key  aaSeqCDR3  nSeqCDR3  isotype
    k1   CARAAAW    TGTAAAA   IgG
    k2   CARAAAW    TGTAAAC   IgM
    k3   CARAACW    TGTAACG   IgG
    k4   CDEFGHW    TGTCDEF   IgM
    k5   CARAAAW    TGTAAAA   IgM      class-switched copy of k1 (same nt)
    k6   CARAACW    TGTAACC   (none)   unknown isotype: main scores only

  CARAAAW and CARAACW are one substitution apart; CDEFGHW is isolated.

  IgG: nt {TGTAAAA, TGTAACG}, N = 2. neighbours = IgG nt CDR3s within one
  substitution of the clone's aa, minus the clone's own nt if it is one:
    k1  {TGTAAAA, TGTAACG} - own TGTAAAA         = 1   0.5
    k2  {TGTAAAA, TGTAACG}, own TGTAAAC not IgG  = 2   1.0
    k3  {TGTAAAA, TGTAACG} - own TGTAACG         = 1   0.5
    k4  {}                                       = 0   0
    k5  {TGTAAAA, TGTAACG} - own TGTAAAA         = 1   0.5   (its IgG copy k1
                                                   is not counted)
  IgM: nt {TGTAAAA, TGTAAAC, TGTCDEF}, N = 3.
    k1  {TGTAAAA, TGTAAAC} - own TGTAAAA         = 1   1/3
    k2  {TGTAAAA, TGTAAAC} - own TGTAAAC         = 1   1/3
    k3  {TGTAAAA, TGTAAAC}, own TGTAACG not IgM  = 2   2/3
    k4  {TGTCDEF} - own                          = 0   0
    k5  {TGTAAAA, TGTAAAC} - own TGTAAAA         = 1   1/3
  Threshold 0.4.
*/
const PACKED_TSV_ISOTYPE = [
  "clonotypeKey\tpacked",
  "k1\tCARAAAW|TGTAAAA|IgG",
  "k2\tCARAAAW|TGTAAAC|IgM",
  "k3\tCARAACW|TGTAACG|IgG",
  "k4\tCDEFGHW|TGTCDEF|IgM",
  "k5\tCARAAAW|TGTAAAA|IgM",
  "k6\tCARAACW|TGTAACC|",
].join("\n");

tplTest(
  "per-sample chain: per-isotype scores count only that isotype's CDR3s, never the clone's own",
  async ({ helper, expect, driverKit }) => {
    const { rows } = await runPerSample(helper, driverKit, {
      packedTsv: PACKED_TSV_ISOTYPE,
      threshold: 0.4,
      perIsotype: true,
      compartments: ["IgG", "IgM"],
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.clonotypeKey, r]));
    expect(Object.keys(byKey).sort(), "every clone keeps its main row").toEqual([
      "k1",
      "k2",
      "k3",
      "k4",
      "k5",
      "k6",
    ]);

    // Main statistic unchanged: N = 5 distinct nt; k5 shares k1's nt.
    expect(Number(byKey.k1.neighbours), "main k1").toBe(3);

    const igg: Record<string, number> = { k1: 0.5, k2: 1, k3: 0.5, k4: 0, k5: 0.5 };
    const igm: Record<string, number> = { k1: 1 / 3, k2: 1 / 3, k3: 2 / 3, k4: 0, k5: 1 / 3 };
    for (const k of Object.keys(igg)) {
      expect(Number(byKey[k].nbFreq_iso0), `${k} IgG nbFreq`).toBeCloseTo(igg[k], 10);
      expect(byKey[k].fastStar_iso0, `${k} IgG hit`).toBe(igg[k] > 0.4 ? "Hit" : "Not hit");
      expect(Number(byKey[k].nbFreq_iso1), `${k} IgM nbFreq`).toBeCloseTo(igm[k], 10);
      expect(byKey[k].fastStar_iso1, `${k} IgM hit`).toBe(igm[k] > 0.4 ? "Hit" : "Not hit");
    }

    // Unknown isotype: main scores, no per-isotype ones.
    expect(byKey.k6.nbFreq, "k6 main score").not.toBe("");
    expect(byKey.k6.nbFreq_iso0 ?? "", "k6 no IgG score").toBe("");
    expect(byKey.k6.nbFreq_iso1 ?? "", "k6 no IgM score").toBe("");
  },
);

tplTest(
  "per-sample chain: a compartment under nMin gets no per-isotype values",
  async ({ helper, expect, driverKit }) => {
    // N = 5 overall, IgG has 2 nt CDR3s, IgM has 3.
    const { rows } = await runPerSample(helper, driverKit, {
      packedTsv: PACKED_TSV_ISOTYPE,
      nMin: 3,
      threshold: 0.4,
      perIsotype: true,
      compartments: ["IgG", "IgM"],
    });
    const k3 = rows.find((r) => r.clonotypeKey === "k3")!;
    expect(k3.nbFreq_iso0 ?? "", "IgG skipped").toBe("");
    expect(Number(k3.nbFreq_iso1), "IgM kept").toBeCloseTo(2 / 3, 10);
  },
);

tplTest(
  "per-sample chain: per-isotype full-STAR runs per compartment and leaves unknown isotypes blank",
  async ({ helper, expect, driverKit }) => {
    // Same clones with a Pgen field before the isotype ("aa|nt|Pgen|isotype").
    const packed = PACKED_TSV_ISOTYPE.split("\n")
      .map((line, i) => (i === 0 ? line : line.replace(/\|([^|]*)$/, "|1e-12|$1")))
      .join("\n");
    const { rows } = await runPerSample(helper, driverKit, {
      packedTsv: packed,
      hasPgen: true,
      threshold: 0.4,
      perIsotype: true,
      compartments: ["IgG", "IgM"],
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.clonotypeKey, r]));
    for (const k of ["k1", "k2", "k3", "k4", "k5"]) {
      for (const c of ["fullStarScore_iso0", "fullStarScore_iso1"]) {
        expect(Number.isFinite(Number(byKey[k][c])), `${k} ${c} scored`).toBe(true);
      }
      for (const c of ["fullStar_iso0", "fullStar_iso1"]) {
        expect(["Hit", "Not hit"], `${k} ${c} called`).toContain(byKey[k][c]);
      }
    }
    // Same neighbour counts feed full-STAR: k2 has 2 IgG neighbours, k1 has 1,
    // with one Pgen and one N_X, so k2 is at least as significant as k1.
    expect(Number(byKey.k2.fullStarScore_iso0)).toBeGreaterThanOrEqual(
      Number(byKey.k1.fullStarScore_iso0),
    );
    expect(byKey.k6.fullStarScore_iso0 ?? "", "k6 unscored").toBe("");
    // fast-STAR per isotype is unchanged by Pgen being present.
    expect(Number(byKey.k2.nbFreq_iso0)).toBeCloseTo(1, 10);
  },
);
