#!/usr/bin/env bash
set -euo pipefail
task_project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$task_project_root"
source scripts/rocm_wsl_env.sh
.venv-wsl/bin/python verify_training_bundle.py
.venv-wsl/bin/python check_gpu.py
exec .venv-wsl/bin/python train_transformer.py --config configs/rx9070xt_full.yaml
