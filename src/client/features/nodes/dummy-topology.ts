import type { NodeStatus, Rack, RackNode, Topology } from './topology.ts';

// Placeholder data for the node status view until /api/v1/topology exists.
// Deterministic (seeded) so renders and tests are stable.

const RACK_COUNT = 6;
const SLOTS_PER_RACK = 14;

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
  const reason =
    status === 'draining' ? DRAIN_REASONS[Math.floor(random() * DRAIN_REASONS.length)]!
    : status === 'down' ? DOWN_REASONS[Math.floor(random() * DOWN_REASONS.length)]!
    : null;
  return { name, status, slurmState: SLURM_STATE[status], partitions: [partition], jobs, reason };
}

function buildDummyTopology(seed = 4020): Topology {
  const random = seededRandom(seed);
  const racks: Rack[] = [];
  let nodeNumber = 1;

  for (let rackIndex = 0; rackIndex < RACK_COUNT; rackIndex += 1) {
    const isGpuRack = rackIndex >= RACK_COUNT - 2;
    const prefix = isGpuRack ? 'nova-gpu' : 'nova';
    const partition = isGpuRack ? 'gpu' : 'nova';
    racks.push({
      id: `R${rackIndex + 1}`,
      slots: Array.from({ length: SLOTS_PER_RACK }, (_, slotIndex) => {
        // Leave the occasional slot physically empty.
        if (random() < 0.1) {
          return { slot: slotIndex + 1, node: null };
        }
        const name = `${prefix}${String(nodeNumber).padStart(3, '0')}`;
        nodeNumber += 1;
        return { slot: slotIndex + 1, node: makeNode(name, partition, random) };
      }),
    });
  }

  const unplaced = [
    makeNode('nova-login01', 'interactive', random),
    makeNode('nova-debug01', 'debug', random),
  ];

  return { racks, unplaced };
}

export { buildDummyTopology };
