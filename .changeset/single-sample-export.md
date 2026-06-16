---
'@platforma-open/milaboratories.clonotype-convergence.workflow': minor
'@platforma-open/milaboratories.clonotype-convergence.model': minor
'@platforma-open/milaboratories.clonotype-convergence.ui': minor
'@platforma-open/milaboratories.clonotype-convergence': minor
---

Add single-sample convergence export for antibody lead selection.

A new "Sample to export" setting collapses the chosen sample's convergence
columns (neighbour count, neighbour frequency, hit flag) onto a clonotype-only
axis — dropping the per-sample axis that lead selection rejects — and exports
them under their own column family. Nothing exports until a sample is picked
and the block is re-run, so the choice stays explicit; the sample name lives in
the column labels and trace.

The multi-sample family stays internal to the block: it drives the in-block
table and histograms, but is not exported to the result pool — downstream
consumers enrich by clonotype key, never by the per-sample axis, so the
single-sample family is the only convergence data the block exposes
downstream. The collapse runs in a pure template.
