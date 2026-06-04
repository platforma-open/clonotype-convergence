# get_df.py — fast-STAR neighbour-density computation.
#
# Vendored verbatim from statbiophys/STAR (file: all_class/get_df.py).
# Repository: https://github.com/statbiophys/STAR
# Paper: Abbate et al., PNAS 2024 (DOI: 10.1073/pnas.2401058121).
#
# The implementation is the paper's fast-STAR density statistic:
#   - per aa CDR3, count Hamming-1 same-length aa neighbours
#   - weight each neighbour by its nt-CDR3 multiplicity
#   - normalise by the total unique nt CDR3 count (N)
# Matches the paper's Methods section ("Computation of neighbour density").

import os
import numpy as np
import pandas as pd
import atriegc

# Note: upstream STAR imports `from numba import jit` here, but never
# actually applies @jit anywhere in this file. We drop the import to
# avoid bundling numba in the runenv unnecessarily — the algorithm
# runs at the same speed without it.
#
# PATCH (2026-06-02, MILAB-6354): upstream `neighbours()` had two
# compounding performance bugs that made it ~hours-slow on real-world
# inputs (~100K unique CDR3s):
#   1. `self.multiplicity()` was called inside the inner per-neighbour
#      loop — recomputed the entire dict O(N×K) times instead of once.
#   2. `df_nb.loc[k1, col] = value` per row triggers pandas dtype
#      checks + (in 2.x) copy-on-write per assignment — N×slow vs.
#      one bulk column build.
# Both fixes are algebraic; same result, dramatically faster (verified
# on SRR8377674 / 83K CDR3s: ~30+ min → seconds).


class Get_df:
    def __init__(self, data):
        self.data = data

    def frequency(self):
        df_freq=pd.DataFrame(self.data["aaSeqCDR3"])
        df_freq["size"]=1
        n_df=len(df_freq)
        temp=df_freq.groupby(['aaSeqCDR3'], sort = False).sum()
        temp["frequency"]=temp["size"]/n_df
        temp=temp.reset_index()
        temp=temp.set_index("aaSeqCDR3").to_dict()["frequency"]
        return temp


    def multiplicity(self):
        unique_nucl = self.data.drop_duplicates("nSeqCDR3")
        unique_nucl.reset_index(drop = True, inplace = True)
        unique_nucl=unique_nucl.assign(size=1)
        n_df=len(unique_nucl)
        temp=unique_nucl.groupby(['aaSeqCDR3'], sort = False).sum()
        temp=temp.reset_index()
        temp=temp.set_index("aaSeqCDR3").to_dict()["size"]
        return temp, len(unique_nucl)


    def neighbours(self):
        distance = 1
        tr = atriegc.TrieAA()
        df_nb = pd.DataFrame(self.data["aaSeqCDR3"])
        df_nb.drop_duplicates("aaSeqCDR3", inplace=True)
        df_nb.reset_index(drop=True, inplace=True)
        n_df = len(df_nb)

        # Hoist multiplicity() out of the loop (PATCH point 1) —
        # it's invariant; upstream recomputed it N×K times.
        dic, n_un = self.multiplicity()

        for k1 in range(n_df):
            tr.insert(df_nb["aaSeqCDR3"][k1])

        # Collect per-row results in plain lists, build columns once
        # (PATCH point 2) — upstream used df_nb.loc[k1, col]=value per
        # row, which is ~100-1000× slower than bulk column assignment
        # in pandas 2.x.
        nb_neighbours_real = [0] * n_df
        nb_freq = [0.0] * n_df
        for k1 in range(n_df):
            a = tr.neighbours(df_nb["aaSeqCDR3"][k1], distance)
            c = 0
            for d in a:
                c += int(dic[d])
            nb_neighbours_real[k1] = c - 1
            nb_freq[k1] = (c - 1) / n_un
        df_nb["nb_neighbours_real"] = nb_neighbours_real
        df_nb["nb_freq"] = nb_freq

        temp = df_nb.set_index("aaSeqCDR3").to_dict()["nb_neighbours_real"]
        temp1 = df_nb.set_index("aaSeqCDR3").to_dict()["nb_freq"]
        return temp, temp1

    def make(self):
        df_read=pd.DataFrame(self.data["aaSeqCDR3"])
        df_read.drop_duplicates("aaSeqCDR3",inplace=True)
        df_read.reset_index(drop=True,inplace=True)
        dic_1 = self.frequency()
        dic_2 = self.multiplicity()[0]
        dic_3, dic_4 = self.neighbours()
        df_read["Frequency"]=df_read.aaSeqCDR3.map(dic_1)
        df_read["Multiplicity"]=df_read.aaSeqCDR3.map(dic_2)
        df_read["Neighbours"]=df_read.aaSeqCDR3.map(dic_3)
        df_read["Nb_freq"]=df_read.aaSeqCDR3.map(dic_4)
        return df_read
