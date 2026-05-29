Detects antigen-driven clonotype convergence in a single BCR repertoire using the fast-STAR statistic (Abbate et al. 2024).

For each clonotype, counts how many other CDR3s in the same sample sit within Hamming-1 — a per-clone neighbour density. High density signals independent B-cell lineages converging on the same CDR3 solution, a hallmark of antigen-driven selection.

Inputs: per-clonotype PColumns from MiXCR clonotyping (CDR3 amino-acid sequence, CDR3 nucleotide sequence, per-clonotype abundance). Heavy chain primary; light chain optional.

Outputs (per processed chain): `fastStar` (Int 0/1 thresholded hit flag), `neighbours` (Int neighbour count), `nbFreq` (Double normalised frequency).
