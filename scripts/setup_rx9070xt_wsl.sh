#!/usr/bin/env bash
# User-invoked installer for Ubuntu 24.04 inside WSL2, not native Windows.
set -euo pipefail
task_project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$task_project_root"
if [[ ! -e /dev/dxg ]]; then
    echo 'WSL2 GPU device /dev/dxg is missing. Check Windows AMD driver and WSL2 first.' >&2
    exit 1
fi
if [[ "$(python3 -c 'import sys; print(".".join(map(str,sys.version_info[:2])))')" != '3.12' ]]; then
    echo 'This pinned setup requires Ubuntu 24.04 with Python 3.12.' >&2
    exit 1
fi
sudo apt-get update
sudo apt-get install -y wget ca-certificates python3.12-venv python3-pip python3-setuptools python3-wheel
task_download_dir="$(mktemp -d)"
trap 'rm -rf -- "$task_download_dir"' EXIT

# Official AMD repository bootstrap. Install userspace ROCm only, no Linux
# kernel/display driver inside WSL. Windows remains the GPU-driver owner.
wget -q -O "$task_download_dir/amdgpu-install.deb" \
 'https://repo.radeon.com/amdgpu-install/7.2.1/ubuntu/noble/amdgpu-install_7.2.1.70201-1_all.deb'
sudo apt-get install -y "$task_download_dir/amdgpu-install.deb"
sudo apt-get update
sudo apt-get install -y 'rocm=7.2.1.70201-81~24.04'

# Version documented as compatible with ROCm 7.2.x in AMD's own project.
wget -q -O "$task_download_dir/rocdxg-roct.deb" \
 'https://github.com/ROCm/librocdxg/releases/download/v1.2.0/rocdxg-roct_1.2.0_amd64.deb'
sudo dpkg -i "$task_download_dir/rocdxg-roct.deb"
sudo ldconfig
source scripts/rocm_wsl_env.sh

python3.12 -m venv .venv-wsl
.venv-wsl/bin/python -m pip install --upgrade pip wheel
.venv-wsl/bin/python -m pip install --no-cache-dir \
 'https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2.1/torch-2.9.1%2Brocm7.2.1.lw.gitff65f5bc-cp312-cp312-linux_x86_64.whl' \
 'https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2.1/triton-3.5.1%2Brocm7.2.1.gita272dfa8-cp312-cp312-linux_x86_64.whl'
.venv-wsl/bin/python -m pip install -r requirements-transformer-demo.txt
.venv-wsl/bin/python check_gpu.py
.venv-wsl/bin/python verify_refinement_bundle.py
echo 'Ready. Train with: bash scripts/run_refinement_wsl.sh --variant D'
