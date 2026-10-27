#!/usr/bin/env bash
# Submit a small mix of demo jobs so Slurm View has something to show.
#
#   slurmview-demo-load  array of 6 tasks, 2 CPUs each, at low/medium/high
#                        CPU load (2 tasks per load bucket)
#   slurmview-demo-mem   1 CPU holding most of its memory request
#   slurmview-demo-dep   pending on the load array (reason: Dependency)
#   slurmview-demo-held  pending on a user hold (reason: JobHeldUser)
#   slurmview-demo-gpu   only with --gpus N: holds N GPUs at light load
#
# Remove everything with ./cancel.sh. The workload is copied into each batch
# script, so the worker nodes need python3 but no shared filesystem.
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 [options]
  -p, --partition NAME   partition to submit to (default: cluster default)
  -A, --account NAME     account to charge
  -m, --minutes N        how long the load runs (default: 10)
  -g, --gpus N           also submit a job holding N GPUs (default: 0)
  -o, --logs DIR         write job output to DIR (must exist on the nodes;
                         default: discard)
  -n, --dry-run          print the sbatch calls and the first batch script
                         instead of submitting
  -h, --help
EOF
}

PARTITION="" ACCOUNT="" MINUTES=10 GPUS=0 LOGS="" DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--partition) PARTITION="$2"; shift 2 ;;
    -A|--account)   ACCOUNT="$2"; shift 2 ;;
    -m|--minutes)   MINUTES="$2"; shift 2 ;;
    -g|--gpus)      GPUS="$2"; shift 2 ;;
    -o|--logs)      LOGS="$2"; shift 2 ;;
    -n|--dry-run)   DRY_RUN=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$MINUTES" =~ ^[1-9][0-9]*$ ]] || { echo "--minutes must be a positive integer" >&2; exit 2; }
[[ "$GPUS" =~ ^[0-9]+$ ]] || { echo "--gpus must be a non-negative integer" >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOAD_PY="$(cat "$HERE/load.py")"
SECONDS_TO_RUN=$((MINUTES * 60))

# Time limit leaves slack for startup; the workload exits on its own first.
COMMON=(--time="$((MINUTES + 2))" --output="${LOGS:-/dev/null}${LOGS:+/%x-%j.out}")
[[ -n "$PARTITION" ]] && COMMON+=(--partition="$PARTITION")
[[ -n "$ACCOUNT" ]] && COMMON+=(--account="$ACCOUNT")
if [[ -n "$LOGS" && "$LOGS" != /* ]]; then
  echo "--logs must be an absolute path" >&2
  exit 2
fi

# Batch script that runs load.py with the given arguments.
batch_script() {
  printf '#!/bin/bash\nexec python3 - %s <<'"'"'SLURMVIEW_DEMO_PY'"'"'\n%s\nSLURMVIEW_DEMO_PY\n' \
    "$*" "$LOAD_PY"
}

if [[ $DRY_RUN -eq 1 ]]; then
  echo "Each job's batch script looks like:" >&2
  batch_script --duty 0.5 --seconds "$SECONDS_TO_RUN" | head -n 2 | sed 's/^/    | /' >&2
  echo "    | ... (load.py inlined)" >&2
  echo >&2
fi

# submit <load.py args> -- <sbatch args>; prints the job id.
submit() {
  local load_args=()
  while [[ "$1" != "--" ]]; do load_args+=("$1"); shift; done
  shift
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "sbatch --parsable ${COMMON[*]} $*  # load.py ${load_args[*]}" >&2
    echo "DRYRUN$RANDOM"
  else
    batch_script "${load_args[@]}" | sbatch --parsable "${COMMON[@]}" "$@" | cut -d';' -f1
  fi
}

# Two tasks per CPU load bucket: low (<33%), medium, high (>66%).
LOAD_ID=$(submit --duty-levels 0.15,0.15,0.5,0.5,0.95,0.95 --seconds "$SECONDS_TO_RUN" -- \
  --job-name=slurmview-demo-load --array=0-5 --cpus-per-task=2 --mem-per-cpu=512M)
echo "load array:  $LOAD_ID"

MEM_ID=$(submit --duty 0.05 --mem-mib 3072 --seconds "$SECONDS_TO_RUN" -- \
  --job-name=slurmview-demo-mem --cpus-per-task=1 --mem=4G)
echo "memory:      $MEM_ID"

DEP_ID=$(submit --duty 0.5 --seconds 60 -- \
  --job-name=slurmview-demo-dep --cpus-per-task=1 --mem=256M \
  --dependency="afterany:$LOAD_ID")
echo "dependent:   $DEP_ID (pending until the load array finishes)"

HELD_ID=$(submit --duty 0.5 --seconds 60 -- \
  --job-name=slurmview-demo-held --cpus-per-task=1 --mem=256M --hold)
echo "held:        $HELD_ID (release with: scontrol release $HELD_ID)"

if [[ "$GPUS" -gt 0 ]]; then
  GPU_ID=$(submit --duty 0.1 --seconds "$SECONDS_TO_RUN" -- \
    --job-name=slurmview-demo-gpu --cpus-per-task=1 --mem=1G --gres="gpu:$GPUS")
  echo "gpu:         $GPU_ID"
fi

echo
echo "Watch with:  squeue --me --name=slurmview-demo-load,slurmview-demo-mem,slurmview-demo-dep,slurmview-demo-held,slurmview-demo-gpu"
echo "Clean up:    $HERE/cancel.sh"
