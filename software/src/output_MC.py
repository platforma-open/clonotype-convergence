# output_MC.py — full-STAR FDR-controlled convergence statistic.
#
# Vendored from statbiophys/STAR (file: all_class/output_MC.py).
# Repository: https://github.com/statbiophys/STAR
# Paper: Abbate et al., PNAS 2024 (DOI: 10.1073/pnas.2401058121).
#
# The implementation is the paper's full-STAR statistic (Methods,
# "Computation of the threshold for the binder identification"):
#   - per clone, a null neighbour count Lambda derived from its
#     generation probability:
#         Lambda = CDR3_len * 19 * Pgen * uniq_nucl
#     (CDR3_len*19 single-substitution aa variants, each generated with
#     probability Pgen, over the sample's uniq_nucl unique nt CDR3s).
#   - a Poisson tail p-value P(X >= observed Neighbours) at rate
#         a = 2 * (Lambda + 0.1)
#     summed to a cap of 1000 terms.
#   - Benjamini-Hochberg across the sample's clones at target FDR alpha.
# The reference constants q=2, the +0.1 pseudocount, 19, and the tail cap
# 1000 are preserved verbatim (M1: reproduce STAR's output_MC reference).
#
# PATCH (2026-07-20, MILAB-6632): the upstream `pvalue` kernel is a
# `numba @jit(nopython=True)` double loop (over clones x tail terms).
# numba pins tightly to numpy and would conflict with this software's
# pinned numpy 2.2.6, so — exactly as get_df.py drops its (there unused)
# numba import — the kernel is re-expressed with scipy.stats.poisson,
# already present in the runenv (a scikit-learn dependency). The capped
# tail  sum_{d=Neighbours}^{999} pmf(d; a)  is computed as
#     sf(Neighbours-1, a) - sf(999, a)
# which is cancellation-safe in the extreme tail (the naive cdf
# difference 1 - (1 - eps) loses all precision when p ~ 1e-50) and
# numerically identical to the reference loop — verified against STAR's
# committed golden output/df_read_test.tsv to < 1e-13 relative error
# (see software/test/test_full_star_m1.py).
#
# PATCH (MILAB-6632): upstream BH_procedure raises UnboundLocalError when
# EVERY clone passes the BH line (the `break` never fires, so `top_seq`
# is unbound). Guarded here: all-tested-are-hits returns the whole frame.

import numpy as np
import pandas as pd
from scipy.stats import poisson


def poisson_capped_tail(neighbours, a):
    """P(neighbours <= X <= 999) under Poisson(rate=a), vectorised.

    Reproduces STAR's reference kernel
        for d in range(neighbours, 1000): pvalue += pmf(d; a)
    via the survival function (accurate in the extreme tail):
        sf(neighbours - 1, a) - sf(999, a)
    ``neighbours >= 1000`` gives an empty range in the reference loop, so
    the tail is 0 there. Result is clipped to [0, 1] against fp noise.
    """
    neighbours = np.asarray(neighbours, dtype=np.int64)
    a = np.asarray(a, dtype=np.float64)
    tail = poisson.sf(neighbours - 1, a) - poisson.sf(999, a)
    tail = np.where(neighbours >= 1000, 0.0, tail)
    return np.clip(tail, 0.0, 1.0)


class Output_MC:
    def __init__(self, df):
        self.df = df

    def get_len(self):
        self.df["CDR3_len"] = self.df["aaSeqCDR3"].str.len()

    def get_lambda(self, uniq_nucl):
        self.get_len()
        self.df["Lambda_freq"] = self.df["CDR3_len"] * 19 * self.df["Pgen"]
        self.df["Lambda"] = self.df["Lambda_freq"] * uniq_nucl

    def get_pvalue(self, uniq_nucl):
        self.get_lambda(uniq_nucl)
        # Upstream: a = (n_tag * q * (Lambda + 0.1)) / n_gen, with q = 2 and
        # n_tag == n_gen == len(df), so the ratio cancels: a = 2*(Lambda+0.1).
        a = 2.0 * (self.df["Lambda"].values + 0.1)
        self.df["Pvalue"] = poisson_capped_tail(self.df["Neighbours"].values, a)

    def BH_procedure(self, uniq_nucl, alpha):
        self.get_pvalue(uniq_nucl)
        self.df.sort_values(by="Pvalue", inplace=True)
        self.df.reset_index(drop=True, inplace=True)
        m = len(self.df)
        # First-crossing rule (verbatim): hits are ranks [0:k) where k is the
        # smallest 1-based rank with p[k] > (k/m)*alpha. Default = whole frame
        # when the line is never crossed (every clone a hit) — the upstream
        # UnboundLocalError case.
        top_seq = self.df
        for k in range(1, m):
            if self.df["Pvalue"][k] > (k / m) * alpha:
                top_seq = self.df[0:k]
                break
        return top_seq
