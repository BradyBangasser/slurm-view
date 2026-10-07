import { expandSlurmHostlist } from '../adapters/slurm/hostlist.js';
import { DEFAULT_RACK_HEIGHT } from '../config/runtime-config.js';
import type { TopologyConfig } from '../config/runtime-config.js';
import { nodeAvailability } from '../models/node.js';
import type { ClusterNode } from '../models/node.js';
import { classifyCpuLoadBucket } from '../models/stats.js';
import type { CpuLoadThresholds } from '../models/stats.js';
import type {
  TopologyCpuLoadBucket,
  TopologyNodeDto,
  TopologyPodDto,
  TopologyRackDto,
} from '../../shared/api/v1/topology.js';
import type { StatsSource } from './stats-service.js';

// Joins the configured rack layout with one node snapshot. Reads the
// shared node cache only; never issues its own Slurm call.
interface TopologyResult {
  configured: boolean;
  rackHeight: number;
  pods: TopologyPodDto[];
  unplaced: TopologyNodeDto[];
  updatedAt: Date;
}

const RACK_GRID_PATTERN = /^([A-Za-z]+)(\d+)$/;

function parseRackGrid(rackId: string): TopologyRackDto['grid'] {
  const match = RACK_GRID_PATTERN.exec(rackId);
  if (!match) {
    return null;
  }
  return { row: (match[1] ?? '').toUpperCase(), column: Number.parseInt(match[2] ?? '', 10) };
}

// Mirrors summarizeCpu so a rack cell and the CPU chart agree on "busy".
function nodeCpuLoadBucket(node: ClusterNode, thresholds: CpuLoadThresholds): TopologyCpuLoadBucket | null {
  if (nodeAvailability(node.state, node.stateFlags) === 'down') {
    return null;
  }
  if (node.allocCpus <= 0 || node.cpuLoad === null) {
    return null;
  }
  return classifyCpuLoadBucket(node.cpuLoad / node.allocCpus, thresholds);
}

function toTopologyNode(node: ClusterNode, thresholds: CpuLoadThresholds): TopologyNodeDto {
  return {
    name: node.name,
    inSlurm: true,
    state: node.state,
    stateFlags: [...node.stateFlags],
    availability: nodeAvailability(node.state, node.stateFlags),
    reason: node.reason,
    partitions: [...node.partitions],
    cpus: node.cpus,
    allocCpus: node.allocCpus,
    cpuLoadBucket: nodeCpuLoadBucket(node, thresholds),
    totalMemoryMiB: node.totalMemoryMiB,
    allocMemoryMiB: node.allocMemoryMiB,
    gpus: node.gpuInventoryKnown ? node.gpu.total : null,
    allocGpus: node.gpuInventoryKnown ? node.gpu.allocated : null,
  };
}

function missingTopologyNode(name: string): TopologyNodeDto {
  return {
    name,
    inSlurm: false,
    state: null,
    stateFlags: [],
    availability: null,
    reason: null,
    partitions: [],
    cpus: null,
    allocCpus: null,
    cpuLoadBucket: null,
    totalMemoryMiB: null,
    allocMemoryMiB: null,
    gpus: null,
    allocGpus: null,
  };
}

function buildTopology(
  topology: TopologyConfig | undefined,
  nodes: readonly ClusterNode[],
  thresholds: CpuLoadThresholds
): Omit<TopologyResult, 'updatedAt'> {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const placed = new Set<string>();

  const pods: TopologyPodDto[] = (topology?.pods ?? []).map((pod) => ({
    name: pod.name,
    racks: pod.racks.map((rack) => ({
      id: rack.id,
      grid: parseRackGrid(rack.id),
      boxes: rack.nodes.map((box) => ({
        u: box.u,
        height: box.height,
        label: box.name,
        nodes: expandSlurmHostlist(box.name).map((name) => {
          placed.add(name);
          const node = byName.get(name);
          return node ? toTopologyNode(node, thresholds) : missingTopologyNode(name);
        }),
      })),
    })),
  }));

  const unplaced = nodes
    .filter((node) => !placed.has(node.name))
    .map((node) => toTopologyNode(node, thresholds))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    configured: topology !== undefined,
    rackHeight: topology?.rackHeight ?? DEFAULT_RACK_HEIGHT,
    pods,
    unplaced,
  };
}

class TopologyService {
  constructor(
    private readonly source: StatsSource,
    private readonly topology: TopologyConfig | undefined,
    private readonly thresholds: CpuLoadThresholds
  ) {}

  async getTopology(): Promise<TopologyResult> {
    const snapshot = await this.source.getOrLoad();
    return {
      ...buildTopology(this.topology, snapshot.nodes, this.thresholds),
      updatedAt: snapshot.capturedAt,
    };
  }
}

export { TopologyService, buildTopology, parseRackGrid };
export type { TopologyResult };
