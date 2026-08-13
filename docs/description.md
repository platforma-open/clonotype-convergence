# Overview

Detects antigen-driven clonotype convergence in B-cell receptor (BCR) repertoires. For each clonotype, the block counts how many other CDR3s in the same sample differ by exactly one amino acid — a per-clone neighbour density. High density signals independent B-cell lineages converging on the same CDR3 solution, a hallmark of antigen-driven selection.

Two convergence calls are produced side by side, from that same neighbour count:

- **fast-STAR** — always computed. A configurable threshold on the normalised neighbour frequency (Abbate et al. 2024), calibrated for human IgH by default.
- **full-STAR** — added automatically wherever a per-clonotype generation probability is available from the **Generation Probability** block. Each clone is tested against what V(D)J recombination alone would produce for *its own* CDR3: a Poisson test of the observed neighbour count against a Pgen-derived null, with Benjamini-Hochberg control at a user-set false-discovery rate. A rare CDR3 is flagged on a few neighbours where a common one needs many. Where it runs, full-STAR is the preferred signal — fast-STAR is a fixed threshold, blind to how likely a sequence was to arise by chance.

Results are reported per clonotype, ready for downstream scoring and lead selection: for each call a **score**, a **Hit / Not hit** flag, and a **reproducibility** ratio — the share of the donor cohort in which the clone is a hit. A clonotype seen in several samples is collapsed to one value; two optional sample-metadata inputs refine that, marking where convergence is expected and which samples share a donor. Per-sample values are kept for QC, alongside an optional cluster filter adding a stricter "binder" call matching the paper's headline definition.

Inputs: clonotype-level VDJ data — CDR3 amino-acid sequence, CDR3 nucleotide sequence, and per-clonotype abundance. Accepts bulk Heavy, bulk Light, or single-cell BCR data; light-chain analysis on single-cell data is an explicit opt-in. Generation Probability is optional — without it the block reports fast-STAR alone.

**Designed for in-vivo BCR repertoires only.** In-vitro data — scFv libraries, phage / yeast display, panning-enriched repertoires — produces uninterpretable results. The algorithm runs and emits numbers, but the signal it was built to detect (germinal-center convergence under antigen-driven selection) is absent in vitro.

Both statistics are from the Statistical Biophysics group's STAR tool. For more information, please see: [https://github.com/statbiophys/STAR](https://github.com/statbiophys/STAR) and cite the following publication if used in your research:

> Abbate A. et al. Computational detection of antigen-specific B cell receptors following immunization. _PNAS_ 121(35):e2401058121 (2024). [https://doi.org/10.1073/pnas.2401058121](https://doi.org/10.1073/pnas.2401058121)
