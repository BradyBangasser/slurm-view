-- One row per scope per sample. partition = '' is the whole cluster.
CREATE TABLE stats_samples (
    sampled_at             timestamptz NOT NULL,
    partition              text        NOT NULL,

    cpu_configured         bigint      NOT NULL,
    cpu_allocated          bigint      NOT NULL,
    cpu_available          bigint      NOT NULL,
    cpu_unavailable        bigint      NOT NULL,

    memory_total_mib       bigint      NOT NULL,
    memory_allocated_mib   bigint      NOT NULL,
    memory_unallocated_mib bigint      NOT NULL,
    memory_unavailable_mib bigint      NOT NULL,

    gpu_total              bigint      NOT NULL,
    gpu_allocated          bigint      NOT NULL,
    gpu_available          bigint      NOT NULL,
    gpu_unavailable        bigint      NOT NULL,

    nodes_total            bigint      NOT NULL,
    nodes_down             bigint      NOT NULL,
    nodes_restricted       bigint      NOT NULL,

    jobs_running           bigint      NOT NULL,
    jobs_pending           bigint      NOT NULL,

    PRIMARY KEY (partition, sampled_at)
);

-- Retention deletes by time across all partitions.
CREATE INDEX stats_samples_sampled_at_idx ON stats_samples (sampled_at);
