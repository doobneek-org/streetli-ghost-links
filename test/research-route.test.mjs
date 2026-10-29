import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { createFixtureServer } from '../apps/agent/fixture-server.mjs';
import { createResearchRunner, manualTestCase } from '../apps/agent/research-route.mjs';
import { createDiscoveryRunner } from '../apps/agent/discovery-runner.mjs';
import { applyPlan, cleanPlan, categoryOf } from '../apps/agent/ask.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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

test('generic automated review flags cannot become compromise allegations during request planning', () => {
  const scan = code => ({...liveCase('scan','review_required'),identifier:{kind:'website',value:'https://community.example.org/'},internal:{...liveCase('scan','review_required').internal,source:'saved_scan',reasonCode:code}});
  for (const code of ['scan_unverified_content_review','scan_program_closure_review','scan_organization_mismatch','scan_historical_reference']) {
    assert.equal(categoryOf(scan(code)),'scan');
    assert.equal(applyPlan([scan(code)],{serviceTerms:[],categories:['compromise'],kinds:[],locality:null}).length,0);
  }
  assert.equal(categoryOf(scan('scan_suspected_compromise')),'compromise');
});

async function withServer(options, run) {
  // Scripted discovery and a temporary demo cache: tests never touch real data/ files or paid providers.
  const cacheFile = pathToFileURL(join(await mkdtemp(join(tmpdir(), 'gl-route-')), 'route-cache.json'));
  const server = await createFixtureServer({ discovery: (await fakeDiscovery(uncertainOutcome)).discovery, one: { cacheFile }, ...options });
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

// A discovery runner whose "Python" is scripted, with data in a temporary folder.
async function fakeDiscovery(outcome) {
  const dataDir = `${await mkdtemp(join(tmpdir(), 'ghost-links-'))}/`;
  const calls = [];
  const run = async payload => { calls.push(payload); return typeof outcome === 'function' ? outcome(payload) : structuredClone(outcome); };
  return { calls, dataDir, discovery: createDiscoveryRunner({ dataDir, run, available: () => true }) };
}
const uncertainOutcome = payload => ({
  status: 'completed', checkedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  documents: [{ id: 'doc-1', url: 'https://directory.org/pantry', text: 'Example Pantry call +12125550123 today', status: 'fetched', observedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }],
  verifications: payload.discoveryJob.caseIds.map(caseId => ({ caseId, output: { caseId, verdict: 'uncertain',
    evidence: [{ documentId: 'doc-1', quote: 'Example Pantry call', role: 'identity' }], missingEvidence: ['A current official contact page'], summary: 'Not enough evidence.' } }))
});

test('live research runs the planner job for eligible cases only, and streams NDJSON', async () => {
  const feed = structuredClone(liveFeed);
  feed.cases[1].organization.name = 'Historical provider (identity unavailable)';
  feed.cases[1].identifier.value = '+12125550199';
  const { calls, discovery, dataDir } = await fakeDiscovery(uncertainOutcome);
  await withServer({ source: async () => structuredClone(feed), discovery }, async base => {
    const pending = await fetch(`${base}/api/research?caseId=pending-1`, { method: 'POST' });
    assert.equal(pending.status, 409); assert.equal((await pending.json()).error, 'research_requires_approval');
    const response = await fetch(`${base}/api/research?caseId=approved-1`, { method: 'POST' });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /ndjson/);
    const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.at(-1).type, 'result'); assert.equal(lines.at(-1).findings[0].gate, 'passed');
    const saved = await (await fetch(`${base}/api/discovery/findings`)).json();
    assert.equal(saved.findings['approved-1'].verdict, 'uncertain');
  });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].discoveryJob.caseIds, ['approved-1']);
  const receipts = JSON.parse(await readFile(`${dataDir}discovery-results.json`, 'utf8'));
  assert.equal(receipts[0].status, 'completed');
});

test('rejected discovery outputs use short error backoff rather than a successful 24-hour cache', async () => {
  let clock = new Date('2026-10-28T20:00:00Z'), rejected = true;
  const dataDir = `${await mkdtemp(join(tmpdir(), 'ghost-rejected-'))}/`, calls = [], events = [];
  const discovery = createDiscoveryRunner({ dataDir, available: () => true, now: () => clock, run: async payload => {
    calls.push(payload);
    const outcome = { ...uncertainOutcome(payload), checkedAt: clock.toISOString() };
    outcome.documents[0].observedAt = clock.toISOString();
    if (rejected) outcome.verifications[0].output.evidence[0].quote = 'a quote that is not on the page';
    return outcome;
  } });
  const feed = structuredClone(liveFeed);
  const first = await discovery.runDue(feed, { maxJobs: 3, onEvent: event => events.push(event) });
  assert.match(first.findings[0].gate, /^rejected:unbound_quote/); assert.equal(first.findings[0].evidence.length, 0);
  assert.match(first.findings[0].summary, /not found verbatim.*retry after the short backoff/);
  assert.doesNotMatch(JSON.stringify(first), /a quote that is not on the page/);
  assert.equal(events.find(event => event.type === 'job_done').status, 'error');
  let receipts = JSON.parse(await readFile(`${dataDir}discovery-results.json`, 'utf8'));
  assert.equal(receipts[0].status, 'error'); assert.equal(receipts[0].attempts, 1);
  const second = await discovery.runDue(feed, { maxJobs: 3 });
  assert.equal(second.plan.ran, 0); assert.equal(calls.length, 1);
  assert.equal(second.plan.skipped.retryBackoff, 1); assert.equal(second.plan.skipped.freshCache, 0);
  clock = new Date('2026-10-28T20:06:00Z'); rejected = false;
  const retry = await discovery.runDue(feed, { maxJobs: 3 });
  assert.equal(retry.plan.ran, 1); assert.equal(calls.length, 2);
  assert.ok(retry.findings.every(finding => finding.gate === 'passed'));
  receipts = JSON.parse(await readFile(`${dataDir}discovery-results.json`, 'utf8'));
  assert.equal(receipts[0].status, 'completed');
  assert.equal((await discovery.runDue(feed, { maxJobs: 3 })).plan.skipped.freshCache, 1);
});

test('a later rejection or model error preserves fresh bound evidence without advancing its check time', async () => {
  let clock = new Date('2026-10-28T20:00:00Z'), attempt = 0;
  const dataDir = `${await mkdtemp(join(tmpdir(), 'ghost-preserve-'))}/`;
  const discovery = createDiscoveryRunner({ dataDir, available: () => true, now: () => clock, run: async payload => {
    attempt++;
    if (attempt === 3) return { status: 'error', error: 'runtime_unavailable' };
    const outcome = { ...uncertainOutcome(payload), checkedAt: clock.toISOString() };
    outcome.documents[0].observedAt = clock.toISOString();
    const index = attempt === 1 ? 1 : 0;
    outcome.verifications[index].output.evidence[0].quote = 'fabricated text must never be stored';
    return outcome;
  } });
  const feed = structuredClone(liveFeed);
  const first = await discovery.runDue(feed, { maxJobs: 1 });
  const original = first.findings[0]; assert.equal(original.gate, 'passed');
  clock = new Date('2026-10-28T20:06:00Z');
  const second = await discovery.runDue(feed, { maxJobs: 1 });
  const kept = second.findings.find(finding => finding.caseId === original.caseId);
  assert.equal(kept.gate, 'passed'); assert.equal(kept.checkedAt, original.checkedAt);
  assert.deepEqual(kept.evidence, original.evidence);
  assert.deepEqual(kept.lastAttempt, { checkedAt: '2026-10-28T20:06:00Z', gate: 'rejected:unbound_quote', keptPrevious: true });
  assert.doesNotMatch(JSON.stringify(second), /fabricated text must never be stored/);
  clock = new Date('2026-10-28T20:17:00Z');
  const failed = await discovery.runDue(feed, { maxJobs: 1 });
  assert.ok(failed.findings.every(finding => finding.gate === 'passed' && finding.lastAttempt.gate === 'model_failed'));
  assert.equal(failed.findings[0].checkedAt, original.checkedAt);
  assert.equal((await discovery.findings(feed))[original.caseId].checkedAt, original.checkedAt);
  const receipts = JSON.parse(await readFile(`${dataDir}discovery-results.json`, 'utf8'));
  assert.equal(receipts[0].status, 'error'); assert.equal(receipts[0].attempts, 3);
});

test('a rejected run never carries prior evidence across a changed binding or past its original 24-hour expiry', async () => {
  for (const change of ['binding', 'age']) {
    let clock = new Date('2026-10-28T20:00:00Z'), fail = false;
    const dataDir = `${await mkdtemp(join(tmpdir(), 'ghost-expire-'))}/`;
    const discovery = createDiscoveryRunner({ dataDir, available: () => true, now: () => clock, run: async payload => {
      const outcome = { ...uncertainOutcome(payload), checkedAt: clock.toISOString() };
      outcome.documents[0].observedAt = clock.toISOString();
      if (fail) for (const verification of outcome.verifications) verification.output.evidence[0].quote = 'invented quote';
      return outcome;
    } });
    const feed = structuredClone(liveFeed);
    const first = await discovery.runDue(feed, { maxJobs: 1 }); assert.equal(first.findings[0].gate, 'passed');
    fail = true;
    if (change === 'binding') { feed.cases[0].organization.name = 'A different branch identity'; clock = new Date('2026-10-28T20:06:00Z'); }
    else clock = new Date('2026-10-29T21:00:00Z');
    const result = await discovery.runDue(feed, { maxJobs: 1 });
    assert.ok(result.findings.every(finding => finding.gate === 'rejected:unbound_quote' && finding.evidence.length === 0));
    assert.ok(result.findings.every(finding => !finding.lastAttempt && finding.checkedAt === clock.toISOString()));
  }
});

test('empty, missing, duplicate or failed per-case verifications cannot create completed receipts', async () => {
  for (const shape of ['empty', 'missing', 'duplicate', 'model_error']) {
    const dataDir = `${await mkdtemp(join(tmpdir(), 'ghost-empty-'))}/`;
    const discovery = createDiscoveryRunner({ dataDir, available: () => true, run: async payload => {
      const outcome = uncertainOutcome(payload);
      if (shape === 'empty') outcome.verifications = [];
      if (shape === 'missing') outcome.verifications.pop();
      if (shape === 'duplicate') outcome.verifications.push(outcome.verifications[0]);
      if (shape === 'model_error') outcome.verifications[0] = { caseId: payload.discoveryJob.caseIds[0], error: 'RateLimitError' };
      return outcome;
    } });
    const result = await discovery.runDue(structuredClone(liveFeed), { maxJobs: 1 });
    assert.ok(result.findings.some(finding => finding.gate === 'model_failed'));
    const receipts = JSON.parse(await readFile(`${dataDir}discovery-results.json`, 'utf8'));
    assert.equal(receipts[0].status, 'error', shape);
  }
});

test('legacy completed receipts with rejected or missing current findings use the original attempt backoff without rewriting data', async () => {
  let clock = new Date('2026-10-28T20:00:00Z'), calls = 0;
  const dataDir = `${await mkdtemp(join(tmpdir(), 'ghost-legacy-'))}/`;
  const discovery = createDiscoveryRunner({ dataDir, available: () => true, now: () => clock, run: async payload => {
    calls++;
    const outcome = { ...uncertainOutcome(payload), checkedAt: clock.toISOString() };
    outcome.documents[0].observedAt = clock.toISOString();
    outcome.verifications[0].output.evidence[0].quote = 'a rejected invented quote';
    return outcome;
  } });
  const feed = structuredClone(liveFeed);
  await discovery.runDue(feed, { maxJobs: 1 });
  const original = JSON.parse(await readFile(`${dataDir}discovery-results.json`, 'utf8'));
  const legacy = JSON.stringify(original.map(({ binding, checkedAt }) => ({ binding, checkedAt, status: 'completed' })));
  await writeFile(`${dataDir}discovery-results.json`, legacy);
  clock = new Date('2026-10-28T20:01:00Z');
  const deferred = await discovery.plan(feed, { maxJobs: 1 });
  assert.equal(deferred.jobs.length, 0); assert.equal(deferred.skipped.retryBackoff, 1); assert.equal(deferred.skipped.freshCache, 0);
  clock = new Date('2026-10-28T20:06:00Z');
  const due = await discovery.plan(feed, { maxJobs: 1 });
  assert.equal(due.jobs.length, 1); assert.equal(calls, 1, 'planning never starts a paid retry');
  assert.equal(await readFile(`${dataDir}discovery-results.json`, 'utf8'), legacy, 'planner reads preserve the old receipt');
  const saved = JSON.parse(await readFile(`${dataDir}discovery-findings.json`, 'utf8'));
  delete saved[feed.cases[0].id];
  await writeFile(`${dataDir}discovery-findings.json`, JSON.stringify(saved));
  assert.equal((await discovery.plan(feed, { maxJobs: 1 })).jobs.length, 1, 'a missing verification is not completed evidence');
});

test('a selected case after the global 100-job cap still runs with its full identifier group', async () => {
  const cases=Array.from({length:130},(_,index)=>({...liveCase(`case-${index}`,'review_required'),
    identifier:{kind:'website',value:`https://site-${String(index).padStart(3,'0')}.org/`}}));
  cases.push({...cases[129],id:'shared-branch',organization:{name:'Example Pantry',locality:'Queens'}});
  const feed={...structuredClone(liveFeed),cases};
  const {calls,discovery}=await fakeDiscovery(uncertainOutcome);
  assert.ok(!(await discovery.plan(feed,{maxJobs:100})).jobs.some(job=>job.caseIds.includes('case-129')));
  const result=await discovery.runDue(feed,{maxJobs:1,onlyCaseIds:['case-129']});
  assert.equal(result.plan.ran,1);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].discoveryJob.caseIds,['case-129','shared-branch']);
  const findings=await discovery.findings(feed);
  assert.equal(findings['case-129'].gate,'passed');
  assert.equal(findings['shared-branch'].binding,findings['case-129'].binding);
});

test('stored findings expire after 24 hours and invalidate when source association changes', async () => {
  const dataDir=`${await mkdtemp(join(tmpdir(),'ghost-cache-'))}/`;
  let clock=new Date('2026-10-28T20:00:00Z');
  const outcome=payload=>({...uncertainOutcome(payload),checkedAt:clock.toISOString(),documents:[{
    id:'doc-1',url:'https://directory.org/pantry',text:'Example Pantry call +12125550123 today',status:'fetched',observedAt:clock.toISOString()}]});
  const discovery=createDiscoveryRunner({dataDir,run:outcome,available:()=>true,now:()=>clock});
  const feed=structuredClone(liveFeed);
  await discovery.runDue(feed,{maxJobs:1});
  assert.equal(Object.keys(await discovery.findings(feed)).length,2);
  const changed=structuredClone(feed); changed.cases[0].organization.name='Another Provider';
  assert.deepEqual(await discovery.findings(changed),{});
  const merelyRefreshed={...feed,generatedAt:'2026-10-28T20:05:00Z'};
  assert.equal(Object.keys(await discovery.findings(merelyRefreshed)).length,2);
  clock=new Date('2026-10-29T20:00:00Z');
  assert.deepEqual(await discovery.findings(feed),{});
  assert.deepEqual(await discovery.findings({...feed,mode:'fixture'}),{});
});

test('request planning applies the model plan in code and bounds it', () => {
  const plan = cleanPlan({ serviceTerms: ['Pantry', 'x', 7], categories: ['compromise', 'made_up'], kinds: ['fax'], locality: 'Brooklyn', explanation: 'ok' });
  assert.deepEqual(plan.serviceTerms, ['pantry']); assert.deepEqual(plan.categories, ['compromise']); assert.deepEqual(plan.kinds, []);
  const scam = liveCase('scam', 'review_required'); scam.identifier = { kind: 'website', value: 'https://pantry.org/' }; scam.internal.reasonCode = 'website_scam_content';
  const phone = liveCase('phone', 'review_required');
  assert.deepEqual(applyPlan([phone, scam], plan).map(item => item.id), ['scam']);
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

test('one box: the router decides the flow, and fixture names never reach live service search', async () => {
  const calls = [];
  const python = async (payload, { onEvent = () => {} } = {}) => {
    calls.push(payload);
    if (payload.stage === 'route-request') return { output: { route: payload.input.request.includes('flood') ? 'event' : 'records', reason: 'test' } };
    if (payload.stage === 'plan-request') return { output: { serviceTerms: [], categories: ['compromise'], kinds: [], locality: null, explanation: 'risky websites' } };
    if (payload.stage === 'select-case') return { output: { intent: 'browse', kinds: [], states: [], locality: null, caseIds: [], question: null, explanation: 'browse only in fixture mode' } };
    onEvent({ type: 'event', step: 'parse', status: 'done', message: 'flood' });
    return { kind: 'event', stopped: null, services: [], news: [] };
  };
  await withServer({ python }, async base => {
    const flood = await (await fetch(`${base}/api/route`, { method: 'POST', body: JSON.stringify({ request: 'there was a flood uptown' }) })).text();
    const lines = flood.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.at(-1).kind, 'event'); assert.equal(lines.at(-1).route, 'event');
    const eventCall = calls.find(call => call.eventText);
    assert.deepEqual(eventCall.cases, []);
    const risky = (await (await fetch(`${base}/api/route`, { method: 'POST', body: JSON.stringify({ request: 'risky websites' }) })).text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(risky.at(-1).kind, 'ask'); assert.ok(Array.isArray(risky.at(-1).matchedIds));
    assert.equal((await fetch(`${base}/api/route`, { method: 'POST', body: JSON.stringify({ request: 'x' }) })).status, 400);
  });
});

test('found services are marked at risk only when they match a live Streetli flag', async () => {
  const { annotateRisk } = await import('../apps/agent/ask.mjs');
  const service = { name: 'Pantry', website: 'https://www.pantry.org/hours', phone: '(212) 555-0123',
    checks: [{ field: 'phone', state: 'listed', detail: 'x' }, { field: 'website', state: 'listed', detail: 'x' }] };
  const feed = structuredClone(liveFeed);
  const marked = annotateRisk([service], feed)[0];
  assert.equal(marked.checks[0].state, 'at_risk'); assert.match(marked.checks[0].detail, /phone disconnected/);
  assert.equal(marked.checks[1].state, 'listed');
  assert.equal(annotateRisk([service], { ...feed, mode: 'fixture' })[0].checks[0].state, 'listed');
});

test('leaderboard ranks reviewers by points from recorded decisions', async () => {
  const { leaderboard, parseDecision } = await import('../apps/agent/review-actions.mjs');
  const board = leaderboard({ a: { decision: 'resolved', by: 'Vlad' }, b: { decision: 'resolved', by: 'Vlad' }, c: { decision: 'not_an_issue', by: 'Mina' }, d: { decision: 'follow_up' } });
  assert.deepEqual(board.map(entry => [entry.name, entry.points]), [['Vlad', 20], ['Mina', 3], ['Anonymous', 1]]);
  assert.equal(parseDecision({ caseId: 'x', decision: 'resolved', by: '<script>' }), null);
  assert.equal(parseDecision({ caseId: 'x', decision: 'resolved', by: 'Van Helsing' }).by, 'Van Helsing');
});

test('service risk matching preserves shared-host paths, meaningful queries, country codes and phone extensions', async () => {
  const {annotateRisk}=await import('../apps/agent/ask.mjs');
  const website={...liveCase('website','review_required'),identifier:{kind:'website',value:'https://www.community.wordpress.com/old-pantry?branch=one'}};
  const phone={...liveCase('phone','review_required'),identifier:{kind:'phone',value:'+12125550123;ext=12'}};
  const feed={...liveFeed,cases:[website,phone]};
  const service=(site,number)=>({website:site,phone:number,checks:[{field:'website',state:'listed'},{field:'phone',state:'listed'}]});
  const different=annotateRisk([service('https://community.wordpress.com/new-pantry?branch=one','+442125550123;ext=12'),
    service('https://community.wordpress.com/old-pantry?branch=two','+12125550123;ext=99'),
    service('https://community.wordpress.com/old-pantry?branch=one','+12125550123')],feed);
  assert.equal(different[0].checks[0].state,'listed');
  assert.equal(different[0].checks[1].state,'listed');
  assert.equal(different[1].checks[0].state,'listed');
  assert.equal(different[1].checks[1].state,'listed');
  assert.equal(different[2].checks[1].state,'listed');
  const exact=annotateRisk([service('https://community.wordpress.com/old-pantry?branch=one','(212) 555-0123 ext. 12')],feed)[0];
  assert.equal(exact.checks[0].state,'at_risk');
  assert.equal(exact.checks[1].state,'at_risk');
});
