#!/usr/bin/env python3
"""Synthetic load for a Slurm allocation. Standard library only.

Keeps every allocated CPU busy for a fraction of each 100 ms period (the
duty cycle) and optionally holds a block of memory, so the dashboard's CPU
load buckets and memory usage have something to show.

    load.py --duty 0.5 --seconds 600 --mem-mib 1024

With --duty-levels, an array task picks its duty from the list by
SLURM_ARRAY_TASK_ID, so one array job spreads across load buckets.
"""

import argparse
import multiprocessing
import os
import signal
import sys
import time

PERIOD = 0.1
PAGE = 4096


def burn(duty: float, deadline: float) -> None:
    busy = PERIOD * duty
    while time.monotonic() < deadline:
        start = time.monotonic()
        while time.monotonic() - start < busy:
            pass
        rest = PERIOD - (time.monotonic() - start)
        if rest > 0:
            time.sleep(rest)


def hold_memory(mib: int) -> bytearray:
    block = bytearray(mib * 1024 * 1024)
    # Touch every page so the memory is resident, not just reserved.
    for offset in range(0, len(block), PAGE):
        block[offset] = 1
    return block


def allocated_cpus() -> int:
    for var in ("SLURM_CPUS_PER_TASK", "SLURM_CPUS_ON_NODE"):
        value = os.environ.get(var, "")
        if value.isdigit() and int(value) > 0:
            return int(value)
    try:
        return len(os.sched_getaffinity(0))
    except AttributeError:
        return os.cpu_count() or 1


def pick_duty(args: argparse.Namespace) -> float:
    if not args.duty_levels:
        return args.duty
    levels = [float(x) for x in args.duty_levels.split(",")]
    task = int(os.environ.get("SLURM_ARRAY_TASK_ID", "0"))
    return levels[task % len(levels)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--duty", type=float, default=1.0, help="busy fraction, 0-1")
    parser.add_argument("--duty-levels", help="comma list chosen by array task id")
    parser.add_argument("--seconds", type=float, default=600)
    parser.add_argument("--mem-mib", type=int, default=0)
    parser.add_argument("--procs", type=int, default=0, help="default: allocated CPUs")
    args = parser.parse_args()

    duty = min(max(pick_duty(args), 0.0), 1.0)
    procs = args.procs or allocated_cpus()
    deadline = time.monotonic() + args.seconds

    # scancel and the time limit send SIGTERM; exit cleanly so the job ends
    # CANCELLED/TIMEOUT rather than FAILED with a traceback.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    print(
        f"{os.uname().nodename}: {procs} procs at duty {duty:.2f}, "
        f"{args.mem_mib} MiB, {args.seconds:.0f}s",
        flush=True,
    )

    # fork, not the 3.14+ forkserver default: forkserver re-imports __main__
    # from its path, and the batch script feeds this file in on stdin.
    ctx = multiprocessing.get_context("fork")
    workers = [
        ctx.Process(target=burn, args=(duty, deadline), daemon=True)
        for _ in range(procs)
    ]
    for worker in workers:
        worker.start()
    # Allocate after forking so only this process holds the memory.
    memory = hold_memory(args.mem_mib) if args.mem_mib > 0 else None
    for worker in workers:
        worker.join()
    del memory
    print("done", flush=True)


if __name__ == "__main__":
    main()
