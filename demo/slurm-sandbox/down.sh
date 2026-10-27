#!/usr/bin/env bash
# Stop and remove the sandbox pod (Slurm, RPC server, Redis, Postgres).
set -euo pipefail
podman pod rm -f sv-sandbox >/dev/null 2>&1 && echo "Sandbox removed." || echo "No sandbox running."
