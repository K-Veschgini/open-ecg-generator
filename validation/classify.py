"""Runs the synthetic ECGs from export.mjs through ECGFounder and reports, per pathology,
how many are recognised as the intended diagnosis (thresholds from controls.py, i.e. real ECGs).
Usage: python classify.py"""
import json, os, warnings
import numpy as np
import model as M
from targets import TARGETS
warnings.filterwarnings('ignore')

OUT = os.path.join(M.HERE, 'out')
L = M.labels()
idx = json.load(open(os.path.join(OUT, 'index.json')))
ctl = json.load(open(os.path.join(OUT, 'controls.json')))
net = M.load_model()
# labels that describe any recording and therefore are not "unexpected findings"
GENERIC = {'ABNORMAL ECG', 'NORMAL SINUS RHYTHM', 'SINUS RHYTHM', 'BORDERLINE ECG', 'otherwise normal ecg'}
report = {}
print(f"settings: {idx['count']} ECGs per pathology, noise {idx['noiseLevel']}, variation {idx['variation']}\n")
for p in idx['pathologies']:
    name = p['name']
    x = np.fromfile(os.path.join(OUT, p['file']), dtype=np.float32).reshape(-1, 12, idx['samples'])
    P = M.predict(net, x)
    t = TARGETS[name]
    def stat(label):
        i = L.index(label); thr = ctl[label]['threshold']
        return {'label': label, 'detected': float(np.mean(P[:, i] >= thr)), 'median': float(np.median(P[:, i])),
                'threshold': thr, 'real_pos_median': ctl[label]['pos_median'], 'n_real_pos': ctl[label]['n_pos']}
    prim = [stat(l) for l in t['primary']]
    rel = [stat(l) for l in t['related']]
    expected = set(t['primary']) | set(t['related']) | GENERIC
    other = []
    for i, label in enumerate(L):
        if label in expected:
            continue
        rate = float(np.mean(P[:, i] >= ctl[label]['threshold']))
        if rate >= 0.5 and np.median(P[:, i]) >= 0.5:
            other.append({'label': label, 'detected': rate, 'median': float(np.median(P[:, i]))})
    other.sort(key=lambda o: -o['median'])
    verdict = ('NOT VERIFIABLE (no label)' if not prim else
               'PASS' if all(s['detected'] >= 0.8 for s in prim) else
               'PARTIAL' if any(s['detected'] >= 0.2 for s in prim) else 'FAIL')
    report[name] = {'verdict': verdict, 'primary': prim, 'related': rel, 'other': other}
    print(f'=== {name}: {verdict}')
    for kind, items in (('primary', prim), ('related', rel)):
        for s in items:
            rp = '-' if s['real_pos_median'] is None else f"{s['real_pos_median']:.2f}"
            print(f"  {kind:8s} {s['label']:50s} detected {s['detected']*100:4.0f}%  median score {s['median']:.2f}"
                  f"  (threshold {s['threshold']:.2f}, real positives median {rp}, n={s['n_real_pos']})")
    for o in other[:6]:
        print(f"  also     {o['label']:50s} detected {o['detected']*100:4.0f}%  median score {o['median']:.2f}")
json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
