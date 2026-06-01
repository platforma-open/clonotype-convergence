# get_df.py — fast-STAR neighbour-density computation.
#
# Vendored verbatim from statbiophys/STAR (file: all_class/get_df.py).
# Repository: https://github.com/statbiophys/STAR
# Paper: Abbate et al., PNAS 2024 (DOI: 10.1073/pnas.2401058121).
#
# LICENSING NOTE: The upstream STAR repository ships without a LICENSE file.
# Vendoring is done provisionally to make the block functional during
# development; license clearance must be obtained from the STAR authors
# (statbiophys group, Thomas Dupic / Thierry Mora / Aleksandra Walczak)
# before any publication or distribution of this block. Track in MILAB-6354.
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
        distance =1
        tr = atriegc.TrieAA()
        df_nb=pd.DataFrame(self.data["aaSeqCDR3"])
        df_nb.drop_duplicates("aaSeqCDR3",inplace=True)
        df_nb.reset_index(drop=True,inplace=True)
        df_nb=df_nb.assign(nb_neighbours_real=0)
        df_nb=df_nb.assign(nb_freq=0)
        n_df=len(df_nb)
        for k1 in range(n_df):
            tr.insert(df_nb["aaSeqCDR3"][k1])
        for k1 in range(n_df):
            a=(tr.neighbours(df_nb["aaSeqCDR3"][k1], distance))
            c=0
            for k in range(len(a)):
                d=a[k]
                dic,n_un=self.multiplicity()
                b=int(dic[d])
                c+=b
            df_nb.loc[k1,"nb_neighbours_real"]=c-1
            df_nb.loc[k1,"nb_freq"]=(c-1)/n_un
        temp=df_nb.set_index("aaSeqCDR3").to_dict()["nb_neighbours_real"]
        temp1=df_nb.set_index("aaSeqCDR3").to_dict()["nb_freq"]
        return temp,temp1

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
