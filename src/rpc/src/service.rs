//! SlurmView gRPC service.
//!
//! Each RPC goes through [`SlurmViewService::cached`], which looks the request
//! up in the [`RequestCache`] before calling Slurm and stores the encoded
//! response body afterwards.

use std::future::Future;

use prost::Message;
use tonic::metadata::MetadataValue;
use tonic::{Request, Response, Status};

use crate::cache::{CacheStatus, RequestCache, request_key};
use crate::slurm::{Slurm, SlurmError};
use crate::slurmview::slurm_view_server::SlurmView;
use crate::slurmview::{
    CacheParameters, GetJobRequest, GetJobResponse, ListJobsRequest, ListJobsResponse,
    ListNodesRequest, ListNodesResponse, ListPartitionsRequest, ListPartitionsResponse,
};

const JOBS_TTL_SECS: u64 = 10;
const JOB_TTL_SECS: u64 = 10;
const NODES_TTL_SECS: u64 = 30;
const PARTITIONS_TTL_SECS: u64 = 300;

/// Requests that carry [`CacheParameters`], which are excluded from the key.
trait CacheableRequest: Message {
    fn take_cache_params(&mut self) -> Option<CacheParameters>;
}

macro_rules! cacheable {
    ($($request:ty),* $(,)?) => {
        $(impl CacheableRequest for $request {
            fn take_cache_params(&mut self) -> Option<CacheParameters> {
                self.cache_params.take()
            }
        })*
    };
}

cacheable!(GetJobRequest, ListJobsRequest, ListNodesRequest, ListPartitionsRequest);

#[derive(Clone)]
pub struct SlurmViewService {
    slurm: Slurm,
    cache: RequestCache,
}

impl SlurmViewService {
    pub fn new(slurm: Slurm, cache: RequestCache) -> Self {
        Self { slurm, cache }
    }

    /// Serve `request` from the cache, or run `fetch` and cache its result.
    ///
    /// `bypassCache` skips the read but still stores the fresh body, so the
    /// next ordinary call sees it. Errors are never cached.
    async fn cached<Req, Resp, F, Fut>(
        &self,
        method: &str,
        ttl_secs: u64,
        request: Request<Req>,
        fetch: F,
    ) -> Result<Response<Resp>, Status>
    where
        Req: CacheableRequest,
        Resp: Message + Default,
        F: FnOnce(Req) -> Fut,
        Fut: Future<Output = Result<Resp, SlurmError>>,
    {
        let (metadata, _, mut message) = request.into_parts();
        let bypass = message
            .take_cache_params()
            .is_some_and(|p| p.bypass_cache);
        let key = request_key(method, &metadata, &message.encode_to_vec());

        if !bypass && let Some((body, ttl)) = self.cache.get::<Resp>(&key).await {
            return Ok(with_cache_metadata(body, CacheStatus::Hit, ttl));
        }

        let body = fetch(message).await.map_err(|e| to_status(method, e))?;
        self.cache.put(&key, &body, ttl_secs).await;

        let status = if bypass {
            CacheStatus::Bypass
        } else {
            CacheStatus::Miss
        };
        Ok(with_cache_metadata(body, status, ttl_secs))
    }
}

#[tonic::async_trait]
impl SlurmView for SlurmViewService {
    async fn list_jobs(
        &self,
        request: Request<ListJobsRequest>,
    ) -> Result<Response<ListJobsResponse>, Status> {
        self.cached("ListJobs", JOBS_TTL_SECS, request, |req| async move {
            let jobs = self
                .slurm
                .list_jobs(&req.states, req.user.as_deref(), req.partition.as_deref())
                .await?;
            Ok(ListJobsResponse { jobs })
        })
        .await
    }

    async fn get_job(
        &self,
        request: Request<GetJobRequest>,
    ) -> Result<Response<GetJobResponse>, Status> {
        self.cached("GetJob", JOB_TTL_SECS, request, |req| async move {
            let job = self.slurm.get_job(&req.job_id).await?;
            Ok(GetJobResponse { job: Some(job) })
        })
        .await
    }

    async fn list_nodes(
        &self,
        request: Request<ListNodesRequest>,
    ) -> Result<Response<ListNodesResponse>, Status> {
        self.cached("ListNodes", NODES_TTL_SECS, request, |req| async move {
            let nodes = self.slurm.list_nodes(req.partition.as_deref()).await?;
            Ok(ListNodesResponse { nodes })
        })
        .await
    }

    async fn list_partitions(
        &self,
        request: Request<ListPartitionsRequest>,
    ) -> Result<Response<ListPartitionsResponse>, Status> {
        self.cached("ListPartitions", PARTITIONS_TTL_SECS, request, |_| async move {
            let partitions = self.slurm.list_partitions().await?;
            Ok(ListPartitionsResponse { partitions })
        })
        .await
    }
}

fn with_cache_metadata<T>(body: T, status: CacheStatus, ttl_secs: u64) -> Response<T> {
    let mut response = Response::new(body);
    let metadata = response.metadata_mut();
    metadata.insert("x-slurmview-cache", MetadataValue::from_static(status.as_str()));
    metadata.insert("x-slurmview-cache-ttl", MetadataValue::from(ttl_secs));
    response
}

/// Log the detail; return only a generic message so stderr and paths never
/// reach the client.
fn to_status(method: &str, error: SlurmError) -> Status {
    eprintln!("[rpc] {method}: {error}");
    match error {
        SlurmError::NotFound(what) => Status::not_found(what),
        SlurmError::Command(_) => Status::unavailable("Slurm is unavailable"),
        SlurmError::Invalid(_) | SlurmError::Upstream(_) => {
            Status::internal("Slurm returned an unusable response")
        }
    }
}
