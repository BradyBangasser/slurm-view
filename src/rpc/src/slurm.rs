//! Slurm CLI adapter.
//!
//! Runs the Slurm commands with `--json=<parser>` and maps the subset of
//! fields the front end needs onto the protobuf messages. Mirrors the
//! behaviour of the Node adapters in `src/server/adapters/slurm`.

use std::time::Duration;

use serde_json::Value;
use tokio::process::Command;

use crate::slurmview::{Job, Node, Partition, SlurmNumber};

/// Newest first. v0.0.43 is the compatibility floor for Slurm 25.05+.
pub const SUPPORTED_DATA_PARSERS: [&str; 3] = ["v0.0.45", "v0.0.44", "v0.0.43"];

/// Warnings Slurm attaches to ordinary output, e.g. squeue on an empty queue.
const BENIGN_WARNINGS: &[&str] = &["Zero jobs to dump"];

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);
const NODES_TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Debug)]
pub enum SlurmError {
    /// The command could not be run, timed out or exited non-zero.
    Command(String),
    /// The command ran but its output was unusable.
    Invalid(String),
    /// Slurm reported errors in the response envelope.
    Upstream(String),
    /// The requested object does not exist.
    NotFound(String),
}

impl std::fmt::Display for SlurmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Command(m) => write!(f, "slurm command failed: {m}"),
            Self::Invalid(m) => write!(f, "invalid slurm output: {m}"),
            Self::Upstream(m) => write!(f, "slurm error: {m}"),
            Self::NotFound(m) => write!(f, "not found: {m}"),
        }
    }
}

impl std::error::Error for SlurmError {}

/// Handle to the local Slurm CLI with a negotiated data parser.
#[derive(Clone, Debug)]
pub struct Slurm {
    parser: String,
}

impl Slurm {
    /// Pick the newest supported data parser via `scontrol --json=list`.
    pub async fn connect() -> Result<Self, SlurmError> {
        let stdout = run("scontrol", &["--json=list"], Duration::from_secs(10)).await?;
        let parser = select_data_parser(&stdout).ok_or_else(|| {
            SlurmError::Invalid(format!(
                "none of the supported data parsers are installed (supported: {})",
                SUPPORTED_DATA_PARSERS.join(", ")
            ))
        })?;
        Ok(Self::with_parser(parser))
    }

    pub fn with_parser(parser: impl Into<String>) -> Self {
        Self {
            parser: parser.into(),
        }
    }

    pub fn parser(&self) -> &str {
        &self.parser
    }

    fn json_flag(&self) -> String {
        format!("--json={}", self.parser)
    }

    pub async fn list_jobs(
        &self,
        states: &[String],
        user: Option<&str>,
        partition: Option<&str>,
    ) -> Result<Vec<Job>, SlurmError> {
        let states = if states.is_empty() {
            "R,PD,CD".to_owned()
        } else {
            states.join(",")
        };
        let flag = self.json_flag();
        let states = format!("--states={states}");
        let stdout = run("squeue", &[&flag, &states], DEFAULT_TIMEOUT).await?;
        let mut jobs = parse_jobs(&stdout)?;
        // Filtered here rather than with squeue's --user/--partition, whose
        // interaction with --json varies across Slurm releases.
        if let Some(user) = user {
            jobs.retain(|j| j.user == user);
        }
        if let Some(partition) = partition {
            jobs.retain(|j| crate::stats::job_in_partition(j, partition));
        }
        Ok(jobs)
    }

    pub async fn get_job(&self, job_id: &str) -> Result<Job, SlurmError> {
        if job_id.is_empty() || !job_id.chars().all(|c| c.is_ascii_digit() || c == '_') {
            return Err(SlurmError::NotFound(format!("job {job_id:?}")));
        }
        let flag = self.json_flag();
        let stdout = run("scontrol", &[&flag, "show", "job", job_id], DEFAULT_TIMEOUT).await?;
        select_job(parse_jobs(&stdout)?, job_id)
            .ok_or_else(|| SlurmError::NotFound(format!("job {job_id}")))
    }

    pub async fn list_nodes(&self, partition: Option<&str>) -> Result<Vec<Node>, SlurmError> {
        let flag = self.json_flag();
        let stdout = run("scontrol", &[&flag, "show", "node"], NODES_TIMEOUT).await?;
        let mut nodes = parse_nodes(&stdout)?;
        if let Some(partition) = partition {
            nodes.retain(|n| n.partitions.iter().any(|p| p == partition));
        }
        Ok(nodes)
    }

    pub async fn list_partitions(&self) -> Result<Vec<Partition>, SlurmError> {
        let flag = self.json_flag();
        let stdout = run("scontrol", &[&flag, "show", "partition"], DEFAULT_TIMEOUT).await?;
        parse_partitions(&stdout)
    }
}

/// Pick the requested job from `scontrol show job` output, which lists every
/// task of an array even when asked for one (`show job 12_3`).
fn select_job(jobs: Vec<Job>, requested: &str) -> Option<Job> {
    let exact = jobs.iter().position(|j| j.id == requested);
    let by_job_id = || jobs.iter().position(|j| j.job_id == requested);
    let index = exact.or_else(by_job_id)?;
    jobs.into_iter().nth(index)
}

/// Run a command without a shell, killing it if it outlives `timeout`.
async fn run(executable: &str, args: &[&str], timeout: Duration) -> Result<String, SlurmError> {
    let child = Command::new(executable)
        .args(args)
        .kill_on_drop(true)
        .output();

    let output = tokio::time::timeout(timeout, child)
        .await
        .map_err(|_| SlurmError::Command(format!("{executable} timed out")))?
        .map_err(|e| SlurmError::Command(format!("{executable}: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr: String = stderr.chars().take(500).collect();
        return Err(SlurmError::Command(format!(
            "{executable} exited with {}: {}",
            output.status,
            stderr.trim()
        )));
    }

    String::from_utf8(output.stdout)
        .map_err(|_| SlurmError::Invalid(format!("{executable} printed non-UTF-8 output")))
}

/// Newest supported parser present in `--json=list` output.
pub fn select_data_parser(list_output: &str) -> Option<&'static str> {
    SUPPORTED_DATA_PARSERS
        .into_iter()
        .find(|parser| list_output.contains(parser))
}

/// Parse a Slurm JSON envelope, failing on a non-empty `errors` array.
fn parse_envelope(stdout: &str) -> Result<Value, SlurmError> {
    let value: Value =
        serde_json::from_str(stdout).map_err(|e| SlurmError::Invalid(e.to_string()))?;

    if let Some(errors) = value.get("errors").and_then(Value::as_array)
        && !errors.is_empty()
    {
        let messages: Vec<String> = errors.iter().map(describe_notice).collect();
        return Err(SlurmError::Upstream(messages.join("; ")));
    }
    if let Some(warnings) = value.get("warnings").and_then(Value::as_array) {
        let messages: Vec<String> = warnings
            .iter()
            .map(describe_notice)
            .filter(|m| !BENIGN_WARNINGS.contains(&m.as_str()))
            .collect();
        if !messages.is_empty() {
            eprintln!("[Slurm] warnings: {}", messages.join("; "));
        }
    }

    Ok(value)
}

fn describe_notice(notice: &Value) -> String {
    ["description", "message", "error"]
        .into_iter()
        .find_map(|k| notice.get(k).and_then(Value::as_str))
        .unwrap_or("unknown Slurm error")
        .to_owned()
}

fn envelope_array<'a>(envelope: &'a Value, key: &str) -> Result<&'a Vec<Value>, SlurmError> {
    envelope
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| SlurmError::Invalid(format!("response has no {key:?} array")))
}

pub fn parse_jobs(stdout: &str) -> Result<Vec<Job>, SlurmError> {
    let envelope = parse_envelope(stdout)?;
    envelope_array(&envelope, "jobs")?
        .iter()
        .map(normalize_job)
        .collect()
}

pub fn parse_nodes(stdout: &str) -> Result<Vec<Node>, SlurmError> {
    let envelope = parse_envelope(stdout)?;
    envelope_array(&envelope, "nodes")?
        .iter()
        .map(normalize_node)
        .collect()
}

pub fn parse_partitions(stdout: &str) -> Result<Vec<Partition>, SlurmError> {
    let envelope = parse_envelope(stdout)?;
    envelope_array(&envelope, "partitions")?
        .iter()
        .map(normalize_partition)
        .collect()
}

fn normalize_job(raw: &Value) -> Result<Job, SlurmError> {
    let job_id = slurm_number(raw.get("job_id"));
    if !job_id.set {
        return Err(SlurmError::Invalid("job without job_id".to_owned()));
    }
    let job_id = job_id.number.to_string();

    let array_job_id = set_number(raw.get("array_job_id"))
        .filter(|&n| n != 0)
        .map(|n| n.to_string());
    let array_task_id = set_number(raw.get("array_task_id")).map(|n| n.to_string());
    let id = match (&array_job_id, &array_task_id) {
        (Some(array), Some(task)) => format!("{array}_{task}"),
        _ => job_id.clone(),
    };

    Ok(Job {
        id,
        job_id,
        array_job_id,
        array_task_id,
        name: string(raw.get("name")),
        user: string(raw.get("user_name")),
        account: string(raw.get("account")),
        partition: string(raw.get("partition")),
        qos: string(raw.get("qos")),
        states: strings(raw.get("job_state")),
        state_reason: optional_string(raw.get("state_reason")).filter(|r| r != "None"),
        nodes: optional_string(raw.get("nodes")),
        node_count: Some(slurm_number(raw.get("node_count"))),
        cpus: Some(slurm_number(raw.get("cpus"))),
        time_limit: Some(slurm_number(raw.get("time_limit"))),
        submit_time: Some(slurm_number(raw.get("submit_time"))),
        start_time: Some(slurm_number(raw.get("start_time"))),
        end_time: Some(slurm_number(raw.get("end_time"))),
        tres_requested: optional_string(raw.get("tres_req_str")),
        tres_allocated: optional_string(raw.get("tres_alloc_str")),
    })
}

fn normalize_node(raw: &Value) -> Result<Node, SlurmError> {
    let name = string(raw.get("name"));
    if name.is_empty() {
        return Err(SlurmError::Invalid("node without name".to_owned()));
    }

    Ok(Node {
        name,
        states: strings(raw.get("state")),
        partitions: strings(raw.get("partitions")),
        cpus: Some(slurm_number(raw.get("cpus"))),
        alloc_cpus: Some(slurm_number(raw.get("alloc_cpus"))),
        cpu_load: Some(slurm_number(raw.get("cpu_load"))),
        real_memory: Some(slurm_number(raw.get("real_memory"))),
        alloc_memory: Some(slurm_number(raw.get("alloc_memory"))),
        free_memory: Some(slurm_number(raw.get("free_mem"))),
        gres: optional_string(raw.get("gres")),
        gres_used: optional_string(raw.get("gres_used")),
        reason: optional_string(raw.get("reason")),
        effective_cpus: Some(slurm_number(raw.get("effective_cpus"))),
    })
}

fn normalize_partition(raw: &Value) -> Result<Partition, SlurmError> {
    let name = string(raw.get("name"));
    if name.is_empty() {
        return Err(SlurmError::Invalid("partition without name".to_owned()));
    }
    let nodes = raw.get("nodes");

    Ok(Partition {
        name,
        states: strings(raw.pointer("/partition/state")),
        nodes: optional_string(nodes.and_then(|n| n.get("configured"))),
        total_nodes: Some(slurm_number(nodes.and_then(|n| n.get("total")))),
        total_cpus: Some(slurm_number(raw.pointer("/cpus/total"))),
        max_time: Some(slurm_number(raw.pointer("/maximums/time"))),
    })
}

/// Normalize a Slurm scalar: `{number, set, infinite}`, a bare number or a
/// numeric string. Anything else is unset.
pub fn slurm_number(value: Option<&Value>) -> SlurmNumber {
    let unset = SlurmNumber::default();
    match value {
        Some(Value::Object(wrapper)) => {
            if wrapper.get("infinite").and_then(Value::as_bool) == Some(true) {
                return SlurmNumber {
                    infinite: true,
                    ..unset
                };
            }
            if wrapper.get("set").and_then(Value::as_bool) == Some(false) {
                return unset;
            }
            slurm_number(wrapper.get("number"))
        }
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f as i64))
            .map(|number| SlurmNumber {
                set: true,
                infinite: false,
                number,
            })
            .unwrap_or(unset),
        Some(Value::String(s)) => s
            .trim()
            .parse()
            .map(|number| SlurmNumber {
                set: true,
                infinite: false,
                number,
            })
            .unwrap_or(unset),
        _ => unset,
    }
}

fn set_number(value: Option<&Value>) -> Option<i64> {
    let n = slurm_number(value);
    n.set.then_some(n.number)
}

fn string(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "(null)")
        .map(str::to_owned)
}

fn strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        Some(Value::String(s)) if !s.is_empty() => vec![s.clone()],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/server/v1/fixtures");

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!("{FIXTURES}/{name}")).unwrap()
    }

    #[test]
    fn selects_newest_supported_parser() {
        let list = "data_parser/v0.0.42\ndata_parser/v0.0.43\ndata_parser/v0.0.44\n";
        assert_eq!(select_data_parser(list), Some("v0.0.44"));
        assert_eq!(select_data_parser("data_parser/v0.0.41"), None);
    }

    #[test]
    fn normalizes_slurm_numbers() {
        let parse = |s: &str| slurm_number(Some(&serde_json::from_str(s).unwrap()));
        assert_eq!(parse(r#"{"number":5,"set":true,"infinite":false}"#).number, 5);
        assert!(!parse(r#"{"number":0,"set":false,"infinite":false}"#).set);
        assert!(parse(r#"{"number":0,"set":false,"infinite":true}"#).infinite);
        assert_eq!(parse("7").number, 7);
        assert_eq!(parse(r#"" 9 ""#).number, 9);
        assert!(!parse("null").set);
    }

    #[test]
    fn parses_job_fixtures() {
        for version in ["v43", "v44", "v45"] {
            let jobs = parse_jobs(&fixture(&format!("{version}-jobs.json"))).unwrap();
            assert!(!jobs.is_empty(), "{version}");

            let first = &jobs[0];
            assert_eq!(first.job_id, "101", "{version}");
            assert_eq!(first.user, "alice", "{version}");
            assert_eq!(first.states, ["RUNNING"], "{version}");
            assert_eq!(first.time_limit.unwrap().number, 120, "{version}");
            assert!(!first.end_time.unwrap().set, "{version}");
            assert_eq!(first.state_reason, None, "{version}");
        }
    }

    #[test]
    fn parses_node_fixtures() {
        for version in ["v43", "v44", "v45"] {
            let nodes = parse_nodes(&fixture(&format!("{version}-nodes.json"))).unwrap();
            assert!(!nodes.is_empty(), "{version}");
            assert_eq!(nodes[0].name, "gpu01", "{version}");
            assert_eq!(nodes[0].cpus.unwrap().number, 64, "{version}");
        }
    }

    #[test]
    fn parses_partitions() {
        let stdout = r#"{
            "partitions": [{
                "name": "gpu",
                "partition": {"state": ["UP"]},
                "nodes": {"configured": "gpu[01-04]", "total": 4},
                "cpus": {"total": 256},
                "maximums": {"time": {"number": 0, "set": true, "infinite": true}}
            }],
            "errors": [],
            "warnings": []
        }"#;
        let partitions = parse_partitions(stdout).unwrap();
        assert_eq!(partitions[0].name, "gpu");
        assert_eq!(partitions[0].states, ["UP"]);
        assert_eq!(partitions[0].nodes.as_deref(), Some("gpu[01-04]"));
        assert_eq!(partitions[0].total_cpus.unwrap().number, 256);
        assert!(partitions[0].max_time.unwrap().infinite);
    }

    #[test]
    fn selects_requested_array_task() {
        // Shape of real `scontrol --json show job 1_4` output: the whole array,
        // with the master record (job_id 1) carrying the last task.
        let task = |job_id: i64, task_id: i64| Job {
            id: format!("1_{task_id}"),
            job_id: job_id.to_string(),
            ..Default::default()
        };
        let array = || vec![task(1, 5), task(9, 4), task(8, 3), task(7, 2)];

        assert_eq!(select_job(array(), "1_4").unwrap().job_id, "9");
        assert_eq!(select_job(array(), "8").unwrap().id, "1_3");
        assert_eq!(select_job(array(), "1").unwrap().id, "1_5");
        assert!(select_job(array(), "1_9").is_none());
    }

    #[test]
    fn surfaces_envelope_errors() {
        let stdout = r#"{"jobs": [], "errors": [{"description": "Invalid job id"}]}"#;
        match parse_jobs(stdout) {
            Err(SlurmError::Upstream(m)) => assert_eq!(m, "Invalid job id"),
            other => panic!("unexpected {other:?}"),
        }
    }
}
