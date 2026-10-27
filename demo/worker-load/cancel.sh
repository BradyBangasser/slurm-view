#!/usr/bin/env bash
# Cancel every job submitted by submit.sh (yours only).
set -euo pipefail
scancel --me --name=slurmview-demo-load,slurmview-demo-mem,slurmview-demo-dep,slurmview-demo-held,slurmview-demo-gpu
echo "Cancelled slurmview-demo jobs."
