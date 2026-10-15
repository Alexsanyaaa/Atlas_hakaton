#!/usr/bin/env bash
# ROCm 7.2.1 + ROCDXG requires this environment for WSL GPU discovery.
export HSA_ENABLE_DXG_DETECTION=1
export LD_LIBRARY_PATH="/opt/rocm/lib:/usr/lib/wsl/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="/opt/rocm/bin:$PATH"
export PYTHONUTF8=1
