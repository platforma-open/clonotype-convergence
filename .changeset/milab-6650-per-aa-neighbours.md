---
"@platforma-open/milaboratories.clonotype-convergence.software": patch
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: compute neighbour density over the per-aa table, not the clonotype table

compute-neighbours was OOM-killed on a 15.7M-clonotype sample (an unselected
phage-display library) regardless of the budget it was given. The step held the
whole sample in Python objects at once — ~47M string objects from the initial
read, two `nunique()` hash sets, four 10M-entry dicts built by calling
`set_index().to_dict()` twice to use two of them, and a final 15.7M-row pandas
`merge` on a string key — for a statistic that only reads unique aa CDR3s and
their nt multiplicities. Peak was tens of GB and scaled with clonotype count.

Both ends now run in ptabler, which streams and spills:

- **Before** the step, the per-sample pt workflow drops null/empty CDR3s and
  collapses to one row per unique aa CDR3 with `multiplicity =
  n_unique(nSeqCDR3)`, saved as `per_aa.tsv`.
- **After** it, a pt inner join fans the per-aa stats back onto the clonotype
  rows on `aaSeqCDR3`, producing the same `neighbours.tsv` the rest of the
  per-sample chain already consumed.

`compute_neighbours.py` therefore reads `per_aa.tsv` and writes
`per_aa_stats.tsv`; it never sees an nt CDR3 or a clonotype key, and its memory
tracks unique aa CDR3s instead of clonotypes. Its RAM budget is now driven by
`lineCount` rather than file size, since the cost is per row.

The statistic is unchanged. `test/test_get_df_equivalence.py` pins the rewritten
`Get_df` to STAR's own test input and published per-aa reference
(`data/star_Test.tsv` / `data/star_df_read_test_golden.tsv`), asserting identical
Multiplicity, Neighbours and Nb_freq, and that N — Nb_freq's denominator — is
the sum of the multiplicity column.

Behaviour preserved: the inner join drops rows with null/empty CDR3s exactly as
the old pandas filter did, and a sample skipped for `nMin` emits empty stats, so
the join yields an empty `neighbours.tsv` and the sample drops out as before.
`status.json` still carries `{nUniqueNt, nMin}` with the same meaning.

Two removals, neither observable: `Get_df.frequency()` (a per-aa share of
clonotype rows that nothing consumed, and which is not derivable from the per-aa
input), and the "input rows" / "dropped N rows" log lines, which counted rows the
step no longer sees. The nMin skip and small-sample warning lines are unchanged.

The cluster-filter step is untouched and still holds a fixed 4GiB; its memory is
quadratic in the hit count (DBSCAN with a callable metric builds a full pairwise
distance matrix), which is a separate problem.
