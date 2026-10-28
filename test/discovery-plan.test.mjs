import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscoveryPlan } from '../packages/contracts/discovery-plan.mjs';

const NOW = '2026-10-28T20:00:00Z';
const item = (id = 'case-one', kind = 'website', value = 'https://provider.example.org/contact') => ({
  id, identifier: { kind, value }, organization: { name: 'Example Community Pantry', locality: 'Brooklyn' },
  internal: { state: 'flagged', reasonCode: 'website_repurposed', correctedAt: null, flaggedAt: '2026-10-28T19:00:00Z', source: 'saved_scan', coverage: 'retained_records_only' },
  replacement: null, externalReferences: [], reviewState: 'review_required', location: null,
});
const feed = (...cases) => ({ mode: 'live', generatedAt: NOW, cases });
const plan = (input, options = {}) => buildDiscoveryPlan(input, { now: NOW, ...options });

test('known public baseline cases get research jobs without claiming verified truth or requiring per-row approval', () => {
  const record = item();
  const original = structuredClone(record);
  const result = plan(feed(record));
  assert.equal(result.jobs.length, 1);
  assert.equal(result.researchOnly, true);
  assert.deepEqual(result.eligibleCaseIds, ['case-one']);
  assert.deepEqual(result.scheduledCaseIds, ['case-one']);
  assert.deepEqual(record, original);
  assert.equal(result.jobs[0].maxResults, 5);
  assert.equal(result.jobs[0].maxPages, 3);
  assert(result.jobs[0].queries.every(query => query.includes('"https://provider.example.org/contact"') && query.includes('-site:gogetta.nyc')));
  assert(!JSON.stringify(result).includes('stale_reference'));
  assert(!Object.hasOwn(result.jobs[0], 'reportState'));
});

test('fixture input schedules nothing and never becomes automatic external research', () => {
  const result = plan({ ...feed(item()), mode: 'fixture' });
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(result.eligibleCaseIds, []);
  assert.equal(result.skippedCases.fixture, 1);
});

test('shared identifiers across branches and organizations are broadly searched once then branch-verified', () => {
  const a = item('branch-a', 'phone', '+12125550123');
  const b = { ...item('branch-b', 'phone', '+12125550123'), organization: { name: 'Example Community Pantry', locality: 'Queens' } };
  const c = { ...item('branch-c', 'phone', '+12125550123'), organization: { name: 'Example Referral Network', locality: 'Brooklyn' } };
  const result = plan(feed(c, a, b));
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.jobs[0].caseIds, ['branch-a', 'branch-b', 'branch-c']);
  assert.equal(result.jobs[0].identities.length, 3);
  assert.deepEqual(result.jobs[0].queries, ['"+12125550123" -site:gogetta.nyc']);
  assert.deepEqual(result, plan(feed(b, c, a)), 'input row order must not change source binding or work ordering');
});

test('email case and website host casing deduplicate; path, query, scheme and phone extension remain meaningful', () => {
  const input = feed(item('mail-a', 'email', 'Info@Community.org'), item('mail-b', 'email', 'info@community.org'),
    item('web-a', 'website', 'https://PROVIDER.example.org/contact'), item('web-b', 'website', 'https://provider.example.org/contact'),
    item('web-c', 'website', 'https://provider.example.org/other?id=1'), item('web-d', 'website', 'http://provider.example.org/contact'),
    item('phone-a', 'phone', '+12125550123;ext=1'), item('phone-b', 'phone', '+12125550123;ext=2'));
  const result = plan(input);
  assert.equal(result.jobs.length, 6);
  assert.equal(result.jobs.find(job => job.kind === 'email').caseIds.length, 2);
  assert(result.jobs.some(job => job.queries[0].includes(';ext=2')));
});

test('malformed/private/credential-bearing values and unavailable identities do not reach provider queries', () => {
  const invalid = [
    item('bad-phone', 'phone', 'call tomorrow'), item('bad-email', 'email', 'person@localhost'),
    item('bad-web', 'website', 'https://127.0.0.1/'), item('bad-creds', 'website', 'https://u:p@provider.org/'),
    item('bad-token', 'website', 'https://provider.org/?access_token=DO_NOT_SEND'), item('bad-space', 'website', 'https://provider.org/ operator'),
    item('bad-key', 'website', 'https://provider.org/?key=DO_NOT_SEND'),
    item('bad-port', 'website', 'https://provider.org:8443/'), item('bad-ip-number', 'website', 'https://2130706433/'),
    item('reserved', 'website', 'https://community.example/'),
  ];
  const unknown = ['Historical provider (identity unavailable)', 'Unknown organization', 'Ambiguous identity', 'Provider', ''].map((name, index) => ({ ...item(`unknown-${index}`), organization: { name, locality: 'Brooklyn' } }));
  const result = plan(feed(...invalid, ...unknown));
  assert.equal(result.jobs.length, 0);
  assert.equal(result.skippedCases.invalidIdentifier, invalid.length);
  assert.equal(result.skippedCases.unknownIdentity, unknown.length);
  assert(!JSON.stringify(result).includes('DO_NOT_SEND'));
});

test('owned-domain query exclusions accept only explicit safe hosts and cannot inject operators', () => {
  const result = plan(feed(item()), { ownedDomains: ['GOGEtTA.nyc', 'confirmed.example.org', 'http://evil.org', 'evil.org -site:everywhere.org', 'evil.org:80', '127.0.0.1'] });
  assert.deepEqual(result.jobs[0].excludedDomains, ['confirmed.example.org', 'gogetta.nyc']);
  assert(result.jobs[0].queries.every(query => !query.includes('evil')));
});

test('completed discovery cache lasts 24h, source changes invalidate, feed refresh and review labels do not', () => {
  const record = item();
  const first = plan(feed(record));
  const prior = { binding: first.jobs[0].binding, status: 'completed', checkedAt: '2026-10-28T19:00:00Z' };
  const cached = plan(feed(record), { previousResults: [prior] });
  assert.equal(cached.jobs.length, 0);
  assert.equal(cached.skipped.freshCache, 1);
  assert.deepEqual(cached.eligibleCaseIds, ['case-one']);
  assert.deepEqual(cached.scheduledCaseIds, []);
  const refreshedFeed = { ...feed({ ...record, reviewState: 'approved_for_research' }), generatedAt: '2026-10-28T19:50:00Z' };
  assert.equal(plan(refreshedFeed, { previousResults: [prior] }).jobs.length, 0);
  const changed = { ...record, internal: { ...record.internal, reasonCode: 'website_not_found' } };
  assert.equal(plan(feed(changed), { previousResults: [prior] }).jobs.length, 1);
  assert.equal(plan(feed(record), { previousResults: [prior], now: '2026-10-29T19:00:00Z' }).jobs.length, 1);
  assert.equal(plan(feed(record), { previousResults: [{ ...prior, checkedAt: '2026-10-29T19:00:00Z' }] }).jobs.length, 1, 'future cache time is not trusted');
});

test('page fetch/observation timestamps cannot impersonate a completed discovery cache entry', () => {
  const record = item();
  const { binding } = plan(feed(record)).jobs[0];
  const result = plan(feed(record), { previousResults: [
    { binding, status: 'completed', observedAt: NOW, fetchedAt: NOW },
    { binding, status: 'fetched', checkedAt: NOW },
  ] });
  assert.equal(result.jobs.length, 1);
});

test('errors use bounded exponential backoff without becoming completed or unavailable-equals-absent', () => {
  const record = item();
  const { binding } = plan(feed(record)).jobs[0];
  const prior = { binding, status: 'error', attemptedAt: '2026-10-28T19:59:00Z', attempts: 2 };
  const deferred = plan(feed(record), { previousResults: [prior] });
  assert.equal(deferred.jobs.length, 0);
  assert.equal(deferred.skipped.retryBackoff, 1);
  assert.equal(deferred.skipped.freshCache, 0);
  assert.equal(plan(feed(record), { previousResults: [prior], now: '2026-10-28T20:09:00Z' }).jobs.length, 1);
  assert.equal(plan(feed(record), { previousResults: [{ ...prior, retryAt: '2028-01-01T00:00:00Z' }], now: '2026-10-29T03:00:00Z' }).jobs.length, 1, 'retryAt cannot defer more than six hours');
  const sourceChanged = { ...record, organization: { ...record.organization, name: 'Corrected Provider Identity' } };
  assert.equal(plan(feed(sourceChanged), { previousResults: [prior] }).jobs.length, 1);
});

test('deterministic bounded jobs report group skips separately from case-row skips', () => {
  const records = Array.from({ length: 130 }, (_, index) => item(`case-${index}`, 'website', `https://site${index}.org/`));
  const result = plan(feed(...records.reverse()), { maxJobs: 99999 });
  assert.equal(result.jobs.length, 100);
  assert.equal(result.skipped.capacity, 30);
  assert.equal(result.eligibleCaseIds.length, 130);
  assert.equal(result.scheduledCaseIds.length, 100);
  assert.deepEqual(result, plan(feed(...records.reverse()), { maxJobs: 99999 }));
  assert.equal(plan(feed(item()), { maxJobs: -1 }).jobs.length, 0);
  assert.equal(plan(feed(item()), { maxJobs: 0 }).skipped.capacity, 1);
  assert.throws(() => plan({ mode: 'unexpected', cases: [] }), /validated case feed/);
  assert.throws(() => plan(feed(item()), { now: 'invalid' }), /valid current time/);
});

test('only public allowlisted source fields influence or appear in jobs', () => {
  const record = { ...item(), privateHistory: 'PRIVATE_SENTINEL', apiKey: 'SECRET_SENTINEL' };
  const result = plan(feed(record));
  assert.equal(result.jobs[0].binding, plan(feed(item())).jobs[0].binding);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL|SECRET_SENTINEL/);
});
