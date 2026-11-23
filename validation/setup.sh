#!/usr/bin/env bash
# Sets up the Python environment and downloads the ECGFounder classifier
# (MIT licence, https://github.com/PKUDigitalHealth/ECGFounder) into .cache/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .cache
uv venv --python 3.12 .cache/venv
uv pip install --python .cache/venv/bin/python "torch>=2.4" "numpy<2.3" scipy wfdb pandas
if [ ! -d .cache/ECGFounder ]; then
  git clone https://github.com/PKUDigitalHealth/ECGFounder.git .cache/ECGFounder
  git -C .cache/ECGFounder checkout 04edac702b61c91face519774ddcc0cd712fef23
fi
if [ ! -f .cache/12_lead_ECGFounder.pth ]; then
  curl -L --fail -o .cache/12_lead_ECGFounder.pth \
    https://huggingface.co/PKUDigitalHealth/ECGFounder/resolve/main/12_lead_ECGFounder.pth
fi
echo "setup complete"
