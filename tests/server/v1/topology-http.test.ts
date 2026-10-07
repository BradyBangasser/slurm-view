import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { createApp } from '../../../src/server/app.js';
import { NodesCache } from '../../../src/server/cache/nodes-cache.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';
import * as runtimeConfig from '../../../src/server/config/runtime-config.js';
import type { RuntimeConfig } from '../../../src/server/config/runtime-config.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function fixtureRun(): SlurmRunFn {
  const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-nodes.json'), 'utf8');
  return jest.fn().mockResolvedValue({ stdout, stderr: '' });
}

function withTopology(topology: RuntimeConfig['topology']): void {
  const base = runtimeConfig.loadRuntimeConfig({ userConfigDir: null });
  jest.spyOn(runtimeConfig, 'getRuntimeConfig').mockReturnValue({ ...base, topology });
}

describe('GET /api/v1/topology', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    runtimeConfig.resetRuntimeConfigForTests();
  });

  test('returns the joined layout and unplaced nodes', async () => {
    withTopology({
      rackHeight: 42,
      pods: [{ name: 'GPU', racks: [{ id: 'AD46', nodes: [{ name: 'gpu[01-02]', u: 3, height: 4 }] }] }],
    });
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run: fixtureRun() }) });
    const res = await request(app).get('/api/v1/topology');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.configured).toBe(true);
    expect(res.body.rackHeight).toBe(42);
    expect(res.body.pods[0].racks[0]).toMatchObject({
      id: 'AD46',
      grid: { row: 'AD', column: 46 },
      boxes: [{ u: 3, height: 4, label: 'gpu[01-02]' }],
    });
    expect(res.body.pods[0].racks[0].boxes[0].nodes.map((node: { name: string }) => node.name)).toEqual([
      'gpu01',
      'gpu02',
    ]);
    expect(res.body.unplaced.map((node: { name: string }) => node.name)).toEqual(['cpu01', 'down01']);
    expect(typeof res.body.updatedAt).toBe('string');
  });

  test('without a layout reports configured=false and lists every node as unplaced', async () => {
    withTopology(undefined);
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run: fixtureRun() }) });
    const res = await request(app).get('/api/v1/topology');

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.pods).toEqual([]);
    expect(res.body.unplaced).toHaveLength(4);
  });

  test('reads the shared node snapshot; repeat requests issue no new Slurm call', async () => {
    withTopology(undefined);
    const run = fixtureRun();
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run }) });

    await request(app).get('/api/v1/topology');
    await request(app).get('/api/v1/topology');
    await request(app).get('/api/v1/stats');

    expect(run).toHaveBeenCalledTimes(1);
  });

  test('unknown query parameters become RFC 9457 Bad Request', async () => {
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run: fixtureRun() }) });
    const res = await request(app).get('/api/v1/topology').query({ rack: 'AD46' });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('missing node cache becomes Slurm Unavailable', async () => {
    const app = createApp({});
    const res = await request(app).get('/api/v1/topology');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
  });

  test('Slurm failure becomes 503 without leaking internals', async () => {
    withTopology(undefined);
    const run: SlurmRunFn = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'timeout',
        executable: 'scontrol',
        args: [],
        stderrSnippet: 'secret controller detail',
        message: 'Command timed out: scontrol',
      })
    );
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run }) });
    const res = await request(app).get('/api/v1/topology');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('secret controller detail');
  });
});
