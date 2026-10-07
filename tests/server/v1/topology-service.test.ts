import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseNodesStdout } from '../../../src/server/adapters/slurm/nodes.js';
import type { ClusterNode } from '../../../src/server/models/node.js';
import type { NodeSnapshot } from '../../../src/server/cache/nodes-cache.js';
import type { TopologyConfig } from '../../../src/server/config/runtime-config.js';
import { DEFAULT_CPU_LOAD_THRESHOLDS } from '../../../src/server/services/stats-service.js';
import type { StatsSource } from '../../../src/server/services/stats-service.js';
import { TopologyService, parseRackGrid } from '../../../src/server/services/topology-service.js';

const FIXTURES = path.join(__dirname, 'fixtures');
const CAPTURED_AT = new Date('2026-10-07T12:00:00.000Z');

// Fixture nodes: gpu01 (MIXED, 16 of 64 CPUs, load 12.5), cpu01 (IDLE),
// gpu02 (IDLE+DRAIN), down01 (DOWN).
function loadNodes(): ClusterNode[] {
  const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-nodes.json'), 'utf8');
  return parseNodesStdout('v0.0.45', stdout);
}

function serviceFor(topology: TopologyConfig | undefined, nodes: ClusterNode[] = loadNodes()): TopologyService {
  const snapshot: NodeSnapshot = { nodes, capturedAt: CAPTURED_AT };
  const source: StatsSource = { getOrLoad: () => Promise.resolve(snapshot) };
  return new TopologyService(source, topology, DEFAULT_CPU_LOAD_THRESHOLDS);
}

const LAYOUT: TopologyConfig = {
  rackHeight: 42,
  pods: [
    {
      name: 'GPU',
      racks: [
        {
          id: 'AD46',
          nodes: [
            { name: 'gpu[01-02]', u: 3, height: 4 },
            { name: 'ghost01', u: 9, height: 1, verify: 'not racked yet' },
          ],
        },
      ],
    },
    {
      name: 'Compute',
      racks: [{ id: 'rack-a', nodes: [{ name: 'down01', u: 1, height: 2 }] }],
    },
  ],
};

describe('TopologyService.getTopology', () => {
  test('places nodes in their boxes and keeps the layout label', async () => {
    const result = await serviceFor(LAYOUT).getTopology();

    expect(result.configured).toBe(true);
    expect(result.rackHeight).toBe(42);
    expect(result.updatedAt).toEqual(CAPTURED_AT);
    expect(result.pods.map((pod) => pod.name)).toEqual(['GPU', 'Compute']);

    const box = result.pods[0]!.racks[0]!.boxes[0]!;
    expect(box).toMatchObject({ u: 3, height: 4, label: 'gpu[01-02]' });
    expect(box.nodes.map((node) => node.name)).toEqual(['gpu01', 'gpu02']);
  });

  test('joins live node state, allocation and GPU inventory', async () => {
    const result = await serviceFor(LAYOUT).getTopology();
    const [gpu01, gpu02] = result.pods[0]!.racks[0]!.boxes[0]!.nodes;

    expect(gpu01).toMatchObject({
      name: 'gpu01',
      inSlurm: true,
      state: 'MIXED',
      availability: 'available',
      partitions: ['gpu', 'debug'],
      cpus: 64,
      allocCpus: 16,
      gpus: 4,
      allocGpus: 2,
    });
    expect(gpu02).toMatchObject({ name: 'gpu02', availability: 'restricted', stateFlags: ['DRAIN'] });
  });

  test('buckets CPU load like the stats chart', async () => {
    const result = await serviceFor(LAYOUT).getTopology();
    const [gpu01, gpu02] = result.pods[0]!.racks[0]!.boxes[0]!.nodes;
    const down01 = result.pods[1]!.racks[0]!.boxes[0]!.nodes[0]!;

    // 12.5 load over 16 allocated CPUs is above mediumMax.
    expect(gpu01!.cpuLoadBucket).toBe('high');
    // Nothing allocated: no bucket.
    expect(gpu02!.cpuLoadBucket).toBeNull();
    // Down nodes never get a bucket.
    expect(down01.availability).toBe('down');
    expect(down01.cpuLoadBucket).toBeNull();
  });

  test('a layout name Slurm does not report is kept and marked missing', async () => {
    const result = await serviceFor(LAYOUT).getTopology();
    const ghost = result.pods[0]!.racks[0]!.boxes[1]!.nodes[0]!;

    expect(ghost).toEqual({
      name: 'ghost01',
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
    });
  });

  test('Slurm nodes the layout does not place are unplaced, sorted by name', async () => {
    const result = await serviceFor(LAYOUT).getTopology();

    expect(result.unplaced.map((node) => node.name)).toEqual(['cpu01']);
    expect(result.unplaced[0]).toMatchObject({ inSlurm: true, state: 'IDLE' });
  });

  test('every Slurm node appears exactly once, placed or unplaced', async () => {
    const result = await serviceFor(LAYOUT).getTopology();
    const placed = result.pods
      .flatMap((pod) => pod.racks)
      .flatMap((rack) => rack.boxes)
      .flatMap((box) => box.nodes)
      .filter((node) => node.inSlurm)
      .map((node) => node.name);
    const all = [...placed, ...result.unplaced.map((node) => node.name)].sort();

    expect(all).toEqual(loadNodes().map((node) => node.name).sort());
  });

  test('without a layout every node is unplaced', async () => {
    const result = await serviceFor(undefined).getTopology();

    expect(result.configured).toBe(false);
    expect(result.rackHeight).toBe(42);
    expect(result.pods).toEqual([]);
    expect(result.unplaced.map((node) => node.name)).toEqual(['cpu01', 'down01', 'gpu01', 'gpu02']);
  });

  test('rack grid comes from floor-grid ids only', async () => {
    const result = await serviceFor(LAYOUT).getTopology();

    expect(result.pods[0]!.racks[0]!.grid).toEqual({ row: 'AD', column: 46 });
    expect(result.pods[1]!.racks[0]!.grid).toBeNull();
  });
});

describe('parseRackGrid', () => {
  test.each([
    ['BK31', { row: 'BK', column: 31 }],
    ['af49', { row: 'AF', column: 49 }],
    ['A1', { row: 'A', column: 1 }],
    ['rack-a', null],
    ['31BK', null],
    ['BK', null],
  ])('%s', (id, expected) => {
    expect(parseRackGrid(id)).toEqual(expected);
  });
});
