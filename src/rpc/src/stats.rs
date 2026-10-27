//! Point-in-time cluster stats, aggregated from one node and job snapshot.
//!
//! Ported from `src/server/services/stats-service.ts` so the history agrees
//! with the live dashboard. Hard-down nodes count whole as unavailable;
//! allocations on restricted (draining, errored) nodes persist but their
//! unallocated remainder is unavailable; only schedulable nodes contribute
//! available capacity.

use crate::slurmview::{Job, Node, SlurmNumber};

const NODE_BASE_STATES: &[&str] = &["ALLOCATED", "DOWN", "ERROR", "FUTURE", "IDLE", "MIXED"];
const HARD_DOWN_FLAGS: &[&str] = &["FAIL", "NOT_RESPONDING", "POWERED_DOWN", "POWERING_DOWN"];
const RESTRICTED_FLAGS: &[&str] = &["DRAIN", "DRAINED", "DRAINING", "FAILING"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Availability {
    Down,
    Restricted,
    Available,
}

/// The base state is the first known base token; everything else is a flag.
/// Nodes without a known base state count as down.
pub fn node_availability(states: &[String]) -> Availability {
    let tokens: Vec<String> = states.iter().map(|s| s.trim().to_uppercase()).collect();
    let base = tokens
        .iter()
        .position(|t| NODE_BASE_STATES.contains(&t.as_str()));
    let Some(base) = base else {
        return Availability::Down;
    };
    let flags = || {
        tokens
            .iter()
            .enumerate()
            .filter(move |(i, _)| *i != base)
            .map(|(_, t)| t.as_str())
    };

    match tokens[base].as_str() {
        "DOWN" | "FUTURE" => Availability::Down,
        _ if flags().any(|f| HARD_DOWN_FLAGS.contains(&f)) => Availability::Down,
        "ERROR" => Availability::Restricted,
        _ if flags().any(|f| RESTRICTED_FLAGS.contains(&f)) => Availability::Restricted,
        _ => Availability::Available,
    }
}

/// One sample for one scope (the cluster or a partition).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StatsSample {
    pub cpu_configured: i64,
    pub cpu_allocated: i64,
    pub cpu_available: i64,
    pub cpu_unavailable: i64,

    pub memory_total_mib: i64,
    pub memory_allocated_mib: i64,
    pub memory_unallocated_mib: i64,
    pub memory_unavailable_mib: i64,

    pub gpu_total: i64,
    pub gpu_allocated: i64,
    pub gpu_available: i64,
    pub gpu_unavailable: i64,

    pub nodes_total: i64,
    pub nodes_down: i64,
    pub nodes_restricted: i64,

    pub jobs_running: i64,
    pub jobs_pending: i64,
}

/// Aggregate the given nodes and jobs. Callers scope both to a partition.
pub fn summarize<'a>(
    nodes: impl IntoIterator<Item = &'a Node>,
    jobs: impl IntoIterator<Item = &'a Job>,
) -> StatsSample {
    let mut s = StatsSample::default();

    for node in nodes {
        let availability = node_availability(&node.states);
        s.nodes_total += 1;

        // CPU
        let cpus = value(node.cpus);
        let effective = node
            .effective_cpus
            .filter(|n| n.set)
            .map_or(cpus, |n| n.number.max(0));
        s.cpu_configured += cpus;
        // Memory
        let memory = value(node.real_memory);
        s.memory_total_mib += memory;
        // GPU
        let (gpus, gpus_used) = (
            gpu_count(node.gres.as_deref()),
            gpu_count(node.gres_used.as_deref()),
        );
        s.gpu_total += gpus;

        if availability == Availability::Down {
            s.nodes_down += 1;
            s.cpu_unavailable += cpus;
            s.memory_unavailable_mib += memory;
            s.gpu_unavailable += gpus;
            continue;
        }

        // Configured capacity outside the effective set never schedules.
        // Clamp so the invariant holds even if Slurm reports effective > cpus.
        let effective = effective.min(cpus);
        s.cpu_unavailable += cpus - effective;
        let cpu_alloc = value(node.alloc_cpus).min(effective);
        s.cpu_allocated += cpu_alloc;
        let cpu_rest = effective - cpu_alloc;

        let mem_alloc = value(node.alloc_memory).min(memory);
        s.memory_allocated_mib += mem_alloc;
        let mem_rest = memory - mem_alloc;

        let gpu_alloc = gpus_used.min(gpus);
        s.gpu_allocated += gpu_alloc;
        let gpu_rest = gpus - gpu_alloc;

        if availability == Availability::Restricted {
            s.nodes_restricted += 1;
            s.cpu_unavailable += cpu_rest;
            s.memory_unavailable_mib += mem_rest;
            s.gpu_unavailable += gpu_rest;
        } else {
            s.cpu_available += cpu_rest;
            s.memory_unallocated_mib += mem_rest;
            s.gpu_available += gpu_rest;
        }
    }

    for job in jobs {
        match job.states.first().map(String::as_str) {
            Some("RUNNING") => s.jobs_running += 1,
            Some("PENDING") => s.jobs_pending += 1,
            _ => {}
        }
    }

    s
}

/// Whether a job belongs to `partition`. Pending jobs may list several
/// candidate partitions, comma separated.
pub fn job_in_partition(job: &Job, partition: &str) -> bool {
    job.partition.split(',').any(|p| p.trim() == partition)
}

fn value(n: Option<SlurmNumber>) -> i64 {
    n.filter(|n| n.set && !n.infinite)
        .map_or(0, |n| n.number.max(0))
}

/// Total GPUs in a GRES string. Accepts `gpu:N` and `gpu:TYPE:N`, ignores
/// `(IDX:…)` suffixes and non-GPU GRES such as `shard`.
pub fn gpu_count(gres: Option<&str>) -> i64 {
    let Some(gres) = gres else { return 0 };
    gres.split(',')
        .filter_map(|token| {
            let token = token.trim();
            let token = token.split('(').next()?;
            let mut parts = token.split(':');
            if parts.next()? != "gpu" {
                return None;
            }
            parts.next_back()?.parse::<i64>().ok()
        })
        .filter(|n| *n >= 0)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: i64) -> Option<SlurmNumber> {
        Some(SlurmNumber {
            set: true,
            infinite: false,
            number: n,
        })
    }

    fn node(states: &[&str], cpus: i64, alloc: i64, gres: &str, gres_used: &str) -> Node {
        Node {
            name: "n".to_owned(),
            states: states.iter().map(|s| (*s).to_owned()).collect(),
            cpus: num(cpus),
            effective_cpus: num(cpus),
            alloc_cpus: num(alloc),
            real_memory: num(1000),
            alloc_memory: num(alloc * 10),
            gres: Some(gres.to_owned()),
            gres_used: Some(gres_used.to_owned()),
            ..Default::default()
        }
    }

    fn job(state: &str, partition: &str) -> Job {
        Job {
            states: vec![state.to_owned()],
            partition: partition.to_owned(),
            ..Default::default()
        }
    }

    fn assert_invariants(s: &StatsSample) {
        assert_eq!(
            s.cpu_allocated + s.cpu_available + s.cpu_unavailable,
            s.cpu_configured
        );
        assert_eq!(
            s.memory_allocated_mib + s.memory_unallocated_mib + s.memory_unavailable_mib,
            s.memory_total_mib
        );
        assert_eq!(s.gpu_allocated + s.gpu_available + s.gpu_unavailable, s.gpu_total);
    }

    #[test]
    fn classifies_availability() {
        let a = |s: &[&str]| node_availability(&s.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>());
        assert_eq!(a(&["IDLE"]), Availability::Available);
        assert_eq!(a(&["MIXED", "DRAIN"]), Availability::Restricted);
        assert_eq!(a(&["ERROR"]), Availability::Restricted);
        assert_eq!(a(&["IDLE", "NOT_RESPONDING"]), Availability::Down);
        assert_eq!(a(&["DOWN"]), Availability::Down);
        assert_eq!(a(&["weird"]), Availability::Down);
    }

    #[test]
    fn counts_gpus() {
        assert_eq!(gpu_count(Some("gpu:a100:4")), 4);
        assert_eq!(gpu_count(Some("gpu:a100:2(IDX:0-1),gpu:v100:1(IDX:2)")), 3);
        assert_eq!(gpu_count(Some("gpu:2,shard:8")), 2);
        assert_eq!(gpu_count(Some("(null)")), 0);
        assert_eq!(gpu_count(None), 0);
    }

    #[test]
    fn splits_capacity_by_availability() {
        let nodes = [
            node(&["MIXED"], 64, 16, "gpu:a100:4", "gpu:a100:2(IDX:0-1)"),
            node(&["MIXED", "DRAIN"], 32, 8, "gpu:2", "gpu:1"),
            node(&["DOWN"], 16, 0, "gpu:1", ""),
        ];
        let jobs = [job("RUNNING", "gpu"), job("PENDING", "gpu"), job("COMPLETED", "gpu")];
        let s = summarize(&nodes, &jobs);

        assert_invariants(&s);
        assert_eq!(s.cpu_configured, 112);
        assert_eq!(s.cpu_allocated, 24);
        assert_eq!(s.cpu_available, 48);
        assert_eq!(s.cpu_unavailable, 24 + 16);
        assert_eq!(s.gpu_total, 7);
        assert_eq!(s.gpu_allocated, 3);
        assert_eq!(s.gpu_available, 2);
        assert_eq!(s.gpu_unavailable, 1 + 1);
        assert_eq!((s.nodes_total, s.nodes_down, s.nodes_restricted), (3, 1, 1));
        assert_eq!((s.jobs_running, s.jobs_pending), (1, 1));
    }

    #[test]
    fn specialized_cpus_are_unavailable() {
        let mut n = node(&["IDLE"], 64, 0, "", "");
        n.effective_cpus = num(60);
        let s = summarize([&n], []);
        assert_invariants(&s);
        assert_eq!((s.cpu_available, s.cpu_unavailable), (60, 4));
    }

    #[test]
    fn matches_multi_partition_jobs() {
        assert!(job_in_partition(&job("PENDING", "cpu,gpu"), "gpu"));
        assert!(!job_in_partition(&job("PENDING", "cpu,gpu"), "debug"));
    }
}
