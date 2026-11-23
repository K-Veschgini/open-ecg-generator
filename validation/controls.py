"""Calibrates the classifier on REAL ECGs (PTB-XL, CC BY 4.0, downloaded from PhysioNet):
for every label, the score distribution of real recordings with and without that label.
Writes out/controls.json with a decision threshold per label.
Usage: python controls.py [n_random=400] [n_positive=15]"""
import json, os, sys, time, urllib.request, warnings
from concurrent.futures import ThreadPoolExecutor
import numpy as np, pandas as pd, wfdb
import model as M
from targets import TARGETS
warnings.filterwarnings('ignore')

N_RANDOM = int(sys.argv[1]) if len(sys.argv) > 1 else 400
N_POS = int(sys.argv[2]) if len(sys.argv) > 2 else 15
BASE = 'https://physionet.org/files/ptb-xl/1.0.3/'
DATA = os.path.join(M.CACHE, 'ptbxl')
L = M.labels()
df = pd.read_csv(os.path.join(M.CACHE, 'ECGFounder', 'csv', 'ptbxl_label.csv')).dropna(subset=['filename_hr', 'label'])
Y = np.array([json.loads(s) for s in df['label']])
rng = np.random.default_rng(0)
wanted = sorted({l for t in TARGETS.values() for l in t['primary'] + t['related']})
rows = set(rng.choice(len(df), N_RANDOM, replace=False).tolist())
for name in wanted:
    pos = np.flatnonzero(Y[:, L.index(name)] == 1)
    rows |= set(rng.choice(pos, min(N_POS, len(pos)), replace=False).tolist())
rows = sorted(rows)

def fetch(rel):
    for ext in ('.hea', '.dat'):
        dst = os.path.join(DATA, rel + ext)
        if not os.path.exists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            for attempt in range(6):
                try:
                    urllib.request.urlretrieve(BASE + rel + ext, dst + '.part')
                    os.replace(dst + '.part', dst)
                    break
                except Exception:
                    if attempt == 5:
                        raise
                    time.sleep(2 ** attempt)
with ThreadPoolExecutor(4) as ex:
    list(ex.map(fetch, [df.iloc[r]['filename_hr'] for r in rows]))

X = []
for r in rows:
    sig, meta = wfdb.rdsamp(os.path.join(DATA, df.iloc[r]['filename_hr']))
    assert meta['fs'] == 500 and [n.upper() for n in meta['sig_name']] == [n.upper() for n in M.LEADS], meta['sig_name']
    X.append(sig.T[:, :5000])
P = M.predict(M.load_model(), np.array(X))
Yr = Y[rows]
out = {}
for i, name in enumerate(L):
    pos, neg = P[Yr[:, i] == 1, i], P[Yr[:, i] == 0, i]
    e = {'n_pos': int(len(pos)), 'n_neg': int(len(neg)), 'neg_p95': float(np.quantile(neg, 0.95)),
         'neg_p99': float(np.quantile(neg, 0.99))}
    if len(pos) >= 5:
        # threshold with the best sensitivity + specificity on the real recordings
        cand = np.unique(np.concatenate([pos, neg]))
        j = [(np.mean(pos >= c) + np.mean(neg < c), c) for c in cand]
        thr = max(j)[1]
        e.update(pos_median=float(np.median(pos)), threshold=float(thr), sensitivity=float(np.mean(pos >= thr)),
                 specificity=float(np.mean(neg < thr)), threshold_source='real positives vs negatives')
    else:
        e.update(pos_median=None, threshold=float(max(e['neg_p99'], 0.5)), sensitivity=None,
                 specificity=float(np.mean(neg < max(e['neg_p99'], 0.5))),
                 threshold_source='no real positives: max(0.5, 99th percentile of real negatives)')
    out[name] = e
os.makedirs(os.path.join(M.HERE, 'out'), exist_ok=True)
json.dump(out, open(os.path.join(M.HERE, 'out', 'controls.json'), 'w'), indent=1)
print(f'{len(rows)} real recordings')
print(f"{'label':52s} n_pos  pos_median  neg_p95  threshold  sens  spec")
for name in wanted:
    e = out[name]
    f = lambda v: '   -' if v is None else f'{v:.2f}'
    print(f"{name:52s} {e['n_pos']:5d}  {f(e['pos_median']):>10s}  {e['neg_p95']:7.2f}  {e['threshold']:9.2f}  {f(e['sensitivity'])}  {f(e['specificity'])}")
