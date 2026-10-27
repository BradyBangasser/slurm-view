# Backend demo

The RPC server talks to Slurm by running `squeue` and `scontrol`, so it has to
run on a machine that is a working Slurm client (a login node), or inside the
[sandbox cluster](../../demo/slurm-sandbox). The CLI (`client`) talks to the
server over gRPC.

Requires Slurm 25.05 or newer (JSON data parsers v0.0.43-v0.0.45).

No cluster access, or want a rehearsal? `demo/slurm-sandbox/up.sh` runs the
whole stack against a real Slurm 25.05 in a local container; the demo script
in step 5 works there with `client` in place of `./client`.

## 1. Build static binaries (on your machine)

```sh
src/rpc/build-static.sh        # -> src/rpc/dist/rpc, src/rpc/dist/client
```

These are fully static (musl), so they run on any x86_64 login node whatever
its glibc. Needs podman or docker locally; nothing is installed on the cluster.

## 2. Copy them to the login node

```sh
ssh login 'mkdir -p ~/slurmview'
scp src/rpc/dist/rpc src/rpc/dist/client login:~/slurmview/
scp -r demo/worker-load login:~/slurmview/   # optional: load for the cluster
```

## 3. Start Redis and Postgres locally, tunnel them to the login node

Both are optional. Without Redis every call goes to Slurm and reports
`cache: off`; without Postgres `history` is disabled. Login nodes rarely have
either, so run them on your machine and reverse-tunnel them in:

```sh
REDIS_PASSWORD=$(openssl rand -hex 16); echo "$REDIS_PASSWORD"
podman run -d --rm --name sv-redis -p 127.0.0.1:6379:6379 \
  docker.io/library/redis:7-alpine redis-server --requirepass "$REDIS_PASSWORD"
podman run -d --rm --name sv-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=sv -e POSTGRES_PASSWORD=sv -e POSTGRES_DB=sv \
  docker.io/library/postgres:17-alpine

ssh -R 16379:127.0.0.1:6379 -R 15432:127.0.0.1:5432 login
```

The tunnelled ports listen on the login node's loopback, which other users on
that node can reach while you are connected; hence the Redis password. Pick
other port numbers if those are taken. If the site disables TCP forwarding,
skip this step and demo with `cache: off`.

## 4. Run the server (in the ssh session)

```sh
cd ~/slurmview
export REDIS_URL="redis://:<password>@127.0.0.1:16379"
export DATABASE_URL="postgres://sv:sv@127.0.0.1:15432/sv"
export RPC_ADDR=127.0.0.1:50551
./rpc &
```

Expected output:

```
Caching responses in Redis at redis://...
Recording stats every 60s, keeping 2592000s
SlurmView RPC listening on 127.0.0.1:50551 (data parser v0.0.45)
```

If it exits with "none of the supported data parsers are installed", the
cluster's Slurm is older than 25.05. Set `STATS_SAMPLE_INTERVAL_SECS=10` to
fill the history faster during the demo.

## 5. Demo script

```sh
export RPC_ADDR=http://127.0.0.1:50551

./client partitions
./client nodes
./client jobs --state R --state PD
./client job <jobid>

# Request-level caching: first call misses and runs squeue, the rest are
# served from Redis.
./client jobs --repeat 4 -q

# The key covers request metadata: a different header is a different entry.
./client jobs -H x-team=hpc -q
./client jobs -H x-team=hpc -q

# --bypass skips the read and refreshes the entry.
./client jobs --bypass -q

# Stats history (needs Postgres and a few sample intervals).
./client history --lookback 600 --bucket 60
./client history --partition <name> --lookback 600 --bucket 60
```

To make the numbers move, submit the worker load demo in another shell
(`~/slurmview/worker-load/submit.sh -p <partition> -m 10`) and watch
`./client nodes` and `./client history` change. Clean up with
`~/slurmview/worker-load/cancel.sh`.

Stop the server with `kill %1` and the local containers with
`podman stop sv-redis sv-pg`.
