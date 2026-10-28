import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createFixtureServer } from '../apps/agent/fixture-server.mjs';

test('fixture API runs offline, identifies itself, and rejects writes', async () => {
  const server = await createFixtureServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cases = await fetch(`${base}/api/cases`);
    assert.equal(cases.status, 200); assert.equal(cases.headers.get('access-control-allow-origin'), null);
    assert.equal((await cases.json()).mode, 'fixture');
    const health = await (await fetch(`${base}/health`)).json(); assert.equal(health.liveResearchImplemented, false);
    assert.equal((await fetch(`${base}/api/cases`, {method: 'POST'})).status, 405);
    assert.equal((await fetch(`${base}/not-a-route`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
