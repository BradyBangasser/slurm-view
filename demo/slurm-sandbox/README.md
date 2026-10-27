# Slurm sandbox

A real Slurm 25.05 cluster in one container (munge, slurmctld, and four
slurmd instances posing as nodes `c1`-`c4` in partitions `compute` and
`debug`), plus Redis, Postgres and the SlurmView RPC server, all in one podman
pod. Use it to demo or test the backend without cluster access.

```sh
src/rpc/build-static.sh          # once, and after changing the Rust code
demo/slurm-sandbox/up.sh         # first run compiles Slurm (a few minutes)
```

`up.sh` leaves you in a shell inside the cluster with `client`, `submit.sh`
and `cancel.sh` on the PATH:

```sh
client partitions
client nodes
submit.sh -m 5                   # worker load demo
client jobs --repeat 3 -q
client history --lookback 600 --bucket 30
```

Exiting the shell leaves the sandbox running; `up.sh` reattaches.
`demo/slurm-sandbox/down.sh` removes it. The RPC server log is `/tmp/rpc.log`
inside the container, and stats are sampled every 10s
(`STATS_SAMPLE_INTERVAL_SECS`).

Everything runs as root with a throwaway munge key, and the node hardware is
whatever `slurm.conf` says. Demo use only.
