// Public v1 topology contract: the site's rack layout joined with live
// node state from the shared node snapshot.

export type TopologyNodeAvailability = 'available' | 'restricted' | 'down';

// The same lowMax/mediumMax shape the stats CPU chart grades against
// (`server/models/stats.ts`'s CpuLoadThresholds), echoed here so a client
// grading `cpuLoadRatio` into display buckets (e.g. the rack view's
// weather-radar load color mode) doesn't need its own copy of the config.
export interface TopologyLoadThresholds {
  lowMax: number;
  mediumMax: number;
}

export interface TopologyNodeDto {
  name: string;
  /** False when the layout names a node Slurm does not report; every field below is then null or empty. */
  inSlurm: boolean;
  state: string | null;
  stateFlags: string[];
  availability: TopologyNodeAvailability | null;
  reason: string | null;
  partitions: string[];
  cpus: number | null;
  allocCpus: number | null;
  /**
   * Raw CPU load per allocated CPU (e.g. 0.78 for 78%), not pre-bucketed —
   * callers grade it themselves against `TopologyResponse.loadThresholds`
   * (and, for a finer display scale like the rack view's weather-radar load
   * color mode, `TopologyResponse.loadGradientSteps`). Can exceed 1 under
   * genuine overload. Null when nothing is allocated, the node is down, or
   * Slurm reports no load.
   */
  cpuLoadRatio: number | null;
  totalMemoryMiB: number | null;
  allocMemoryMiB: number | null;
  gpus: number | null;
  allocGpus: number | null;
}

export interface TopologyBoxDto {
  /** Lowest rack unit the box occupies (U1 is the bottom). */
  u: number;
  height: number;
  /** The layout entry as written, e.g. "nova22-[1-4]". */
  label: string;
  nodes: TopologyNodeDto[];
}

export interface TopologyRackDto {
  id: string;
  /** Floor-grid cell parsed from ids like "BK31" (row BK, column 31); null otherwise. */
  grid: { row: string; column: number } | null;
  boxes: TopologyBoxDto[];
}

export interface TopologyPodDto {
  name: string;
  racks: TopologyRackDto[];
}

export interface TopologyResponse {
  /** False when the site has no `topology` config; pods is then empty and every node is unplaced. */
  configured: boolean;
  rackHeight: number;
  /** Thresholds to grade `TopologyNodeDto.cpuLoadRatio` against — the same ones the stats CPU chart uses. */
  loadThresholds: TopologyLoadThresholds;
  /** Suggested step count for a discretized load display (e.g. the rack view's gradient); see `cpuLoadRatio`. */
  loadGradientSteps: number;
  pods: TopologyPodDto[];
  /** Nodes Slurm reports that the layout does not place, sorted by name. */
  unplaced: TopologyNodeDto[];
  updatedAt: string;
}
