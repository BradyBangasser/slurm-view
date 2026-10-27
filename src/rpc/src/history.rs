//! Stats history in Postgres.
//!
//! A background [`Sampler`] snapshots Slurm on an interval and writes one
//! [`StatsSample`] per scope (the cluster plus each partition) into
//! `stats_samples`. [`StatsHistory::query`] averages samples into
//! fixed-width time buckets for the `GetStatsHistory` RPC.

use std::collections::BTreeSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::{Postgres, QueryBuilder};

use crate::slurm::Slurm;
use crate::slurmview::StatsPoint;
use crate::stats::{StatsSample, job_in_partition, summarize};

/// The `partition` value that stands for the whole cluster.
const CLUSTER_SCOPE: &str = "";

#[derive(Clone)]
pub struct StatsHistory {
    pool: PgPool,
}

impl StatsHistory {
    /// Connect and apply pending migrations.
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect(database_url)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    /// Insert one sample per scope, all stamped with the same time.
    pub async fn record(
        &self,
        sampled_at: SystemTime,
        samples: &[(String, StatsSample)],
    ) -> Result<(), sqlx::Error> {
        if samples.is_empty() {
            return Ok(());
        }
        let at = unix_seconds_f64(sampled_at);

        let mut query = QueryBuilder::<Postgres>::new(
            "INSERT INTO stats_samples (sampled_at, partition, \
             cpu_configured, cpu_allocated, cpu_available, cpu_unavailable, \
             memory_total_mib, memory_allocated_mib, memory_unallocated_mib, memory_unavailable_mib, \
             gpu_total, gpu_allocated, gpu_available, gpu_unavailable, \
             nodes_total, nodes_down, nodes_restricted, jobs_running, jobs_pending) ",
        );
        query.push_values(samples, |mut row, (partition, s)| {
            row.push("to_timestamp(")
                .push_bind_unseparated(at)
                .push_unseparated(")")
                .push_bind(partition)
                .push_bind(s.cpu_configured)
                .push_bind(s.cpu_allocated)
                .push_bind(s.cpu_available)
                .push_bind(s.cpu_unavailable)
                .push_bind(s.memory_total_mib)
                .push_bind(s.memory_allocated_mib)
                .push_bind(s.memory_unallocated_mib)
                .push_bind(s.memory_unavailable_mib)
                .push_bind(s.gpu_total)
                .push_bind(s.gpu_allocated)
                .push_bind(s.gpu_available)
                .push_bind(s.gpu_unavailable)
                .push_bind(s.nodes_total)
                .push_bind(s.nodes_down)
                .push_bind(s.nodes_restricted)
                .push_bind(s.jobs_running)
                .push_bind(s.jobs_pending);
        });
        query.push(" ON CONFLICT (partition, sampled_at) DO NOTHING");
        query.build().execute(&self.pool).await?;
        Ok(())
    }

    /// Delete samples older than `retention`. Returns the number removed.
    pub async fn prune(&self, retention: Duration) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "DELETE FROM stats_samples WHERE sampled_at < now() - make_interval(secs => $1)",
        )
        .bind(retention.as_secs_f64())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// Average samples in `[start, end)` into `bucket_secs`-wide buckets
    /// aligned to the unix epoch. Empty buckets are omitted.
    pub async fn query(
        &self,
        partition: Option<&str>,
        start: i64,
        end: i64,
        bucket_secs: i64,
    ) -> Result<Vec<StatsPoint>, sqlx::Error> {
        let rows: Vec<BucketRow> = sqlx::query_as(
            "SELECT \
                 (floor(extract(epoch FROM sampled_at) / $4) * $4)::bigint AS time, \
                 count(*)::bigint AS samples, \
                 avg(cpu_configured)::float8 AS cpu_configured, \
                 avg(cpu_allocated)::float8 AS cpu_allocated, \
                 avg(cpu_available)::float8 AS cpu_available, \
                 avg(cpu_unavailable)::float8 AS cpu_unavailable, \
                 avg(memory_total_mib)::float8 AS memory_total_mib, \
                 avg(memory_allocated_mib)::float8 AS memory_allocated_mib, \
                 avg(memory_unallocated_mib)::float8 AS memory_unallocated_mib, \
                 avg(memory_unavailable_mib)::float8 AS memory_unavailable_mib, \
                 avg(gpu_total)::float8 AS gpu_total, \
                 avg(gpu_allocated)::float8 AS gpu_allocated, \
                 avg(gpu_available)::float8 AS gpu_available, \
                 avg(gpu_unavailable)::float8 AS gpu_unavailable, \
                 avg(nodes_total)::float8 AS nodes_total, \
                 avg(nodes_down)::float8 AS nodes_down, \
                 avg(nodes_restricted)::float8 AS nodes_restricted, \
                 avg(jobs_running)::float8 AS jobs_running, \
                 avg(jobs_pending)::float8 AS jobs_pending \
             FROM stats_samples \
             WHERE partition = $1 \
               AND sampled_at >= to_timestamp($2) \
               AND sampled_at < to_timestamp($3) \
             GROUP BY 1 \
             ORDER BY 1",
        )
        .bind(partition.unwrap_or(CLUSTER_SCOPE))
        .bind(start as f64)
        .bind(end as f64)
        .bind(bucket_secs)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(BucketRow::into_point).collect())
    }
}

#[derive(sqlx::FromRow)]
struct BucketRow {
    time: i64,
    samples: i64,
    cpu_configured: f64,
    cpu_allocated: f64,
    cpu_available: f64,
    cpu_unavailable: f64,
    memory_total_mib: f64,
    memory_allocated_mib: f64,
    memory_unallocated_mib: f64,
    memory_unavailable_mib: f64,
    gpu_total: f64,
    gpu_allocated: f64,
    gpu_available: f64,
    gpu_unavailable: f64,
    nodes_total: f64,
    nodes_down: f64,
    nodes_restricted: f64,
    jobs_running: f64,
    jobs_pending: f64,
}

impl BucketRow {
    fn into_point(self) -> StatsPoint {
        StatsPoint {
            time: self.time,
            samples: u32::try_from(self.samples).unwrap_or(u32::MAX),
            cpu_configured: self.cpu_configured,
            cpu_allocated: self.cpu_allocated,
            cpu_available: self.cpu_available,
            cpu_unavailable: self.cpu_unavailable,
            memory_total_mib: self.memory_total_mib,
            memory_allocated_mib: self.memory_allocated_mib,
            memory_unallocated_mib: self.memory_unallocated_mib,
            memory_unavailable_mib: self.memory_unavailable_mib,
            gpu_total: self.gpu_total,
            gpu_allocated: self.gpu_allocated,
            gpu_available: self.gpu_available,
            gpu_unavailable: self.gpu_unavailable,
            nodes_total: self.nodes_total,
            nodes_down: self.nodes_down,
            nodes_restricted: self.nodes_restricted,
            jobs_running: self.jobs_running,
            jobs_pending: self.jobs_pending,
        }
    }
}

/// Periodically snapshots Slurm into [`StatsHistory`].
pub struct Sampler {
    pub slurm: Slurm,
    pub history: StatsHistory,
    pub interval: Duration,
    pub retention: Duration,
}

impl Sampler {
    /// Run forever. A failed tick is logged and skipped; the next one retries.
    pub async fn run(self) {
        let mut ticker = tokio::time::interval(self.interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if let Err(e) = self.tick().await {
                eprintln!("[stats] sample failed: {e}");
            }
        }
    }

    async fn tick(&self) -> Result<(), Box<dyn std::error::Error>> {
        let sampled_at = SystemTime::now();
        let states = ["R".to_owned(), "PD".to_owned()];
        let (nodes, jobs) = tokio::try_join!(
            self.slurm.list_nodes(None),
            self.slurm.list_jobs(&states, None, None),
        )?;

        let partitions: BTreeSet<&str> = nodes
            .iter()
            .flat_map(|n| n.partitions.iter().map(String::as_str))
            .collect();

        let mut samples = vec![(CLUSTER_SCOPE.to_owned(), summarize(&nodes, &jobs))];
        for partition in partitions {
            let sample = summarize(
                nodes
                    .iter()
                    .filter(|n| n.partitions.iter().any(|p| p == partition)),
                jobs.iter().filter(|j| job_in_partition(j, partition)),
            );
            samples.push((partition.to_owned(), sample));
        }

        self.history.record(sampled_at, &samples).await?;
        let pruned = self.history.prune(self.retention).await?;
        if pruned > 0 {
            println!("[stats] pruned {pruned} samples past retention");
        }
        Ok(())
    }
}

pub fn unix_now() -> i64 {
    unix_seconds_f64(SystemTime::now()) as i64
}

fn unix_seconds_f64(t: SystemTime) -> f64 {
    t.duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64())
}
