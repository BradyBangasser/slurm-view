import type { TopologyNodeDto } from '../../../shared/api/v1/topology.ts';

// Display status derived from the DTO's availability/state, mirroring
// nodeAvailability() in src/server/models/node.ts: down and restricted
// (drain/error) win over allocation. A node the layout names but Slurm
// doesn't report gets its own bucket (racks.md calls this the "gray" drift
// report, alongside `unplaced`).
type RackNodeStatus = 'down' | 'draining' | 'allocated' | 'mixed' | 'idle' | 'not-in-slurm';

const RACK_NODE_STATUSES: readonly RackNodeStatus[] = ['allocated', 'mixed', 'idle', 'draining', 'down', 'not-in-slurm'];

const RACK_NODE_STATUS_LABELS: Record<RackNodeStatus, string> = {
  allocated: 'Allocated',
  mixed: 'Mixed',
  idle: 'Idle',
  draining: 'Draining / restricted',
  down: 'Down',
  'not-in-slurm': 'Not in Slurm',
};

// Flat fill for a node bay in the rack elevation, and the matching legend
// dot. Green in use, amber restricted, red down, slate idle, and a dashed
// gray hatch-like slate for layout entries Slurm doesn't report.
const RACK_NODE_STATUS_CLASSES: Record<RackNodeStatus, string> = {
  allocated: 'bg-emerald-500',
  mixed: 'bg-emerald-300',
  idle: 'bg-slate-300',
  draining: 'bg-amber-400',
  down: 'bg-rose-500',
  'not-in-slurm': 'bg-slate-200',
};

function rackNodeStatus(node: TopologyNodeDto): RackNodeStatus {
  if (!node.inSlurm) return 'not-in-slurm';
  if (node.availability === 'down') return 'down';
  if (node.availability === 'restricted') return 'draining';
  if (node.state === 'ALLOCATED') return 'allocated';
  if (node.state === 'MIXED') return 'mixed';
  return 'idle';
}

export { RACK_NODE_STATUS_CLASSES, RACK_NODE_STATUS_LABELS, RACK_NODE_STATUSES, rackNodeStatus };
export type { RackNodeStatus };
