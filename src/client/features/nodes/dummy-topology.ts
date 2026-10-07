import { CURRENT_USER } from './topology.ts';
import type { NodeStatus, Rack, RackItem, RackNode, Topology } from './topology.ts';

// Placeholder data for the node status view until /api/v1/topology exists.
// Deterministic (seeded) so renders and tests are stable.

const RACK_COUNT = 6;
// Items (not nodes) per rack. A 4U or 2U-Quad item still counts once here.
const ITEMS_PER_RACK = 10;

// Small LCG; good enough for plausible-looking fake data.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const JOB_NAMES = [
  'train_resnet',
  'md_sim',
  'job_1_task',
  'genome_align',
  'cfd_run',
  'bert_finetune',
  'monte_carlo',
  'vasp_relax',
];

const USERS = [CURRENT_USER, 'amurphy', 'skim', 'rgrandin', 'tlee'];
const ACCOUNTS = ['hpc-lab', 'bio-genomics', 'cs-ml', 'cfd-group'];

const DRAIN_REASONS = ['hardware check', 'kernel update', 'bad DIMM'];
const DOWN_REASONS = ['Not responding', 'GPU fell off the bus'];

function pickStatus(roll: number): NodeStatus {
  if (roll < 0.35) return 'allocated';
  if (roll < 0.6) return 'mixed';
  if (roll < 0.85) return 'idle';
  if (roll < 0.94) return 'draining';
  return 'down';
}

const SLURM_STATE: Record<NodeStatus, string> = {
  allocated: 'ALLOCATED',
  mixed: 'MIXED',
  idle: 'IDLE',
  draining: 'MIXED+DRAIN',
  down: 'DOWN+NOT_RESPONDING',
};

// Form factors seen on Nova per Meeting 4: 1U and 2U single-node chassis,
// 4U single-node (e.g. GPU trays), and 2U Quad (4 nodes sharing one 2U slot).
const FORM_FACTORS: { heightU: 1 | 2 | 4; nodeCount: number }[] = [
  { heightU: 1, nodeCount: 1 },
  { heightU: 2, nodeCount: 1 },
  { heightU: 4, nodeCount: 1 },
  { heightU: 2, nodeCount: 4 },
];

function pickFormFactor(roll: number): { heightU: 1 | 2 | 4; nodeCount: number } {
  if (roll < 0.5) return FORM_FACTORS[0]!; // 1U is the common case
  if (roll < 0.75) return FORM_FACTORS[1]!; // 2U
  if (roll < 0.85) return FORM_FACTORS[2]!; // 4U
  return FORM_FACTORS[3]!; // 2U Quad
}

function makeNode(name: string, partition: string, random: () => number): RackNode {
  const status = pickStatus(random());
  const jobCount =
    status === 'allocated' ? 1 + Math.floor(random() * 2)
    : status === 'mixed' || status === 'draining' ? 1 + Math.floor(random() * 3)
    : 0;
  const jobs = Array.from(
    { length: jobCount },
    () => JOB_NAMES[Math.floor(random() * JOB_NAMES.length)]!,
  );
  const owners = new Set<string>();
  const accounts = new Set<string>();
  for (let i = 0; i < jobCount; i += 1) {
    owners.add(USERS[Math.floor(random() * USERS.length)]!);
    accounts.add(ACCOUNTS[Math.floor(random() * ACCOUNTS.length)]!);
  }
  const reason =
    status === 'draining' ? DRAIN_REASONS[Math.floor(random() * DRAIN_REASONS.length)]!
    : status === 'down' ? DOWN_REASONS[Math.floor(random() * DOWN_REASONS.length)]!
    : null;
  return {
    name,
    status,
    slurmState: SLURM_STATE[status],
    partitions: [partition],
    jobs,
    users: [...owners],
    accounts: [...accounts],
    reason,
  };
}

function buildDummyTopology(seed = 4020): Topology {
  const random = seededRandom(seed);
  const racks: Rack[] = [];
  let nodeNumber = 1;

  for (let rackIndex = 0; rackIndex < RACK_COUNT; rackIndex += 1) {
    const isGpuRack = rackIndex >= RACK_COUNT - 2;
    const prefix = isGpuRack ? 'nova-gpu' : 'nova';
    const partition = isGpuRack ? 'gpu' : 'nova';

    const items: RackItem[] = [];
    for (let itemIndex = 0; itemIndex < ITEMS_PER_RACK; itemIndex += 1) {
      // Leave the occasional item physically empty (a single 1U gap).
      if (random() < 0.08) {
        items.push({ id: `${rackIndex}-${itemIndex}`, heightU: 1, bays: [null] });
        continue;
      }
      const { heightU, nodeCount } = pickFormFactor(random());
      const bays = Array.from({ length: nodeCount }, () => {
        const name = `${prefix}${String(nodeNumber).padStart(3, '0')}`;
        nodeNumber += 1;
        return makeNode(name, partition, random);
      });
      items.push({ id: `${rackIndex}-${itemIndex}`, heightU, bays });
    }

    racks.push({ id: `R${rackIndex + 1}`, items });
  }

  const unplaced = [
    makeNode('nova-login01', 'interactive', random),
    makeNode('nova-debug01', 'debug', random),
  ];

  return { racks, unplaced };
}

export { buildDummyTopology };
