use std::net::SocketAddr;
use std::time::Duration;

use tonic::transport::Server;
use tonic_web::GrpcWebLayer;

use rpc::cache::RequestCache;
use rpc::history::{Sampler, StatsHistory};
use rpc::service::SlurmViewService;
use rpc::slurm::Slurm;
use rpc::slurmview::slurm_view_server::SlurmViewServer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_owned());
    let addr: SocketAddr = std::env::var("RPC_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:50051".to_owned())
        .parse()?;

    // SLURM_DATA_PARSER skips negotiation, e.g. when scontrol is a stub.
    let slurm = match std::env::var("SLURM_DATA_PARSER") {
        Ok(parser) => Slurm::with_parser(parser),
        Err(_) => Slurm::connect().await?,
    };

    // Redis is optional: without it every call goes to Slurm, reported as
    // `x-slurmview-cache: off`.
    let cache = match connect_redis(&redis_url).await {
        Ok(redis) => {
            println!("Caching responses in Redis at {redis_url}");
            RequestCache::new(redis)
        }
        Err(e) => {
            eprintln!("Redis at {redis_url} unavailable ({e}); running without a cache");
            RequestCache::disabled()
        }
    };

    // Stats history is optional: without DATABASE_URL the sampler does not
    // run and GetStatsHistory returns FAILED_PRECONDITION.
    let history = match std::env::var("DATABASE_URL") {
        Ok(url) => {
            let history = StatsHistory::connect(&url).await?;
            let interval = env_secs("STATS_SAMPLE_INTERVAL_SECS", 60)?;
            let retention = env_secs("STATS_RETENTION_SECS", 30 * 24 * 60 * 60)?;
            println!(
                "Recording stats every {}s, keeping {}s",
                interval.as_secs(),
                retention.as_secs()
            );
            tokio::spawn(
                Sampler {
                    slurm: slurm.clone(),
                    history: history.clone(),
                    interval,
                    retention,
                }
                .run(),
            );
            Some(history)
        }
        Err(_) => {
            println!("DATABASE_URL not set; stats history disabled");
            None
        }
    };

    let service = SlurmViewService::new(slurm.clone(), cache, history);

    println!(
        "SlurmView RPC listening on {addr} (data parser {})",
        slurm.parser()
    );

    // HTTP/1 + gRPC-Web so the browser client can call the service directly.
    Server::builder()
        .accept_http1(true)
        .layer(GrpcWebLayer::new())
        .add_service(SlurmViewServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}

async fn connect_redis(url: &str) -> anyhow::Result<redis::aio::ConnectionManager> {
    let client = redis::Client::open(url)?;
    let connect = redis::aio::ConnectionManager::new(client);
    Ok(tokio::time::timeout(Duration::from_secs(5), connect).await??)
}

/// A positive number of seconds from the environment, or `default`.
fn env_secs(name: &str, default: u64) -> anyhow::Result<Duration> {
    let secs = match std::env::var(name) {
        Ok(value) => value
            .parse()
            .map_err(|e| anyhow::anyhow!("{name}={value:?}: {e}"))?,
        Err(_) => default,
    };
    anyhow::ensure!(secs > 0, "{name} must be positive");
    Ok(Duration::from_secs(secs))
}
