//! Command-line client for the SlurmView RPC.
//!
//!   client jobs --state R --user alice
//!   client job 123
//!   client nodes --partition gpu
//!   client partitions
//!   client history --lookback 3600
//!
//! Every call reports the server's cache outcome and the round-trip time on
//! stderr. `--repeat 3` shows a miss followed by hits; `-H key=value` adds
//! request metadata, which is part of the cache key.

use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use tonic::metadata::{MetadataKey, MetadataMap, MetadataValue};
use tonic::transport::Channel;
use tonic::{Request, Response};

use rpc::slurmview::slurm_view_client::SlurmViewClient;
use rpc::slurmview::{
    CacheParameters, GetJobRequest, GetStatsHistoryRequest, Job, ListJobsRequest,
    ListNodesRequest, ListPartitionsRequest, SlurmNumber,
};

#[derive(Parser)]
#[command(about = "Query a SlurmView RPC server")]
struct Cli {
    /// Server address.
    #[arg(long, env = "RPC_ADDR", default_value = "http://127.0.0.1:50051", global = true)]
    addr: String,

    /// Skip the cache read; the fresh response replaces the cached one.
    #[arg(long, global = true)]
    bypass: bool,

    /// Extra request metadata, e.g. -H x-team=hpc. Repeatable.
    #[arg(short = 'H', long = "header", value_name = "KEY=VALUE", global = true)]
    headers: Vec<String>,

    /// Send the same request this many times and report each outcome.
    #[arg(long, default_value_t = 1, global = true)]
    repeat: u32,

    /// Only print cache outcome and timing, not the response.
    #[arg(short, long, global = true)]
    quiet: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List jobs (default states R, PD, CD).
    Jobs {
        /// squeue state filter, e.g. R or PD. Repeatable.
        #[arg(long = "state")]
        states: Vec<String>,
        #[arg(long)]
        user: Option<String>,
        #[arg(long)]
        partition: Option<String>,
    },
    /// Show one job, by id or <arrayJobId>_<taskId>.
    Job { id: String },
    /// List nodes.
    Nodes {
        #[arg(long)]
        partition: Option<String>,
    },
    /// List partitions.
    Partitions,
    /// Stats history from Postgres.
    History {
        #[arg(long)]
        partition: Option<String>,
        /// Window length in seconds, ending now.
        #[arg(long, default_value_t = 3600)]
        lookback: u64,
        /// Bucket width in seconds; default picks about 200 points.
        #[arg(long)]
        bucket: Option<u64>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let metadata = parse_headers(&cli.headers)?;
    let mut client = SlurmViewClient::connect(cli.addr.clone()).await?;

    for run in 1..=cli.repeat.max(1) {
        let started = Instant::now();
        let printed = call(&mut client, &cli, metadata.clone(), run == 1 && !cli.quiet).await?;
        report(run, cli.repeat, &printed, started.elapsed());
    }
    Ok(())
}

/// Issue one request, printing the response body when `print` is set.
/// Returns the response metadata.
async fn call(
    client: &mut SlurmViewClient<Channel>,
    cli: &Cli,
    metadata: MetadataMap,
    print: bool,
) -> anyhow::Result<MetadataMap> {
    let cache_params = Some(CacheParameters {
        bypass_cache: cli.bypass,
    });

    Ok(match &cli.command {
        Command::Jobs {
            states,
            user,
            partition,
        } => {
            let response = client
                .list_jobs(request(
                    metadata,
                    ListJobsRequest {
                        cache_params,
                        states: states.clone(),
                        user: user.clone(),
                        partition: partition.clone(),
                    },
                ))
                .await?;
            finish(response, print, |body| {
                println!(
                    "{:<14} {:<10} {:<10} {:<12} {:>5} {:<20} NAME",
                    "JOBID", "USER", "PARTITION", "STATE", "CPUS", "NODES/REASON"
                );
                for job in &body.jobs {
                    println!(
                        "{:<14} {:<10} {:<10} {:<12} {:>5} {:<20} {}",
                        job.id,
                        job.user,
                        job.partition,
                        job.states.join(","),
                        number(job.cpus),
                        where_or_why(job),
                        job.name
                    );
                }
                println!("{} jobs", body.jobs.len());
            })
        }
        Command::Job { id } => {
            let response = client
                .get_job(request(
                    metadata,
                    GetJobRequest {
                        cache_params,
                        job_id: id.clone(),
                    },
                ))
                .await?;
            finish(response, print, |body| {
                if let Some(job) = &body.job {
                    print_job(job);
                }
            })
        }
        Command::Nodes { partition } => {
            let response = client
                .list_nodes(request(
                    metadata,
                    ListNodesRequest {
                        cache_params,
                        partition: partition.clone(),
                    },
                ))
                .await?;
            finish(response, print, |body| {
                println!(
                    "{:<16} {:<18} {:>9} {:>14} {:<16} PARTITIONS",
                    "NODE", "STATE", "CPU A/T", "MEM A/T (MiB)", "GRES"
                );
                for node in &body.nodes {
                    println!(
                        "{:<16} {:<18} {:>9} {:>14} {:<16} {}",
                        node.name,
                        node.states.join(","),
                        format!("{}/{}", number(node.alloc_cpus), number(node.cpus)),
                        format!("{}/{}", number(node.alloc_memory), number(node.real_memory)),
                        node.gres.as_deref().unwrap_or("-"),
                        node.partitions.join(",")
                    );
                }
                println!("{} nodes", body.nodes.len());
            })
        }
        Command::Partitions => {
            let response = client
                .list_partitions(request(metadata, ListPartitionsRequest { cache_params }))
                .await?;
            finish(response, print, |body| {
                println!(
                    "{:<16} {:<8} {:>6} {:>6} {:>10} NODES",
                    "PARTITION", "STATE", "NODES", "CPUS", "MAXTIME"
                );
                for p in &body.partitions {
                    println!(
                        "{:<16} {:<8} {:>6} {:>6} {:>10} {}",
                        p.name,
                        p.states.join(","),
                        number(p.total_nodes),
                        number(p.total_cpus),
                        minutes(p.max_time),
                        p.nodes.as_deref().unwrap_or("-")
                    );
                }
            })
        }
        Command::History {
            partition,
            lookback,
            bucket,
        } => {
            let response = client
                .get_stats_history(request(
                    metadata,
                    GetStatsHistoryRequest {
                        cache_params,
                        partition: partition.clone(),
                        lookback_seconds: Some(*lookback),
                        bucket_seconds: *bucket,
                        ..Default::default()
                    },
                ))
                .await?;
            finish(response, print, |body| {
                println!(
                    "{} buckets of {}s over the last {}s ({})",
                    body.points.len(),
                    body.bucket_seconds,
                    body.end - body.start,
                    partition.as_deref().unwrap_or("whole cluster")
                );
                println!(
                    "{:>10} {:>4} {:>13} {:>17} {:>9} {:>5} {:>5}",
                    "TIME", "N", "CPU ALLOC", "MEM ALLOC (GiB)", "GPU", "RUN", "PEND"
                );
                for p in &body.points {
                    println!(
                        "{:>10} {:>4} {:>13} {:>17} {:>9} {:>5.0} {:>5.0}",
                        p.time,
                        p.samples,
                        format!("{:.0}/{:.0}", p.cpu_allocated, p.cpu_configured),
                        format!(
                            "{:.1}/{:.1}",
                            p.memory_allocated_mib / 1024.0,
                            p.memory_total_mib / 1024.0
                        ),
                        format!("{:.0}/{:.0}", p.gpu_allocated, p.gpu_total),
                        p.jobs_running,
                        p.jobs_pending
                    );
                }
            })
        }
    })
}

fn request<T>(metadata: MetadataMap, message: T) -> Request<T> {
    let mut request = Request::new(message);
    *request.metadata_mut() = metadata;
    request
}

fn finish<T>(response: Response<T>, print: bool, show: impl FnOnce(&T)) -> MetadataMap {
    let (metadata, body, _) = response.into_parts();
    if print {
        show(&body);
    }
    metadata
}

fn parse_headers(headers: &[String]) -> anyhow::Result<MetadataMap> {
    let mut map = MetadataMap::new();
    for header in headers {
        let (key, value) = header
            .split_once('=')
            .ok_or_else(|| anyhow::anyhow!("header {header:?} is not KEY=VALUE"))?;
        let key = MetadataKey::from_bytes(key.trim().to_lowercase().as_bytes())?;
        let value: MetadataValue<_> = value.trim().parse()?;
        map.append(key, value);
    }
    Ok(map)
}

fn report(run: u32, runs: u32, metadata: &MetadataMap, elapsed: Duration) {
    let get = |k| {
        metadata
            .get(k)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("?")
            .to_owned()
    };
    let prefix = if runs > 1 {
        format!("[{run}/{runs}] ")
    } else {
        String::new()
    };
    eprintln!(
        "{prefix}cache: {:<6} ttl {:>4}s  {:>8.1} ms",
        get("x-slurmview-cache"),
        get("x-slurmview-cache-ttl"),
        elapsed.as_secs_f64() * 1000.0
    );
}

fn print_job(job: &Job) {
    let rows = [
        ("Job", job.id.clone()),
        ("Name", job.name.clone()),
        ("User", job.user.clone()),
        ("Account", job.account.clone()),
        ("Partition", job.partition.clone()),
        ("QOS", job.qos.clone()),
        ("State", job.states.join(",")),
        ("Reason", job.state_reason.clone().unwrap_or_else(|| "-".into())),
        ("Nodes", job.nodes.clone().unwrap_or_else(|| "-".into())),
        ("CPUs", number(job.cpus)),
        ("Time limit", minutes(job.time_limit)),
        ("Submitted", number(job.submit_time)),
        ("Started", number(job.start_time)),
        ("Requested", job.tres_requested.clone().unwrap_or_else(|| "-".into())),
        ("Allocated", job.tres_allocated.clone().unwrap_or_else(|| "-".into())),
    ];
    for (label, value) in rows {
        println!("{label:<11} {value}");
    }
}

/// Node list for running jobs, Slurm's reason for anything else.
fn where_or_why(job: &Job) -> String {
    match (&job.nodes, &job.state_reason) {
        (Some(nodes), _) if job.states.first().is_some_and(|s| s == "RUNNING") => nodes.clone(),
        (_, Some(reason)) => format!("({reason})"),
        (Some(nodes), None) => nodes.clone(),
        (None, None) => "-".to_owned(),
    }
}

fn number(n: Option<SlurmNumber>) -> String {
    match n {
        Some(n) if n.infinite => "inf".to_owned(),
        Some(n) if n.set => n.number.to_string(),
        _ => "-".to_owned(),
    }
}

fn minutes(n: Option<SlurmNumber>) -> String {
    match n {
        Some(n) if n.infinite => "UNLIMITED".to_owned(),
        Some(n) if n.set => format!("{}:{:02}:00", n.number / 60, n.number % 60),
        _ => "-".to_owned(),
    }
}
