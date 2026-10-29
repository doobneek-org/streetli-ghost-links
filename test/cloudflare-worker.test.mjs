import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCloudflareWorker } from '../apps/cloudflare/worker.mjs';
import { PUBLIC_CASES_URL } from '../packages/contracts/case-source.mjs';
import { oneStatus } from '../apps/agent/one-actions.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/cases.demo.json', import.meta.url), 'utf8'));
const live = () => {
  const feed = structuredClone(fixture); feed.mode = 'live';
  feed.cases.forEach((item, index) => { item.identifier.value = `https://former${index}.example.org/`; item.organization.name = `Community Pantry ${index}`; });
  return feed;
};
const request = (path, options = {}) => new Request(`https://you.doobneek.org${path}`, options);
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const BACKEND_TOKEN = 'server-secret-token-with-at-least-32-characters';
const MAINTAINER_TOKEN = 'maintainer-token-with-at-least-32-characters';

test('static assets retain the frontend and receive edge security headers', async () => {
  const worker = createCloudflareWorker({ fetchImpl: async () => { throw new Error('No API call expected'); } });
  const response = await worker.fetch(request('/'), { ASSETS: { fetch: async input => new Response(`Asset ${new URL(input.url).pathname}`, { headers: { 'Content-Type': 'text/html' } }) } });
  assert.equal(await response.text(), 'Asset /');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
});

test('HTML receives a unique CSP nonce for Cloudflare injection without allowing arbitrary inline scripts', async () => {
  const worker = createCloudflareWorker();
  const environment = { ASSETS: { fetch: async input => new Response(new URL(input.url).pathname === '/' ? '<script src="/app.js"></script>' : 'external asset',
    { headers: { 'Content-Type': new URL(input.url).pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript', 'Cache-Control': 'public, max-age=600' } }) } };
  const first = await worker.fetch(request('/'), environment);
  const second = await worker.fetch(request('/'), environment);
  const policy = first.headers.get('Content-Security-Policy');
  const nonce = /'nonce-([A-Za-z0-9+/]{24})'/.exec(policy)?.[1];
  assert.ok(nonce);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  assert.match(policy, /script-src 'self'/);
  assert.notEqual(policy, second.headers.get('Content-Security-Policy'));
  assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(await first.text(), '<script src="/app.js"></script>');
  const script = await worker.fetch(request('/app.js'), environment);
  assert.doesNotMatch(script.headers.get('Content-Security-Policy'), /nonce-/);
  assert.equal(script.headers.get('Cache-Control'), 'public, max-age=600');
  assert.doesNotMatch((await worker.fetch(request('/health'))).headers.get('Content-Security-Policy'), /nonce-/);
});

test('live feed requests share one import, cache, refresh and never forward caller credentials', async () => {
  let calls = 0, clock = 100000;
  const worker = createCloudflareWorker({ now: () => clock, fetchImpl: async (url, options) => {
    calls++; assert.equal(String(url), PUBLIC_CASES_URL); assert.equal(options.redirect, 'manual');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    await new Promise(resolve => setTimeout(resolve, 5)); return json(live());
  } });
  const [first, second] = await Promise.all([worker.fetch(request('/api/cases', { headers: { Authorization: 'do-not-forward', Cookie: 'private' } })), worker.fetch(request('/api/cases'))]);
  assert.equal((await first.json()).mode, 'live'); assert.equal((await second.json()).cases.length, live().cases.length);
  assert.equal(first.headers.get('Cache-Control'), 'no-store'); assert.equal(calls, 1);
  await worker.fetch(request('/api/cases')); assert.equal(calls, 1);
  assert.equal((await worker.fetch(request('/api/refresh', { method: 'POST' }))).status, 200); assert.equal(calls, 2);
  assert.equal((await worker.fetch(request('/api/refresh', { method: 'POST' }))).status, 429);
  clock += 61000; await worker.fetch(request('/api/cases')); assert.equal(calls, 3);
});

test('source failures and invalid or oversized feeds remain explicit rather than fixtures', async () => {
  for (const fetchImpl of [async () => new Response('PRIVATE', { status: 500 }), async () => json(fixture),
    async () => new Response('{}', { headers: { 'content-length': String(17 * 1024 * 1024) } }), async () => { throw new Error('PRIVATE'); }]) {
    const response = await createCloudflareWorker({ fetchImpl }).fetch(request('/api/cases'));
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE|fictional/);
  }
});

test('reporting is restricted to actual cases and never accepts arbitrary URLs', async () => {
  let selected = null;
  const worker = createCloudflareWorker({ fetchImpl: async () => json(live()), reporting: async item => { selected = item.id; return { caseId: item.id, routes: [] }; } });
  assert.equal((await worker.fetch(request(`/api/reporting?caseId=${live().cases[0].id}`))).status, 200);
  assert.equal(selected, live().cases[0].id);
  assert.equal((await worker.fetch(request('/api/reporting?caseId=missing'))).status, 404);
  assert.equal((await worker.fetch(request('/api/reporting?url=https://arbitrary.org'))).status, 400);
  assert.equal((await worker.fetch(request(`/api/reporting?caseId=${selected}&caseId=${selected}`))).status, 400);
});

test('reporting reads a bounded precomputed Maps match for the selected case without forwarding credentials', async () => {
  const feed = live(); feed.schemaVersion = 2;
  for (const [index, item] of feed.cases.entries()) {
    item.internal.flaggedAt = item.internal.correctedAt;
    item.location = { id: `location-${index}`, url: `https://gogetta.nyc/team/location/location-${index}/questions/website` };
  }
  feed.coverage = { scope: 'retained_records_only', sourceCounts: { website: feed.cases.length, phone: 0, email: 0 }, returned: feed.cases.length, omitted: 0 };
  const selected = feed.cases[0];
  const match = { locationId: selected.location.id, ...selected.identifier, placeId: 'ChIJ_SYNTHETIC_1234',
    name: 'Example Community Pantry', address: '123 Example Street', listedValue: selected.identifier.value,
    observedAt: '2026-10-28T18:00:00Z', freshness: 'fresh', provenance: 'saved_google_places_match', privateHistory: 'DO_NOT_EXPOSE' };
  const calls = [];
  let clock = Date.parse('2026-10-28T20:00:00Z');
  const worker = createCloudflareWorker({ now: () => clock, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return String(url) === PUBLIC_CASES_URL ? json(feed) : json({ caseId: selected.id, googleMapsMatch: match });
  }, reporting: async (item, options) => ({ caseId: item.id, googleMaps: options.googleMapsMatch, routes: [] }) });
  const response = await worker.fetch(request(`/api/reporting?caseId=${selected.id}`, { headers: { Authorization: 'PRIVATE_CALLER', Cookie: 'PRIVATE_COOKIE' } }));
  assert.equal(response.status, 200);
  const text = await response.text(); const result = JSON.parse(text);
  assert.equal(new URL(result.googleMaps.url).searchParams.get('query_place_id'), match.placeId);
  assert.doesNotMatch(text, /DO_NOT_EXPOSE|PRIVATE_/);
  const lookup = calls[1];
  assert.equal(lookup.url, `${PUBLIC_CASES_URL}?mapsCaseId=${selected.id}`);
  assert.deepEqual(lookup.options.headers, { Accept: 'application/json' });
  assert.equal(lookup.options.redirect, 'manual'); assert.ok(lookup.options.signal);
  await worker.fetch(request(`/api/reporting?caseId=${selected.id}`)); assert.equal(calls.length, 2);
  clock += 61000; await worker.fetch(request(`/api/reporting?caseId=${selected.id}`)); assert.equal(calls.length, 4);
  const before = calls.length;
  assert.equal((await worker.fetch(request('/api/reporting?caseId=missing'))).status, 404);
  assert.equal((await worker.fetch(request(`/api/reporting?caseId=${selected.id}&mapsCaseId=arbitrary`))).status, 400);
  assert.equal(calls.length, before);
});

test('unavailable, oversized, redirected or mismatched saved Maps observations fall back to general guidance', async () => {
  const feed = live(); feed.schemaVersion = 2;
  for (const [index, item] of feed.cases.entries()) {
    item.internal.flaggedAt = item.internal.correctedAt;
    item.location = { id: `location-${index}`, url: `https://gogetta.nyc/team/location/location-${index}/questions/website` };
  }
  feed.coverage = { scope: 'retained_records_only', sourceCounts: { website: feed.cases.length, phone: 0, email: 0 }, returned: feed.cases.length, omitted: 0 };
  for (const failure of [() => { throw new Error('PRIVATE'); }, () => new Response('PRIVATE', { status: 500 }),
    () => new Response('PRIVATE', { status: 302, headers: { Location: 'https://evil.example/' } }),
    () => new Response('PRIVATE', { headers: { 'content-length': '17000' } }),
    () => json({ caseId: 'another-case', googleMapsMatch: { private: 'PRIVATE' } }),
    () => new Response('not json')]) {
    const worker = createCloudflareWorker({ fetchImpl: async url => String(url) === PUBLIC_CASES_URL ? json(feed) : failure(),
      reporting: async (item, options) => ({ caseId: item.id, googleMaps: options.googleMapsMatch, routes: ['generic guidance'] }) });
    const response = await worker.fetch(request(`/api/reporting?caseId=${feed.cases[0].id}`));
    assert.equal(response.status, 200); const text = await response.text();
    assert.doesNotMatch(text, /PRIVATE|evil\.example/); assert.equal(JSON.parse(text).googleMaps, null);
  }
});

test('missing Python backend is truthful and never fabricates research or successful saved decisions', async () => {
  const worker = createCloudflareWorker({ fetchImpl: async () => json(live()) });
  const health = await (await worker.fetch(request('/health'))).json();
  assert.equal(health.liveResearchImplemented, false); assert.equal(health.researchBackendConfigured, false);
  const findings = await (await worker.fetch(request('/api/discovery/findings'))).json();
  assert.deepEqual(findings.findings, {}); assert.equal(findings.eligibleCaseIds.length, live().cases.length);
  assert.equal(findings.researchBackendAvailable, false);
  const reviews = await (await worker.fetch(request('/api/review-actions'))).json();
  assert.deepEqual(reviews.actions, {}); assert.equal(reviews.researchBackendAvailable, false);
  for (const path of ['/api/discovery/run', `/api/research?caseId=${live().cases[0].id}`, '/api/research/test', '/api/ask', '/api/route', '/api/event-check', '/api/review-actions']) {
    const response = await worker.fetch(request(path, { method: 'POST', body: '{}' }));
    assert.equal(response.status, 503); assert.equal((await response.json()).error, 'research_backend_unavailable');
  }
});

test('backend proxy uses server credentials only and requires a separately checked maintainer token for paid mutations', async () => {
  const calls = [];
  const environment = { RESEARCH_BACKEND_URL: 'https://research.example.org/base/', RESEARCH_BACKEND_TOKEN: BACKEND_TOKEN, MAINTAINER_TOKEN };
  const worker = createCloudflareWorker({ fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return new Response('{"type":"result","findings":[]}\n', { headers: { 'Content-Type': 'application/x-ndjson', 'Set-Cookie': 'private' } }); } });
  assert.equal((await worker.fetch(request('/api/discovery/run', { method: 'POST', headers: { 'CF-Access-Jwt-Assertion': 'unverified-jwt' }, body: '{}' }), environment)).status, 401);
  assert.equal(calls.length, 0);
  const response = await worker.fetch(request('/api/discovery/run', { method: 'POST', headers: { Authorization: `Bearer ${MAINTAINER_TOKEN}`, Cookie: 'do-not-forward', Origin: 'https://you.doobneek.org', Accept: 'application/x-ndjson' }, body: '{"maxJobs":1}' }), environment);
  assert.equal(response.status, 200); assert.match(await response.text(), /"type":"result"/);
  assert.equal(calls[0].url, 'https://research.example.org/base/api/discovery/run');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${BACKEND_TOKEN}`);
  assert.ok(!Object.hasOwn(calls[0].options.headers, 'Cookie'));
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(response.headers.get('Set-Cookie'), null); assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('unsafe backend configuration, cross-site mutations and unknown proxy paths are rejected', async () => {
  let calls = 0;
  const worker = createCloudflareWorker({ fetchImpl: async () => { calls++; return json({}); } });
  for (const base of ['http://research.org', 'https://user:pass@research.org', 'https://research.org/?token=private', 'https://research.org/#private']) {
    const response = await worker.fetch(request('/health'), { RESEARCH_BACKEND_URL: base, RESEARCH_BACKEND_TOKEN: BACKEND_TOKEN });
    assert.equal(response.status, 503); assert.equal((await response.json()).error, 'research_backend_configuration_invalid');
  }
  assert.equal((await worker.fetch(request('/api/refresh', { method: 'POST', headers: { Origin: 'https://unrelated.org' } }))).status, 403);
  assert.equal((await worker.fetch(request('/api/route', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: '{}' }))).status, 403);
  assert.equal((await worker.fetch(request('/api/arbitrary'))).status, 404);
  assert.equal((await worker.fetch(request('/api/cases', { method: 'POST' }))).status, 405);
  assert.equal((await worker.fetch(request('/api/discovery/findings?url=https://arbitrary.org'))).status, 400);
  assert.equal(calls, 0);
});

test('One status is an open, read-only capability response using only backend credentials', async () => {
  const environment = { RESEARCH_BACKEND_URL: 'https://research.example.org/base/', RESEARCH_BACKEND_TOKEN: BACKEND_TOKEN, MAINTAINER_TOKEN };
  const actions = Object.fromEntries(['discordMessage', 'gmailSend', 'sheetsAppend', 'twilioSms'].map(name => [name,
    { actionId: 'private-action-id', connectionKey: 'private-connection-key', path: '/private-action-path' }]));
  const status = oneStatus(actions, { ONE_SECRET: 'private-provider-key', DISCORD_CHANNEL_ID: 'private-channel',
    GHOST_LINKS_SHEET_ID: 'private-sheet', TWILIO_ACCOUNT_SID: 'private-account', TWILIO_FROM: 'private-phone' });
  let calls = 0;
  const worker = createCloudflareWorker({ fetchImpl: async (url, options) => {
    calls++; assert.equal(String(url), 'https://research.example.org/base/api/one/status');
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { Authorization: `Bearer ${BACKEND_TOKEN}`, Accept: 'application/json' });
    return json(status);
  } });
  const response = await worker.fetch(request('/api/one/status', { headers: { Authorization: 'private-caller-token',
    Cookie: 'private-caller-cookie', Origin: 'https://you.doobneek.org' } }), environment);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.text(); assert.doesNotMatch(body, /private-/);
  assert.deepEqual(JSON.parse(body), { configured: true, discord: true, gmail: true, sheets: true, sms: true });
  assert.equal((await worker.fetch(request('/api/one/status', { method: 'POST', body: '{}' }), environment)).status, 405);
  assert.equal((await worker.fetch(request('/api/one/status?secret=private'), environment)).status, 400);
  assert.equal(calls, 1);
});

test('every One send route requires a maintainer and forwards only the backend token', async () => {
  const environment = { RESEARCH_BACKEND_URL: 'https://research.example.org', RESEARCH_BACKEND_TOKEN: BACKEND_TOKEN, MAINTAINER_TOKEN };
  const calls = [];
  const worker = createCloudflareWorker({ fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options }); return json({ ok: true });
  } });
  for (const path of ['/api/one/team-ticket', '/api/one/email-list', '/api/one/ghost-report', '/api/one/text-list', '/api/one/log-event']) {
    assert.equal((await worker.fetch(request(path, { method: 'POST', body: '{}' }), environment)).status, 401);
    assert.equal((await worker.fetch(request(path, { method: 'POST', headers: { Authorization: `Bearer ${BACKEND_TOKEN}` }, body: '{}' }), environment)).status, 401);
    assert.equal((await worker.fetch(request(path), environment)).status, 405);
    const response = await worker.fetch(request(path, { method: 'POST', headers: { Authorization: `Bearer ${MAINTAINER_TOKEN}`,
      Cookie: 'private', Origin: 'https://you.doobneek.org' }, body: '{"to":"reviewer@example.org"}' }), environment);
    assert.equal(response.status, 200);
    const sent = calls.at(-1); assert.equal(sent.url, `https://research.example.org${path}`);
    assert.equal(sent.options.headers.Authorization, `Bearer ${BACKEND_TOKEN}`);
    assert.equal(sent.options.headers['Content-Type'], 'application/json');
    assert.ok(!Object.hasOwn(sent.options.headers, 'Cookie')); assert.ok(!Object.hasOwn(sent.options.headers, 'Origin'));
    assert.equal(sent.options.body, '{"to":"reviewer@example.org"}');
  }
  assert.equal(calls.length, 5);
  assert.equal((await worker.fetch(request('/api/one/arbitrary', { method: 'POST', body: '{}' }), environment)).status, 404);
  assert.equal(calls.length, 5);
});

test('saved demo results use the guarded proxy and preserve their saved-result label', async () => {
  const environment = { RESEARCH_BACKEND_URL: 'https://research.example.org/base/', RESEARCH_BACKEND_TOKEN: BACKEND_TOKEN, MAINTAINER_TOKEN };
  let calls = 0;
  const worker = createCloudflareWorker({ fetchImpl: async (url, options) => {
    calls++; assert.equal(String(url), 'https://research.example.org/base/api/route/cached');
    assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, `Bearer ${BACKEND_TOKEN}`);
    assert.equal(options.body, '{"request":"food pantry in Harlem"}');
    return json({ kind: 'find', services: [], cached: true, savedAt: '2026-10-28T22:00:00Z' });
  } });
  assert.equal((await worker.fetch(request('/api/route/cached', { method: 'POST', body: '{}' }), environment)).status, 401);
  assert.equal((await worker.fetch(request('/api/route/cached'), environment)).status, 405);
  assert.equal((await worker.fetch(request('/api/route/cached?request=food', { method: 'POST',
    headers: { Authorization: `Bearer ${MAINTAINER_TOKEN}` }, body: '{}' }), environment)).status, 400);
  assert.equal(calls, 0);
  const response = await worker.fetch(request('/api/route/cached', { method: 'POST',
    headers: { Authorization: `Bearer ${MAINTAINER_TOKEN}` }, body: '{"request":"food pantry in Harlem"}' }), environment);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { kind: 'find', services: [], cached: true, savedAt: '2026-10-28T22:00:00Z' });
  assert.equal(calls, 1);
});

test('backend failures sanitize private diagnostics and oversized mutation bodies never reach it', async () => {
  const environment = { RESEARCH_BACKEND_URL: 'https://research.example.org', RESEARCH_BACKEND_TOKEN: BACKEND_TOKEN, MAINTAINER_TOKEN };
  let calls = 0;
  const worker = createCloudflareWorker({ fetchImpl: async () => { calls++; return new Response('PRIVATE', { status: 500 }); } });
  const failure = await worker.fetch(request('/api/discovery/findings'), environment);
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /PRIVATE/);
  const tooLarge = await worker.fetch(request('/api/discovery/run', { method: 'POST', headers: { Authorization: `Bearer ${MAINTAINER_TOKEN}` }, body: 'x'.repeat(5000) }), environment);
  assert.equal(tooLarge.status, 413); assert.equal(calls, 1);
});

// The Workers runtime only accepts 'follow' or 'manual'; 'error' throws a TypeError that the
// worker's catch would report as an unreachable source, so assert the mode and the 3xx refusal.
test('outbound fetches use a runtime-valid redirect mode and refuse redirected sources', async () => {
  const modes = [];
  const worker = createCloudflareWorker({ fetchImpl: async (url, options) => {
    modes.push(options.redirect);
    return new Response('', { status: 302, headers: { Location: 'https://elsewhere.example.org/' } });
  } });
  const response = await worker.fetch(request('/api/cases'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'case_source_unavailable');
  assert.ok(modes.length > 0);
  for (const mode of modes) assert.ok(['follow', 'manual'].includes(mode), `invalid redirect mode: ${mode}`);
});
