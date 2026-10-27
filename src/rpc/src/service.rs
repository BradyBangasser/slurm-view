//! SlurmView gRPC service.
//!
//! Each RPC goes through [`SlurmViewService::cached`], which looks the request
//! up in the [`RequestCache`] before doing any work and stores the encoded
//! response body afterwards.

use std::future::Future;

use prost::Message;
use tonic::metadata::MetadataValue;
use tonic::{Request, Response, Status};

use crate::cache::{CacheStatus, RequestCache, request_key};
use crate::history::{StatsHistory, unix_now};
use crate::slurm::{Slurm, SlurmError};
use crate::slurmview::slurm_view_server::SlurmView;
use crate::slurmview::{
    CacheParameters, GetJobRequest, GetJobResponse, GetStatsHistoryRequest,
    GetStatsHistoryResponse, ListJobsRequest, ListJobsResponse, ListNodesRequest,
    ListNodesResponse, ListPartitionsRequest, ListPartitionsResponse,
};

const JOBS_TTL_SECS: u64 = 10;
const JOB_TTL_SECS: u64 = 10;
const NODES_TTL_SECS: u64 = 30;
const PARTITIONS_TTL_SECS: u64 = 300;
const STATS_HISTORY_TTL_SECS: u64 = 30;

const DEFAULT_LOOKBACK_SECS: i64 = 24 * 60 * 60;
const MAX_WINDOW_SECS: i64 = 400 * 24 * 60 * 60;
const TARGET_POINTS: i64 = 200;
const MAX_POINTS: i64 = 10_000;

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

cacheable!(
    GetJobRequest,
    GetStatsHistoryRequest,
    ListJobsRequest,
    ListNodesRequest,
    ListPartitionsRequest,
);

/// Failures from any backend, mapped to a client-safe [`Status`] in one place.
#[derive(Debug)]
enum ServiceError {
    Slurm(SlurmError),
    Database(sqlx::Error),
    InvalidArgument(String),
    HistoryDisabled,
}

impl From<SlurmError> for ServiceError {
    fn from(e: SlurmError) -> Self {
        Self::Slurm(e)
    }
}

impl From<sqlx::Error> for ServiceError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database(e)
    }
}

#[derive(Clone)]
pub struct SlurmViewService {
    slurm: Slurm,
    cache: RequestCache,
    history: Option<StatsHistory>,
}

impl SlurmViewService {
    pub fn new(slurm: Slurm, cache: RequestCache, history: Option<StatsHistory>) -> Self {
        Self {
            slurm,
            cache,
            history,
        }
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
        Fut: Future<Output = Result<Resp, ServiceError>>,
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

        let status = if !self.cache.is_enabled() {
            CacheStatus::Off
        } else if bypass {
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

    async fn get_stats_history(
        &self,
        request: Request<GetStatsHistoryRequest>,
    ) -> Result<Response<GetStatsHistoryResponse>, Status> {
        self.cached(
            "GetStatsHistory",
            STATS_HISTORY_TTL_SECS,
            request,
            |req| async move {
                let history = self.history.as_ref().ok_or(ServiceError::HistoryDisabled)?;
                let (start, end, bucket) =
                    resolve_window(&req, unix_now()).map_err(ServiceError::InvalidArgument)?;
                let points = history
                    .query(req.partition.as_deref(), start, end, bucket)
                    .await?;
                Ok(GetStatsHistoryResponse {
                    start,
                    end,
                    bucket_seconds: bucket as u64,
                    points,
                })
            },
        )
        .await
    }
}

/// Resolve the request's window and bucket width against `now`.
fn resolve_window(req: &GetStatsHistoryRequest, now: i64) -> Result<(i64, i64, i64), String> {
    let end = req.end.unwrap_or(now);
    let start = match req.start {
        Some(start) => start,
        None => {
            let lookback = req
                .lookback_seconds
                .map_or(Ok(DEFAULT_LOOKBACK_SECS), i64::try_from)
                .map_err(|_| "lookbackSeconds is too large".to_owned())?;
            end.saturating_sub(lookback)
        }
    };
    if start >= end {
        return Err("window is empty: start must be before end".to_owned());
    }
    let span = end - start;
    if span > MAX_WINDOW_SECS {
        return Err(format!("window exceeds {MAX_WINDOW_SECS} seconds"));
    }

    let bucket = match req.bucket_seconds.filter(|&b| b > 0) {
        Some(b) => i64::try_from(b).map_err(|_| "bucketSeconds is too large".to_owned())?,
        // Whole minutes, at least one.
        None => ((span as u64).div_ceil(TARGET_POINTS as u64).div_ceil(60).max(1) * 60) as i64,
    };
    if span / bucket > MAX_POINTS {
        return Err(format!(
            "bucketSeconds {bucket} gives more than {MAX_POINTS} points"
        ));
    }

    Ok((start, end, bucket))
}

fn with_cache_metadata<T>(body: T, status: CacheStatus, ttl_secs: u64) -> Response<T> {
    let mut response = Response::new(body);
    let metadata = response.metadata_mut();
    metadata.insert("x-slurmview-cache", MetadataValue::from_static(status.as_str()));
    metadata.insert("x-slurmview-cache-ttl", MetadataValue::from(ttl_secs));
    response
}

/// Log the detail; return only a generic message so stderr, paths and SQL
/// never reach the client.
fn to_status(method: &str, error: ServiceError) -> Status {
    match error {
        ServiceError::Slurm(error) => {
            eprintln!("[rpc] {method}: {error}");
            match error {
                SlurmError::NotFound(what) => Status::not_found(what),
                SlurmError::Command(_) => Status::unavailable("Slurm is unavailable"),
                SlurmError::Invalid(_) | SlurmError::Upstream(_) => {
                    Status::internal("Slurm returned an unusable response")
                }
            }
        }
        ServiceError::Database(error) => {
            eprintln!("[rpc] {method}: database: {error}");
            Status::unavailable("stats history is unavailable")
        }
        ServiceError::InvalidArgument(message) => Status::invalid_argument(message),
        ServiceError::HistoryDisabled => {
            Status::failed_precondition("stats history is not enabled on this server")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn req(
        start: Option<i64>,
        end: Option<i64>,
        lookback: Option<u64>,
        bucket: Option<u64>,
    ) -> GetStatsHistoryRequest {
        GetStatsHistoryRequest {
            start,
            end,
            lookback_seconds: lookback,
            bucket_seconds: bucket,
            ..Default::default()
        }
    }

    #[test]
    fn defaults_to_last_day() {
        let (start, end, bucket) = resolve_window(&req(None, None, None, None), NOW).unwrap();
        assert_eq!((start, end), (NOW - 86_400, NOW));
        // 86400 / 200 = 432s, rounded up to whole minutes.
        assert_eq!(bucket, 480);
    }

    #[test]
    fn honours_explicit_window_and_bucket() {
        let w = resolve_window(&req(Some(100), Some(700), Some(5), Some(60)), NOW).unwrap();
        assert_eq!(w, (100, 700, 60));
    }

    #[test]
    fn small_windows_get_one_minute_buckets() {
        let (_, _, bucket) = resolve_window(&req(None, None, Some(600), None), NOW).unwrap();
        assert_eq!(bucket, 60);
    }

    #[test]
    fn rejects_bad_windows() {
        assert!(resolve_window(&req(Some(10), Some(10), None, None), NOW).is_err());
        assert!(resolve_window(&req(None, None, Some(0), None), NOW).is_err());
        assert!(resolve_window(&req(None, None, Some(u64::MAX), None), NOW).is_err());
        assert!(resolve_window(&req(None, None, None, Some(1)), NOW).is_err());
    }
}
