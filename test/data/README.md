# Test data

## `star-test-with-readCount.tsv`

500 IGH clonotypes from STAR's
[`data_test/Test.tsv`](https://github.com/statbiophys/STAR/blob/master/data_test/Test.tsv)
with two adjustments so the file can be imported via the
`import-vdj-data` block:

- `VGene` → `bestVGene` and `JGene` → `bestJGene` (MiXCR-format column
  aliases that `import-vdj-data` recognises; without these, the chain
  filter has no V/J info and drops every row).
- Synthetic `readCount = 1` column appended (the block requires a
  read-count column to derive abundance).

Columns: `bestVGene` `bestJGene` `nSeqCDR3` `aaSeqCDR3` `readCount` (tab-separated).

### How to use

1. Add `import-vdj-data` to a project, point it at this TSV (MiXCR-style
   format; the column aliases `nSeqCDR3` / `aaSeqCDR3` / `readCount`
   are recognised automatically).
2. Add this block downstream.
3. Pick the import-vdj anchor as the input dataset.

This bypasses MiXCR entirely — fastest iteration loop for checking that
block outputs match running STAR's `Get_df` directly on the same input
(per spec-draft.md:390 and implementation-plan.md:98).
