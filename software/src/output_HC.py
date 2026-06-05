# output_HC.py — paper's "binder" cluster filter (DBSCAN + Levenshtein-1).
#
# Vendored verbatim from statbiophys/STAR (file: all_class/output_HC.py).
# Repository: https://github.com/statbiophys/STAR
# Paper: Abbate et al., PNAS 2024 (DOI: 10.1073/pnas.2401058121).
#
# The implementation is the paper's "binder" definition (Methods §
# "Computation of the threshold for the binder identification"):
#   - DBSCAN on aa CDR3 set with Levenshtein-1 metric (eps=1)
#   - clusters with fewer than cluster_min members are dropped
#   - returns the surviving subset
# In our pipeline this runs as Stage 3 (cluster_filter.py) on top of
# Stage 2's threshold-passing hits when args.applyClusterFilter is on.

from Levenshtein import distance
from sklearn.cluster import DBSCAN
import numpy as np
import pandas as pd

class Output:
    def __init__(self, df):
        self.df = df

    @staticmethod
    def lev_metric(x, y, data):
        i, j = int(x[0]), int(y[0])
        return distance(data[i], data[j])

    def cluster(self, threshold, cluster_min):
        top_seq = self.df[self.df['Nb_freq'] > threshold].reset_index(drop=True)
        data = top_seq['aaSeqCDR3']
        X = np.arange(len(data)).reshape(-1, 1)
        b = DBSCAN(metric=lambda x, y: self.lev_metric(x, y, data), eps=1, min_samples=cluster_min).fit(X)
        temp = pd.DataFrame(b.labels_)
        temp.reset_index(inplace=True)
        temp = temp.set_index("index").to_dict()[0]
        top_seq['family_lev'] = top_seq.index.map(temp)
        top_seq.replace(-1, np.nan, inplace=True)
        top_seq.dropna(inplace=True)
        top_seq.reset_index(drop=True, inplace=True)
        return top_seq
