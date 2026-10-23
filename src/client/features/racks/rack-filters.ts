import type { TopologyNodeDto, TopologyPodDto, TopologyResponse } from '../../../shared/api/v1/topology.ts';
import type { RackNodeStatus } from './rack-status.ts';
import { rackNodeStatus } from './rack-status.ts';

type StatusFilter = 'all' | RackNodeStatus;

interface RackFilters {
  status: StatusFilter;
  // 'all' or one partition name, from node.partitions.
  partition: 'all' | string;
}

const DEFAULT_RACK_FILTERS: RackFilters = { status: 'all', partition: 'all' };

function nodeMatches(node: TopologyNodeDto, search: string, filters: RackFilters): boolean {
  if (filters.status !== 'all' && rackNodeStatus(node) !== filters.status) {
    return false;
  }
  if (filters.partition !== 'all' && !node.partitions.includes(filters.partition)) {
    return false;
  }
  const needle = search.trim().toLowerCase();
  return needle === '' || node.name.toLowerCase().includes(needle);
}

// Every node in a topology response, racked or not. The partition filter's
// options and the "no results" check are both derived from this rather than
// walking pods/racks/boxes at each call site.
function allNodes(topology: TopologyResponse): TopologyNodeDto[] {
  return [
    ...topology.pods.flatMap((pod: TopologyPodDto) =>
      pod.racks.flatMap((rack) => rack.boxes.flatMap((box) => box.nodes)),
    ),
    ...topology.unplaced,
  ];
}

function partitionsIn(topology: TopologyResponse): string[] {
  const partitions = new Set<string>();
  for (const node of allNodes(topology)) {
    for (const partition of node.partitions) {
      partitions.add(partition);
    }
  }
  return [...partitions].sort();
}

export { allNodes, DEFAULT_RACK_FILTERS, nodeMatches, partitionsIn };
export type { RackFilters, StatusFilter };
