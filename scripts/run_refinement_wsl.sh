#!/usr/bin/env bash
set -euo pipefail
task_refinement_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$task_refinement_root"
source scripts/rocm_wsl_env.sh
.venv-wsl/bin/python verify_refinement_bundle.py
.venv-wsl/bin/python check_gpu.py
exec .venv-wsl/bin/python train_refinement.py "$@"
