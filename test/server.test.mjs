import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { get } from 'node:http';
import { createFixtureServer, createLiveSource } from '../apps/agent/fixture-server.mjs';
import { PUBLIC_CASES_URL } from '../packages/contracts/case-source.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/cases.demo.json', import.meta.url), 'utf8'));

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
    assert.equal((await fetch(`${base}/api/cases`, {headers: {Origin: 'https://unrelated.example'}})).status, 403);
    const reboundStatus = await new Promise((resolve, reject) => {
      get(`${base}/api/cases`, {headers: {Host: 'rebind.example'}}, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('live source coalesces concurrent reads, caches results, and explicitly refreshes', async () => {
  const feed = {...fixture, mode: 'live'};
  const calls = [];
  const source = createLiveSource({sourceUrl: 'http://127.0.0.1:4318/api/cases', token: 'fake-test-token-with-enough-length',
    fetchImpl: async (url, options) => {
      calls.push({url: String(url), options});
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(JSON.stringify(feed), {status: 200});
    }});
  const [a, b] = await Promise.all([source(), source()]);
  assert.equal(a, b); assert.equal(calls.length, 1);
  await source(); assert.equal(calls.length, 1);
  await source({refresh: true}); assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].url).searchParams.get('refresh'), '1');
  assert.equal(calls[0].options.redirect, 'error');
  assert.match(calls[0].options.headers.Authorization, /^Bearer /);
});

test('live source failures remain explicit and never fall back to fictional cases', async () => {
  const source = createLiveSource({sourceUrl: 'http://127.0.0.1:4318/api/cases', token: 'fake-test-token-with-enough-length',
    fetchImpl: async () => new Response('private source body', {status: 401})});
  await assert.rejects(source(), /case_source_unauthorized/);
  const server = await createFixtureServer({source: async () => { throw new Error('private raw record SECRET'); }});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cases`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {error: 'case_data_unavailable', mode: 'live'});
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('source requires a credential-free configured URL, token and bounded request timeout', () => {
  assert.throws(() => createLiveSource({sourceUrl: 'http://external.example/api/cases', token: 'fake-test-token-with-enough-length'}), /config/);
  assert.throws(() => createLiveSource({sourceUrl: 'https://user:pass@external.example/api/cases', token: 'fake-test-token-with-enough-length'}), /config/);
  assert.throws(() => createLiveSource({sourceUrl: 'http://127.0.0.1:4318/api/cases', token: ''}), /config/);
  for (const timeoutMs of [0, -1, 300001, NaN, '300000']) {
    assert.throws(() => createLiveSource({sourceUrl: 'http://127.0.0.1:4318/api/cases', token: 'fake-test-token-with-enough-length', timeoutMs}), /config/);
  }
  assert.doesNotThrow(() => createLiveSource({sourceUrl: 'http://127.0.0.1:4318/api/cases', token: 'fake-test-token-with-enough-length', timeoutMs: 300000}));
});

test('only the pinned public projection works without a token and never receives a leftover private token', async () => {
  const calls = [];
  const source = createLiveSource({ sourceUrl: PUBLIC_CASES_URL, token: 'old-private-bridge-token-do-not-forward',
    fetchImpl: async (url, options) => { calls.push({url:String(url), options}); return new Response(JSON.stringify({...fixture,mode:'live'})); } });
  await source();
  assert.equal(calls[0].url, PUBLIC_CASES_URL);
  assert.deepEqual(calls[0].options.headers, {});
  assert.doesNotThrow(()=>createLiveSource({sourceUrl:PUBLIC_CASES_URL}));
  assert.throws(()=>createLiveSource({sourceUrl:'https://unrelated.example/cases'}),/config/);
  assert.throws(()=>createLiveSource({sourceUrl:`${PUBLIC_CASES_URL}/other`}),/config/);
});

test('reporting endpoint uses an existing case, rejects arbitrary targets, and never reports fixtures', async () => {
  const liveFeed = structuredClone(fixture); liveFeed.mode = 'live';
  liveFeed.cases = [liveFeed.cases[0]];
  liveFeed.cases[0].identifier = {kind: 'phone', value: '+12125550123'};
  const server = await createFixtureServer({source: async () => liveFeed});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/reporting?caseId=${liveFeed.cases[0].id}`);
    assert.equal(response.status, 200);
    const plan = await response.json();
    assert.equal(plan.caseId, liveFeed.cases[0].id); assert.equal(plan.registration, null);
    assert.ok(plan.routes.some(route => route.url.includes('support.google.com/maps/')));
    assert.equal((await fetch(`${base}/api/reporting?caseId=missing`)).status, 404);
    assert.equal((await fetch(`${base}/api/reporting?caseId=${liveFeed.cases[0].id}&url=https://untrusted.example`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
