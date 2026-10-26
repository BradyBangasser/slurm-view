import request from 'supertest';
import { createApp } from '../../../src/server/app.js';

// Only exercises validation paths that are rejected before any file write
// (createUiSettingsUpdateHandler validates the body, then calls
// writeUserConfigOverride(), which defaults to the real
// ~/.local/slurm-view/config.d). A real write is covered instead by
// tests/server/config/runtime-config-user-override.test.js, which passes
// an explicit scratch directory — that suite must not run through the HTTP
// layer, since the HTTP layer has no way to inject a non-default directory.
describe('PATCH /api/v1/ui-settings validation', () => {
  test('rejects a write to an admin-owned key (topology.pods) with Bad Request', async () => {
    const app = createApp();
    const res = await request(app)
      .patch('/api/v1/ui-settings')
      .send({ topology: { pods: [] } });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('rejects an out-of-range maxRacksPerRow', async () => {
    const app = createApp();
    const res = await request(app).patch('/api/v1/ui-settings').send({ topology: { maxRacksPerRow: 99 } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('rejects an empty body', async () => {
    const app = createApp();
    const res = await request(app).patch('/api/v1/ui-settings').send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('rejects a malformed JSON body as Bad Request, not Internal Error', async () => {
    const app = createApp();
    const res = await request(app)
      .patch('/api/v1/ui-settings')
      .set('content-type', 'application/json')
      .send('{not json');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('rejects a rackOrder id with disallowed characters', async () => {
    const app = createApp();
    const res = await request(app)
      .patch('/api/v1/ui-settings')
      .send({ topology: { rackOrder: ['not a valid id!'] } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
});
