import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildDiscoveryPlan } from '../packages/contracts/discovery-plan.mjs';

// The browser helper is a plain script, so load it the way the page does.
const context = { window: {} };
vm.runInNewContext(await readFile(new URL('../apps/web/search-query.js', import.meta.url), 'utf8'), context);
const { build, phoneVariants } = context.window.ghostLinksSearchQuery;

const PHONE = '+16466016040';
const ORGANIZATION = 'Emanuel African Methodist Evangelical (AME) Church';
const phoneCase = (name = ORGANIZATION) => ({
  id: 'case-phone', organization: { name, locality: 'New York, NY' },
  identifier: { kind: 'phone', value: PHONE },
  internal: { state: 'removed', reasonCode: 'phone_disconnected', flaggedAt: '2026-10-20T00:00:00.000Z',
    correctedAt: '2026-10-20T00:00:00.000Z', source: 'retained_ledger', coverage: 'retained_records_only' },
  replacement: null, externalReferences: [], reviewState: 'approved_for_research', location: null,
});

test('a flagged phone is searched as printed, never as the stored E.164 value', () => {
  const query = build(phoneCase());
  // The regression this fixes: quoting +16466016040 matches nothing a directory publishes.
  assert.ok(!query.includes(PHONE), `stored E.164 leaked into the query: ${query}`);
  assert.ok(query.includes('"646-601-6040"'));
  assert.ok(query.includes('"(646) 601-6040"'));
  assert.ok(query.includes('"646 601 6040"'));
  assert.match(query, /^\(.+ OR .+ OR .+\)/);
  assert.ok(query.includes(`"${ORGANIZATION}"`));
  assert.ok(query.includes('-site:gogetta.nyc'));
});

test('the browser variants match the ones the discovery planner searches', () => {
  const feed = {
    schemaVersion: 2, mode: 'live', generatedAt: '2026-10-28T00:00:00.000Z',
    coverage: { scope: 'retained_records_only', sourceCounts: { website: 0, phone: 1, email: 0 }, returned: 1, omitted: 0 },
    cases: [phoneCase()],
  };
  const plan = buildDiscoveryPlan(feed, { now: Date.parse('2026-10-28T12:00:00.000Z'), maxJobs: 10 });
  const planned = plan.jobs.map(job => job.queries.join(' ')).join(' ');
  assert.ok(plan.jobs.length > 0, 'expected the planner to schedule the phone job');
  // Drift guard: the human fallback must search the same printed forms as the paid pipeline.
  for (const variant of phoneVariants(PHONE)) {
    assert.ok(planned.includes(`"${variant}"`), `planner does not search the variant ${variant}`);
  }
});

test('non-phone identifiers and unknown providers keep the exact, minimal query', () => {
  const website = build({ identifier: { kind: 'website', value: 'https://former.example.org/' }, organization: { name: ORGANIZATION } });
  assert.ok(website.startsWith('"https://former.example.org/"'));
  assert.equal(phoneVariants('+448081570000'), null, 'only North American numbers have a known printed layout');
  assert.equal(phoneVariants('not a phone'), null);
  const unknown = build({ ...phoneCase('Historical provider (identity unavailable)') });
  assert.ok(!unknown.includes('Historical provider'), 'an unavailable provider must not be searched as a literal name');
});
