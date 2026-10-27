#!/usr/bin/env bash
# Start a local Slurm 25.05 sandbox with the SlurmView RPC server, Redis and
# Postgres in one podman pod, then open a shell where `client` works.
#
#   ./up.sh          # build if needed, start, drop into a shell
#   ./down.sh        # stop and remove everything
#
# Run src/rpc/build-static.sh first so src/rpc/dist has the binaries.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
POD=sv-sandbox

[[ -x "$ROOT/src/rpc/dist/rpc" ]] || { echo "run src/rpc/build-static.sh first" >&2; exit 1; }

if ! podman image exists slurmview-sandbox; then
  echo "Building Slurm 25.05 sandbox image (compiles Slurm; takes a few minutes)..."
  podman build -t slurmview-sandbox "$HERE"
fi

if ! podman pod exists "$POD"; then
  podman pod create --name "$POD" >/dev/null
  podman run -d --pod "$POD" --name sv-sb-redis docker.io/library/redis:7-alpine >/dev/null
  podman run -d --pod "$POD" --name sv-sb-pg \
    -e POSTGRES_USER=sv -e POSTGRES_PASSWORD=sv -e POSTGRES_DB=sv \
    docker.io/library/postgres:17-alpine >/dev/null
  podman run -d --pod "$POD" --name sv-sb-slurm \
    -v "$ROOT/src/rpc/dist:/opt/slurmview:z" \
    -v "$ROOT/demo/worker-load:/opt/worker-load:z" \
    -e PATH=/opt/slurmview:/opt/worker-load:/opt/slurm/bin:/opt/slurm/sbin:/usr/local/bin:/usr/bin \
    -e RPC_ADDR=http://127.0.0.1:50551 \
    slurmview-sandbox >/dev/null

  echo "Waiting for Slurm and Postgres..."
  for _ in $(seq 60); do
    if podman exec sv-sb-slurm sinfo -h >/dev/null 2>&1 \
       && podman exec sv-sb-pg pg_isready -q -U sv 2>/dev/null; then
      break
    fi
    sleep 1
  done

  podman exec -d sv-sb-slurm sh -c '
    REDIS_URL=redis://127.0.0.1:6379 \
    DATABASE_URL=postgres://sv:sv@127.0.0.1:5432/sv \
    STATS_SAMPLE_INTERVAL_SECS=${STATS_SAMPLE_INTERVAL_SECS:-10} \
    RPC_ADDR=127.0.0.1:50551 \
    rpc > /tmp/rpc.log 2>&1'
  sleep 2
fi

podman exec sv-sb-slurm sh -c 'sinfo; echo; cat /tmp/rpc.log'
cat <<'MSG'

Inside the sandbox shell, try:
  client partitions
  client nodes
  submit.sh -m 5            # demo load; cancel.sh to clean up
  client jobs --repeat 3 -q
  client history --lookback 600 --bucket 30
Server log: /tmp/rpc.log. Exit the shell to leave the sandbox running.
MSG
if [[ -t 0 ]]; then
  exec podman exec -it -w /tmp sv-sb-slurm bash
fi
echo "(no terminal; open a shell with: podman exec -it -w /tmp sv-sb-slurm bash)"
