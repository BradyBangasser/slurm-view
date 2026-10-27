//! Test client for the SlurmView RPC.
//!
//! Usage:
//!   cargo run --bin client -- jobs [--bypass]
//!   cargo run --bin client -- job <id> [--bypass]
//!   cargo run --bin client -- nodes [--bypass]
//!   cargo run --bin client -- partitions [--bypass]

use tonic::Request;
use tonic::metadata::MetadataMap;

use rpc::slurmview::slurm_view_client::SlurmViewClient;
use rpc::slurmview::{
    CacheParameters, GetJobRequest, ListJobsRequest, ListNodesRequest, ListPartitionsRequest,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let bypass = args.iter().any(|a| a == "--bypass");
    let positional: Vec<&str> = args
        .iter()
        .map(String::as_str)
        .filter(|a| *a != "--bypass")
        .collect();
    let cache_params = Some(CacheParameters {
        bypass_cache: bypass,
    });
    let addr = std::env::var("RPC_ADDR").unwrap_or_else(|_| "http://127.0.0.1:50051".to_owned());
    let mut client = SlurmViewClient::connect(addr).await?;

    match positional.as_slice() {
        ["jobs"] => {
            let response = client
                .list_jobs(Request::new(ListJobsRequest {
                    cache_params,
                    ..Default::default()
                }))
                .await?;
            print_cache(response.metadata());
            for job in response.into_inner().jobs {
                println!("{}\t{}\t{}\t{}", job.id, job.user, job.states.join(","), job.name);
            }
        }
        ["job", id] => {
            let response = client
                .get_job(Request::new(GetJobRequest {
                    cache_params,
                    job_id: (*id).to_owned(),
                }))
                .await?;
            print_cache(response.metadata());
            println!("{:#?}", response.into_inner().job);
        }
        ["nodes"] => {
            let response = client
                .list_nodes(Request::new(ListNodesRequest {
                    cache_params,
                    partition: None,
                }))
                .await?;
            print_cache(response.metadata());
            for node in response.into_inner().nodes {
                println!("{}\t{}", node.name, node.states.join(","));
            }
        }
        ["partitions"] => {
            let response = client
                .list_partitions(Request::new(ListPartitionsRequest { cache_params }))
                .await?;
            print_cache(response.metadata());
            for partition in response.into_inner().partitions {
                println!("{}\t{}", partition.name, partition.states.join(","));
            }
        }
        _ => anyhow::bail!("usage: client <jobs | job <id> | nodes | partitions> [--bypass]"),
    }

    Ok(())
}

fn print_cache(metadata: &MetadataMap) {
    let get = |k| {
        metadata
            .get(k)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("?")
            .to_owned()
    };
    eprintln!(
        "cache: {} (ttl {}s)",
        get("x-slurmview-cache"),
        get("x-slurmview-cache-ttl")
    );
}
