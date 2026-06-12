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

The multi-sample family stays in the result pool: it drives this block's own
table and histograms, lead selection ignores it (it rejects per-sample-axis
columns), and pooling it is what keeps the compute pipeline recoverable so a
second identical block dedups instead of recomputing. The collapse runs in a
pure template, so the filtered result content-addresses and dedups across
blocks and runs.
