import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { createFixtureServer } from '../apps/agent/fixture-server.mjs';
import { createResearchRunner, manualTestCase } from '../apps/agent/research-route.mjs';

// A stand-in for the Python process: records its stdin and replays scripted output.
function fakeSpawn(lines, { code = 0 } = {}) {
  const calls = [];
  const spawnImpl = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let input = '';
    child.stdin = { end: data => { input += data; calls.push({ command, args, input: JSON.parse(input) }); setImmediate(() => {
      for (const line of lines) child.stdout.emit('data', Buffer.from(`${line}\n`));
      child.emit('close', code);
    }); } };
    child.kill = () => child.emit('close', null);
    return child;
  };
  return { spawnImpl, calls };
}

const liveCase = (id, reviewState) => ({
  id, organization: { name: 'Example Pantry', locality: 'Brooklyn' }, identifier: { kind: 'phone', value: '+12125550123' },
  internal: { state: 'removed', reasonCode: 'phone_disconnected', flaggedAt: null, correctedAt: '2026-10-02T10:00:00Z', source: 'confirmed_correction', coverage: 'retained_records_only' },
  replacement: null, externalReferences: [], reviewState, location: null
});
const liveFeed = { schemaVersion: 2, mode: 'live', generatedAt: '2026-10-28T10:00:00Z', coverage: { scope: 'retained_records_only', sourceCounts: { website: 0, phone: 2, email: 0 }, returned: 2, omitted: 0 }, cases: [liveCase('approved-1', 'approved_for_research'), liveCase('pending-1', 'review_required')] };

async function withServer(options, run) {
  const server = await createFixtureServer(options);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}
const runner = (lines, options) => { const fake = fakeSpawn(lines, options); return { fake, research: { ...createResearchRunner({ spawnImpl: fake.spawnImpl }), available: () => true } }; };

test('fixture cases never start research', async () => {
  const { fake, research } = runner([]);
  await withServer({ research }, async base => {
    const response = await fetch(`${base}/api/research?caseId=demo-website-001`, { method: 'POST' });
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'fixture_research_disabled');
  });
  assert.equal(fake.calls.length, 0);
});

test('only approved live cases start research, and progress streams as NDJSON', async () => {
  const { fake, research } = runner([
    'some library warning',
    JSON.stringify({ type: 'event', step: 'search', status: 'done', message: '3 results' }),
    JSON.stringify({ type: 'result', caseId: 'approved-1', externalReferences: [] })
  ]);
  await withServer({ source: async () => structuredClone(liveFeed), research }, async base => {
    const pending = await fetch(`${base}/api/research?caseId=pending-1`, { method: 'POST' });
    assert.equal(pending.status, 409); assert.equal((await pending.json()).error, 'research_requires_approval');
    const response = await fetch(`${base}/api/research?caseId=approved-1`, { method: 'POST' });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /ndjson/);
    const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(line => line.type), ['event', 'result']);
  });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].input.case.id, 'approved-1'); assert.equal(fake.calls[0].input.manualTest, false);
});

test('manual tests are validated and labeled as tests', async () => {
  assert.equal(manualTestCase({ kind: 'fax', value: 'x', organization: 'y', locality: '' }), null);
  assert.equal(manualTestCase({ kind: 'phone', value: '', organization: 'y', locality: '' }), null);
  const { fake, research } = runner([JSON.stringify({ type: 'result', manualTest: true })]);
  await withServer({ research }, async base => {
    const bad = await fetch(`${base}/api/research/test`, { method: 'POST', body: '{"kind":"phone"}' });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/api/research/test`, { method: 'POST', body: JSON.stringify({ kind: 'phone', value: '+12125550123', organization: 'Example Pantry', locality: 'Brooklyn' }) });
    assert.equal(ok.status, 200); await ok.text();
  });
  assert.equal(fake.calls[0].input.manualTest, true); assert.equal(fake.calls[0].input.case.reviewState, 'manual_test');
});

test('a failed research process reports an error instead of a result', async () => {
  const { research } = runner([], { code: 1 });
  const original = console.error; console.error = () => {};
  try {
    await withServer({ research }, async base => {
      const response = await fetch(`${base}/api/research/test`, { method: 'POST', body: JSON.stringify({ kind: 'phone', value: '+12125550123', organization: 'Example', locality: '' }) });
      const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
      assert.equal(lines.at(-1).type, 'error');
    });
  } finally { console.error = original; }
});
