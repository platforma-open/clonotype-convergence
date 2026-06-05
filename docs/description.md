# Overview

Detects antigen-driven clonotype convergence in B-cell receptor (BCR) repertoires using the fast-STAR statistic (Abbate et al. 2024). For each clonotype, the block counts how many other CDR3 amino-acid sequences in the same sample lie within one amino-acid difference (Hamming-1) — a per-clone neighbour density. High density signals independent B-cell lineages converging on the same CDR3 solution, a hallmark of antigen-driven selection. Outputs a Hit / Not hit flag from a configurable neighbour-frequency threshold plus the raw neighbour count and normalised frequency, per chain. An optional cluster filter adds a stricter "binder" call (single-linkage Hamming/Levenshtein-1 cluster of at least the user-set minimum size), matching the paper's headline definition.

Inputs: per-clonotype PColumns from MiXCR clonotyping — CDR3 amino-acid sequence, CDR3 nucleotide sequence, and per-clonotype abundance. Accepts bulk heavy, bulk light, and single-cell IG anchors; light-chain processing on single-cell data is an explicit opt-in.

The fast-STAR algorithm is from the Statistical Biophysics group's STAR tool. For more information, please see: [https://github.com/statbiophys/STAR](https://github.com/statbiophys/STAR) and cite the following publication if used in your research:

> Abbate A. et al. Computational detection of antigen-specific B cell receptors following immunization. _PNAS_ 121(35):e2401058121 (2024). [https://doi.org/10.1073/pnas.2401058121](https://doi.org/10.1073/pnas.2401058121)
