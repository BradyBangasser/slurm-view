# Worker load demo

Submits a small, self-cleaning mix of jobs so Slurm View has something to
show: allocated CPUs in every load bucket, held memory, an array job, and
pending jobs with different reasons.

```sh
./submit.sh -p <partition> -m 10      # add -g 1 on a GPU partition
./submit.sh -n                        # dry run: print what would be submitted
./cancel.sh                           # cancel all demo jobs
```

| Job | Shape | Shows up as |
|---|---|---|
| `slurmview-demo-load` | array 0-5, 2 CPUs and 1 GiB each | running; tasks at 15%, 50% and 95% CPU (low / medium / high load) |
| `slurmview-demo-mem` | 1 CPU, `--mem=4G` | running; holds 3 GiB resident |
| `slurmview-demo-dep` | 1 CPU, `afterany` on the array | pending, reason `Dependency` |
| `slurmview-demo-held` | 1 CPU, `--hold` | pending, reason `JobHeldUser` until `scontrol release <id>` |
| `slurmview-demo-gpu` | `--gres=gpu:N`, only with `-g N` | running; N GPUs allocated |

In total that's 13 CPUs and 10 GiB while the load is running (plus the GPU
job if requested; the pending jobs hold nothing). Everything
ends on its own after `--minutes` (default 10), with a time limit 2 minutes
longer as a backstop.

Requirements on the worker nodes: `python3` (3.8+, standard library only).
The workload (`load.py`) is copied into each batch script, so no shared
filesystem is needed. Job output is discarded unless you pass `-o <dir>`,
which must be an absolute path that exists on the nodes.

`load.py` also runs on its own, e.g. inside `salloc`:

```sh
python3 load.py --duty 0.5 --seconds 60 --mem-mib 512
```
