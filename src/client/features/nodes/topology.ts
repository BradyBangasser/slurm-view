// Client-side model for the node status (rack) view. Shaped after the
// planned /api/v1/topology response: NodesCache snapshots joined with a
// site rack mapping. Until that route exists the view renders dummy data
// from dummy-topology.ts.

// Display status derived from the Slurm base state plus flags, following
// nodeAvailability() in src/server/models/node.ts: down and restricted
// (drain/error) win over allocation.
type NodeStatus = 'allocated' | 'mixed' | 'idle' | 'draining' | 'down';

interface RackNode {
  name: string;
  status: NodeStatus;
  // Raw Slurm state string for display, e.g. "MIXED" or "IDLE+DRAIN".
  slurmState: string;
  partitions: string[];
  jobs: string[];
  reason: string | null;
}

// A rack slot either holds a node or is physically empty.
interface RackSlot {
  slot: number;
  node: RackNode | null;
}

interface Rack {
  id: string;
  slots: RackSlot[];
}

interface Topology {
  racks: Rack[];
  // Nodes Slurm reports that have no rack mapping. They must still appear.
  unplaced: RackNode[];
}

const NODE_STATUSES: readonly NodeStatus[] = ['allocated', 'mixed', 'idle', 'draining', 'down'];

const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  allocated: 'Allocated',
  mixed: 'Mixed',
  idle: 'Idle',
  draining: 'Draining / drained',
  down: 'Down',
};

// Wireframe palette: green in use, yellow restricted, red down, grey idle.
// Mixed is a lighter green so partially used nodes read as "in use".
const NODE_STATUS_CLASSES: Record<NodeStatus, string> = {
  allocated: 'bg-green-600',
  mixed: 'bg-green-400',
  idle: 'bg-gray-300',
  draining: 'bg-yellow-400',
  down: 'bg-red-600',
};

type NodeStatusFilter = 'all' | NodeStatus;

function nodeMatches(node: RackNode, search: string, filter: NodeStatusFilter): boolean {
  if (filter !== 'all' && node.status !== filter) {
    return false;
  }
  const needle = search.trim().toLowerCase();
  return needle === '' || node.name.toLowerCase().includes(needle);
}

export { NODE_STATUSES, NODE_STATUS_CLASSES, NODE_STATUS_LABELS, nodeMatches };
export type { NodeStatus, NodeStatusFilter, Rack, RackNode, RackSlot, Topology };
