//! Request-level response cache backed by Redis.
//!
//! The key is a SHA-256 over the RPC method, the request metadata and the
//! encoded request body; the value is the encoded response body. Two calls
//! that send the same headers and the same message get the same bytes back
//! until the entry expires. Because the caller's metadata (including any
//! `authorization` header) is part of the key, responses are never shared
//! across callers that identify themselves differently.

use prost::Message;
use redis::AsyncCommands;
use sha2::{Digest, Sha256};
use tonic::metadata::{KeyAndValueRef, MetadataMap};

const KEY_PREFIX: &str = "slurmview:rpc";

/// Metadata that changes per call or per hop without changing the answer.
const IGNORED_METADATA: &[&str] = &[
    "content-length",
    "date",
    "grpc-accept-encoding",
    "grpc-timeout",
    "te",
    "traceparent",
    "tracestate",
    "x-request-id",
];

/// Outcome reported to the caller in `x-slurmview-cache`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheStatus {
    Hit,
    Miss,
    Bypass,
    /// The server is running without Redis.
    Off,
}

impl CacheStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hit => "hit",
            Self::Miss => "miss",
            Self::Bypass => "bypass",
            Self::Off => "off",
        }
    }
}

#[derive(Clone)]
pub struct RequestCache {
    redis: Option<redis::aio::ConnectionManager>,
}

impl RequestCache {
    pub fn new(redis: redis::aio::ConnectionManager) -> Self {
        Self { redis: Some(redis) }
    }

    /// A cache that stores nothing, for running without Redis.
    pub fn disabled() -> Self {
        Self { redis: None }
    }

    pub fn is_enabled(&self) -> bool {
        self.redis.is_some()
    }

    /// Return the cached response body for `key` and its remaining TTL.
    /// Redis errors and undecodable bodies are treated as a miss.
    pub async fn get<T: Message + Default>(&self, key: &str) -> Option<(T, u64)> {
        let mut conn = self.redis.clone()?;
        let (body, ttl): (Option<Vec<u8>>, i64) = redis::pipe()
            .get(key)
            .ttl(key)
            .query_async(&mut conn)
            .await
            .inspect_err(|e| eprintln!("[cache] read {key}: {e}"))
            .ok()?;

        let message = T::decode(body?.as_slice())
            .inspect_err(|e| eprintln!("[cache] decode {key}: {e}"))
            .ok()?;
        Some((message, ttl.max(0) as u64))
    }

    /// Store the encoded response body. Failures are logged, not returned:
    /// a cache outage must not fail the request.
    pub async fn put<T: Message>(&self, key: &str, message: &T, ttl_secs: u64) {
        let Some(mut conn) = self.redis.clone() else {
            return;
        };
        let result: redis::RedisResult<()> =
            conn.set_ex(key, message.encode_to_vec(), ttl_secs).await;
        if let Err(e) = result {
            eprintln!("[cache] write {key}: {e}");
        }
    }
}

/// Build the cache key for a request.
///
/// Metadata entries are lowercased, sorted and length-prefixed so the hash is
/// independent of header order and unambiguous across entry boundaries.
/// Repeated values for one header keep their relative order.
pub fn request_key(method: &str, metadata: &MetadataMap, body: &[u8]) -> String {
    let mut entries: Vec<(String, Vec<u8>)> = metadata
        .iter()
        .map(|entry| match entry {
            KeyAndValueRef::Ascii(k, v) => (k.as_str().to_owned(), v.as_bytes().to_vec()),
            KeyAndValueRef::Binary(k, v) => (k.as_str().to_owned(), v.as_ref().to_vec()),
        })
        .filter(|(k, _)| !IGNORED_METADATA.contains(&k.as_str()))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = Sha256::new();
    write_field(&mut hasher, method.as_bytes());
    hasher.update((entries.len() as u64).to_be_bytes());
    for (name, value) in &entries {
        write_field(&mut hasher, name.as_bytes());
        write_field(&mut hasher, value);
    }
    write_field(&mut hasher, body);

    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("{KEY_PREFIX}:{method}:{hex}")
}

fn write_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(entries: &[(&'static str, &'static str)]) -> MetadataMap {
        let mut map = MetadataMap::new();
        for (k, v) in entries {
            map.append(*k, v.parse().unwrap());
        }
        map
    }

    #[test]
    fn same_request_same_key() {
        let a = metadata(&[("authorization", "Bearer x"), ("x-cluster", "a")]);
        let b = metadata(&[("x-cluster", "a"), ("authorization", "Bearer x")]);
        assert_eq!(
            request_key("ListJobs", &a, b"body"),
            request_key("ListJobs", &b, b"body")
        );
    }

    #[test]
    fn key_varies_with_method_headers_and_body() {
        let base = metadata(&[("authorization", "Bearer x")]);
        let key = request_key("ListJobs", &base, b"body");

        assert_ne!(key, request_key("ListNodes", &base, b"body"));
        assert_ne!(key, request_key("ListJobs", &base, b"other"));
        assert_ne!(
            key,
            request_key("ListJobs", &metadata(&[("authorization", "Bearer y")]), b"body")
        );
    }

    #[test]
    fn ignores_per_call_metadata() {
        let a = metadata(&[("x-cluster", "a"), ("grpc-timeout", "5S")]);
        let b = metadata(&[("x-cluster", "a"), ("grpc-timeout", "9S"), ("te", "trailers")]);
        assert_eq!(request_key("M", &a, b""), request_key("M", &b, b""));
    }

    #[test]
    fn entry_boundaries_are_unambiguous() {
        let a = metadata(&[("x-a", "bc")]);
        let b = metadata(&[("x-ab", "c")]);
        assert_ne!(request_key("M", &a, b""), request_key("M", &b, b""));
    }

    #[test]
    fn key_is_namespaced_by_method() {
        let key = request_key("GetJob", &MetadataMap::new(), b"");
        assert!(key.starts_with("slurmview:rpc:GetJob:"));
        assert_eq!(key.len(), "slurmview:rpc:GetJob:".len() + 64);
    }
}
