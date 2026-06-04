Detects antigen-driven clonotype convergence in a single BCR repertoire using the fast-STAR statistic (Abbate et al. 2024).

For each clonotype, counts how many other CDR3s in the same sample sit within Hamming-1 — a per-clone neighbour density. High density signals independent B-cell lineages converging on the same CDR3 solution, a hallmark of antigen-driven selection.

Inputs: per-clonotype PColumns from MiXCR clonotyping (CDR3 amino-acid sequence, CDR3 nucleotide sequence, per-clonotype abundance). Bulk or single-cell. Heavy or light chain.

Outputs (per processed chain): a hit flag (above/below the convergent neighbour-frequency threshold), the raw neighbour count, and the normalised neighbour frequency. When the optional cluster filter is enabled, an additional hit flag carries the paper's stricter "binder" definition.
