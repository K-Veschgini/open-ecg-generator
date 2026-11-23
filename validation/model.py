"""Loads ECGFounder (150-label 12-lead classifier) and applies its preprocessing."""
import os, sys
import numpy as np
import torch
from scipy.signal import iirnotch, filtfilt, butter, medfilt

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
sys.path.insert(0, os.path.join(CACHE, 'ECGFounder'))
from net1d import Net1D  # noqa: E402  (model definition from the ECGFounder repository)

LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']


def labels():
    with open(os.path.join(CACHE, 'ECGFounder', 'tasks.txt')) as f:
        return [line.strip() for line in f if line.strip()]


def load_model():
    model = Net1D(in_channels=12, base_filters=64, ratio=1,
                  filter_list=[64, 160, 160, 400, 400, 1024, 1024], m_blocks_list=[2, 2, 2, 3, 3, 4, 4],
                  kernel_size=16, stride=2, groups_width=16, verbose=False, use_bn=False, use_do=False,
                  n_classes=150)
    # The checkpoint stores a few NumPy scalars next to the weights; allow-list only those
    # types so the file is still loaded with weights_only=True (no arbitrary unpickling).
    from numpy._core.multiarray import scalar
    safe = [(scalar, 'numpy.core.multiarray.scalar'), np.dtype]
    safe += [type(np.dtype(t)) for t in ('float64', 'float32', 'int64')]
    with torch.serialization.safe_globals(safe):
        ckpt = torch.load(os.path.join(CACHE, '12_lead_ECGFounder.pth'), map_location='cpu', weights_only=True)
    log = model.load_state_dict(ckpt['state_dict'], strict=False)
    assert not log.missing_keys, log.missing_keys
    model.eval()
    return model


def bandpass(x, fs=500):
    """ECGFounder's filter_bandpass (util.py): 50 Hz notch, 0.67-40 Hz band-pass, median baseline removal."""
    b, a = iirnotch(50, 30, fs)
    y = filtfilt(b, a, x, axis=-1)
    b, a = butter(N=4, Wn=[0.67, 40], btype='bandpass', fs=fs)
    y = filtfilt(b, a, y, axis=-1)
    k = int(0.4 * fs) + 1
    k += (k % 2 == 0)
    base = np.stack([medfilt(c, kernel_size=k) for c in y])
    return y - base


def preprocess(x, mode):
    """x: (12, 5000) in mV, leads in LEADS order. mode: 'zscore' (ptbxl_eval.py) or 'filter' (dataset.py)."""
    x = np.nan_to_num(np.asarray(x, dtype=np.float64))
    if mode == 'filter':
        x = bandpass(x)
    return ((x - x.mean()) / (x.std() + 1e-8)).astype(np.float32)


@torch.no_grad()
def predict(model, batch, mode='zscore', bs=32):
    """batch: (n, 12, 5000) mV -> (n, 150) probabilities."""
    out = []
    for i in range(0, len(batch), bs):
        xb = torch.from_numpy(np.stack([preprocess(x, mode) for x in batch[i:i + bs]]))
        out.append(torch.sigmoid(model(xb)).numpy())
    return np.concatenate(out)
