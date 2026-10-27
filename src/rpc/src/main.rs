use std::net::SocketAddr;

use tonic::transport::Server;
use tonic_web::GrpcWebLayer;

use rpc::cache::RequestCache;
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

    let redis_client = redis::Client::open(redis_url)?;
    let redis = redis::aio::ConnectionManager::new(redis_client).await?;
    let service = SlurmViewService::new(slurm.clone(), RequestCache::new(redis));

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
