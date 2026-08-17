---
"@platforma-open/milaboratories.clonotype-convergence.model": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: make the tables' column visibility actually apply

Two bugs, both visible as "the table shows the wrong columns".

**Every column was a primary column, and primary columns ignore visibility
rules.** `createPlDataTableV3` filters only the non-primary sets against the
visibility rules, and column discovery classes every zero-hop column as primary.
Both tables discover with `maxHops: 0`, so everything was primary and no rule
had any effect: the fast-STAR demotion on a full-STAR chain, the "enrichment
starts optional" default, and the per-sample hidden rule were all inert — which
is why upstream MiXCR columns arrived visible by default.

Only the anchor is passed as a primary column now; everything else goes through
the regular column set. The anchor is also chosen per availability — full-STAR's
hit column where the chain has one, else fast-STAR's — since the anchor is
permanently visible and should therefore be the call being foregrounded.

**A saved column layout outlived the columns it named.** The persisted
hidden-column list replaces the rule-derived one instead of merging with it, so
a layout captured while full-STAR existed kept hiding the fast-STAR family after
the Generation Probability block was removed. With full-STAR gone as well, the
table rendered every value column hidden — 70k rows of clone ids.

The table's source identifier now covers which column families a run emits
(chains processed, full-STAR per chain, cluster filter), not just the dataset,
so any change to the set of existing columns resets the layout. The trade-off is
that those transitions also reset manual column choices and sort order for that
table, exactly as a dataset change already did.

**The sample picker described a different run from the table under it.** The
per-sample table's sheet selector was built from the dataset currently selected
in Settings, while the table itself is built from the args that produced the
current rows. Selecting another dataset without pressing Run therefore listed
the new dataset's samples above the old dataset's data. The picker now reads the
same committed args as the table.
