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
  // Owners of the jobs currently on this node (empty when idle/down).
  users: string[];
  accounts: string[];
  reason: string | null;
}

// One occupant of a rack item: a physical node, or an empty bay within the
// item (e.g. a quad chassis with a sled not populated).
type RackBay = RackNode | null;

// A physical rack item: one piece of equipment occupying `heightU` rack
// units. `bays` has one entry for a single-node chassis (1U/2U/4U) or
// several for a multi-node chassis sharing that height (a 2U Quad has 4
// half-width-equivalent sleds in 2U), per Meeting 4's form-factor feedback.
interface RackItem {
  id: string;
  heightU: 1 | 2 | 4;
  bays: RackBay[];
}

interface Rack {
  id: string;
  items: RackItem[];
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

// Solid swatch color: used for the legend dots and the status badge in the
// detail panel, where a flat color reads better than a gradient.
// Green in use, amber restricted, red down, slate idle. Mixed is a lighter
// green so partially used nodes still read as "in use".
const NODE_STATUS_CLASSES: Record<NodeStatus, string> = {
  allocated: 'bg-emerald-500',
  mixed: 'bg-emerald-300',
  idle: 'bg-slate-300',
  draining: 'bg-amber-400',
  down: 'bg-rose-500',
};

// Flat fill for a node bay in the rack elevation. Deliberately flat (no
// gradient/sheen) so bays read as a clean status grid rather than glossy
// hardware, and each bay gets its own border (see NodeSlot) so adjacent
// same-status nodes still have a visible edge between them.
const NODE_STATUS_BAY_CLASSES: Record<NodeStatus, string> = {
  allocated: 'bg-emerald-500',
  mixed: 'bg-emerald-300',
  idle: 'bg-slate-300',
  draining: 'bg-amber-400',
  down: 'bg-rose-500',
};

type NodeStatusFilter = 'all' | NodeStatus;

// The logged-in viewer, for the "My nodes" filter. Until /api/v1/ui-settings
// (or similar) surfaces the OOD session user, this is a placeholder so the
// dummy data and the filter have something to agree on.
const CURRENT_USER = 'jdoe';

interface NodeFilters {
  status: NodeStatusFilter;
  // 'all' or one account name.
  account: 'all' | string;
  // Only show nodes running a job owned by CURRENT_USER.
  mineOnly: boolean;
}

const DEFAULT_FILTERS: NodeFilters = { status: 'all', account: 'all', mineOnly: false };

function nodeMatches(node: RackNode, search: string, filters: NodeFilters): boolean {
  if (filters.status !== 'all' && node.status !== filters.status) {
    return false;
  }
  if (filters.account !== 'all' && !node.accounts.includes(filters.account)) {
    return false;
  }
  if (filters.mineOnly && !node.users.includes(CURRENT_USER)) {
    return false;
  }
  const needle = search.trim().toLowerCase();
  return needle === '' || node.name.toLowerCase().includes(needle);
}

// Every node in a topology, racked or not. Panels/legend/filter options are
// all derived from this rather than walking rack.items themselves.
function allNodes(topology: Topology): RackNode[] {
  return [
    ...topology.racks.flatMap((rack) => rack.items.flatMap((item) => item.bays.filter((bay): bay is RackNode => bay !== null))),
    ...topology.unplaced,
  ];
}

// Accounts seen anywhere in the topology, for the account filter's options.
function accountsIn(topology: Topology): string[] {
  const accounts = new Set<string>();
  for (const node of allNodes(topology)) {
    for (const account of node.accounts) {
      accounts.add(account);
    }
  }
  return [...accounts].sort();
}

export {
  accountsIn,
  allNodes,
  CURRENT_USER,
  DEFAULT_FILTERS,
  NODE_STATUSES,
  NODE_STATUS_BAY_CLASSES,
  NODE_STATUS_CLASSES,
  NODE_STATUS_LABELS,
  nodeMatches,
};
export type { NodeFilters, NodeStatus, NodeStatusFilter, Rack, RackBay, RackItem, RackNode, Topology };
