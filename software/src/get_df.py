# get_df.py — fast-STAR neighbour-density computation.
#
# Derived from statbiophys/STAR (file: all_class/get_df.py).
# Repository: https://github.com/statbiophys/STAR
# Paper: Abbate et al., PNAS 2024 (DOI: 10.1073/pnas.2401058121).
#
# The statistic is the paper's fast-STAR neighbour density, unchanged:
#   - per aa CDR3, count Hamming-1 same-length aa neighbours
#   - weight each neighbour by its nt-CDR3 multiplicity
#   - normalise by the total unique nt CDR3 count (N)
# Matches the paper's Methods section ("Computation of neighbour density"),
# and is checked against the paper's own test input in
# test/test_get_df_equivalence.py.
#
# INPUT SHAPE (MILAB-6650): this takes the PER-AA table — one row per unique
# aa CDR3 with its nt multiplicity — not the per-clonotype table upstream
# STAR read. The multiplicity collapse and the fan-back-out to per-clonotype
# rows both moved into ptabler, which streams and spills; doing them here held
# every clonotype's nt CDR3 in Python objects at once and a 15.7M-clonotype
# sample needed ~40-60 GB. N (the normaliser) is the sum of the multiplicity
# column, which is exactly the unique-nt count the collapse counted.
#
# Two things upstream computed that are gone with that input shape:
#   - `Frequency` (per-aa share of CLONOTYPE rows) needed the pre-collapse row
#     count. Nothing consumed it — compute_neighbours.py never selected it.
#   - the dict round-trips (`set_index().to_dict()`, called twice, building
#     four dicts to use two). Results are now carried as plain lists and
#     assembled into the frame once.
#
# Earlier patch, kept: upstream called `multiplicity()` inside the inner
# per-neighbour loop, recomputing the whole dict O(N*K) times, and assigned
# results with `df.loc[k, col] = value` per row. Both are algebraic; same
# result, dramatically faster (MILAB-6354, 2026-06-02).

import pandas as pd
import atriegc


class Get_df:
    """Neighbour density over a per-aa table.

    `data` must carry `aaSeqCDR3` (unique) and `multiplicity` (count of
    distinct nt CDR3s collapsed into that aa CDR3).
    """

    def __init__(self, data):
        self.data = data

    def make(self):
        seqs = self.data["aaSeqCDR3"].astype(str).tolist()
        mult = self.data["multiplicity"].astype(int).tolist()

        if not seqs:
            return pd.DataFrame(
                {"aaSeqCDR3": [], "Multiplicity": [], "Neighbours": [], "Nb_freq": []}
            )

        # N — total unique nt CDR3s in the sample. The per-aa multiplicities
        # partition the unique nt set, so their sum is that count exactly.
        n_un = sum(mult)
        if n_un == 0:
            return pd.DataFrame(
                {"aaSeqCDR3": seqs, "Multiplicity": mult, "Neighbours": [0] * len(seqs), "Nb_freq": [0.0] * len(seqs)}
            )

        dic = dict(zip(seqs, mult))

        tr = atriegc.TrieAA()
        for seq in seqs:
            tr.insert(seq)

        neighbours = [0] * len(seqs)
        nb_freq = [0.0] * len(seqs)
        for i, seq in enumerate(seqs):
            # tr.neighbours() returns the sequences within Hamming distance 1
            # INCLUDING seq itself; the paper subtracts one to exclude the
            # clone itself, not its whole multiplicity.
            c = 0
            for d in tr.neighbours(seq, 1):
                c += int(dic[d])
            neighbours[i] = c - 1
            nb_freq[i] = (c - 1) / n_un

        return pd.DataFrame(
            {
                "aaSeqCDR3": seqs,
                "Multiplicity": mult,
                "Neighbours": neighbours,
                "Nb_freq": nb_freq,
            }
        )
