import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareWorker } from '../apps/cloudflare/worker.mjs';
import { buildLocationDetailUrl, latestValue, projectLocationDetail, LOCATION_DETAIL_BASE } from '../packages/contracts/location-detail.mjs';

const LOCATION_ID = 'e3788ddd-6c02-4c55-b447-8ce45192a83a';
// A v2 feed, since only v2 carries case.location. Built here rather than mutated from the
// v1 demo fixture so the shape under test stays explicit.
const caseItem = (id, location) => ({
  id, organization: { name: 'RiseBoro', locality: 'Brooklyn, NY' },
  identifier: { kind: 'phone', value: '+19178103156' },
  internal: { state: 'removed', reasonCode: 'manually_flagged_invalid', flaggedAt: '2026-10-28T14:29:04.824Z',
    correctedAt: '2026-10-28T14:29:23.422Z', source: 'retained_ledger', coverage: 'retained_records_only' },
  replacement: null, externalReferences: [], reviewState: 'review_required', location,
});
const live = () => ({
  schemaVersion: 2, mode: 'live', generatedAt: '2026-10-28T21:37:37.103Z',
  coverage: { scope: 'retained_records_only', sourceCounts: { website: 0, phone: 2, email: 0 }, returned: 2, omitted: 0 },
  cases: [
    caseItem('case-with-location', { id: LOCATION_ID, url: `https://gogetta.nyc/team/location/${LOCATION_ID}/questions/phone` }),
    caseItem('case-without-location', null),
  ],
});
const request = (path, options = {}) => new Request(`https://you.doobneek.org${path}`, options);
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

// Mirrors the upstream shape: values versioned by ISO key, organizations nested one level
// under the location id, and free text carrying markup.
const upstream = () => ({
  standardShape: {
    organizations: { [LOCATION_ID]: { 'org-1': 'RiseBoro' } },
    locations: { [LOCATION_ID]: {
      name: { '2020-01-01T00:00:00.000Z': 'Old Name', '2026-05-14T16:18:03.113Z': 'Wellness Rising' },
      neighborhood: 'Bushwick', slug: 'riseboro-bushwick', url: 'riseboro.org', email: null,
      closed: false, closureMessage: '',
      locationLastValidatedAt: '2026-10-28T14:29:09.742Z',
      locationRecordUpdatedAtLatest: '2026-06-26T02:24:18.822Z',
      address: { line1: { '2026-05-14T16:18:02.498Z': '518 Bushwick Ave' }, city: { '2020-06-24T20:12:21.536Z': 'Brooklyn' },
        state: { '2020-06-24T20:12:21.536Z': 'NY' }, postalCode: { '2020-06-24T20:12:21.536Z': '11206' } },
    } },
    services: { 's-1': { serviceName: { '2022-08-15T20:38:25.516Z': 'Food Pantry' },
      serviceDescription: { '2022-08-15T22:03:04.449Z': 'Fresh produce only.' },
      serviceAdditionalInfo: 'Call <a href="tel:3472953738">(347) 295-3738</a> &amp; ask.' } },
    phones: { 'p-1': { phoneNumber: '9178103156', type: 'Main Number', extension: null } },
  },
});

test('versioned upstream values resolve to the newest entry and plain values pass through', () => {
  assert.equal(latestValue({ '2020-01-01T00:00:00.000Z': 'old', '2026-05-14T16:18:03.113Z': 'new' }), 'new');
  assert.equal(latestValue('plain'), 'plain');
  assert.equal(latestValue({ '2020-06-24T20:12:21.536Z': null }), null);
  // A map that is not timestamp-keyed is data, not a version history, so it is left alone.
  assert.deepEqual(latestValue({ line1: 'x' }), { line1: 'x' });
});

test('only an id-shaped location builds an upstream URL, pinned to the public route', () => {
  assert.equal(buildLocationDetailUrl(LOCATION_ID), `${LOCATION_DETAIL_BASE}${LOCATION_ID}`);
  assert.ok(LOCATION_DETAIL_BASE.startsWith('https://'));
  for (const value of ['../../etc/passwd', 'https://evil.example.org', '', null, undefined, 'a b', 'x'.repeat(101)]) {
    assert.equal(buildLocationDetailUrl(value), null, `expected rejection for ${JSON.stringify(value)}`);
  }
});

test('projection flattens the upstream record and never carries markup through', () => {
  const detail = projectLocationDetail(upstream());
  assert.equal(detail.name, 'Wellness Rising');
  assert.equal(detail.organization, 'RiseBoro');
  assert.deepEqual(detail.address, { line1: '518 Bushwick Ave', city: 'Brooklyn', state: 'NY', postalCode: '11206' });
  assert.deepEqual(detail.phones, [{ number: '9178103156', type: 'Main Number', extension: null }]);
  assert.equal(detail.services[0].name, 'Food Pantry');
  // The anchor is removed, its visible text kept, and the entity decoded only after stripping.
  assert.equal(detail.services[0].additionalInfo, 'Call (347) 295-3738 & ask.');
  assert.doesNotMatch(JSON.stringify(detail), /[<>]/);
  assert.equal(projectLocationDetail({}), null);
  assert.equal(projectLocationDetail({ standardShape: { locations: {} } }), null);
});

test('an escaped tag stays inert text rather than being revived by entity decoding', () => {
  const payload = upstream();
  payload.standardShape.locations[LOCATION_ID].neighborhood = 'Bushwick &lt;img src=x onerror=alert(1)&gt; North';
  const detail = projectLocationDetail(payload);
  // The revived tag is removed and the surrounding text is kept.
  assert.equal(detail.neighborhood, 'Bushwick North');
  assert.doesNotMatch(JSON.stringify(detail), /[<>]/);
});

test('location route serves one listed case and refuses anything the feed does not list', async () => {
  const calls = [];
  const worker = createCloudflareWorker({ fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return String(url) === LOCATION_DETAIL_BASE + LOCATION_ID ? json(upstream()) : json(live());
  } });
  const response = await worker.fetch(request(`/api/location?caseId=${live().cases[0].id}`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.caseId, live().cases[0].id);
  assert.equal(payload.detail.name, 'Wellness Rising');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');

  // The upstream id comes from the feed, so a caller cannot steer the request.
  const upstreamCall = calls.find(call => call.url.startsWith(LOCATION_DETAIL_BASE));
  assert.equal(upstreamCall.url, LOCATION_DETAIL_BASE + LOCATION_ID);
  assert.ok(!('Authorization' in upstreamCall.options.headers));
  assert.equal(upstreamCall.options.redirect, 'manual');

  assert.equal((await worker.fetch(request('/api/location?caseId=missing'))).status, 404);
  assert.equal((await worker.fetch(request('/api/location'))).status, 400);
  assert.equal((await worker.fetch(request('/api/location?url=https://arbitrary.org'))).status, 400);
  assert.equal((await worker.fetch(request('/api/location', { method: 'POST' }))).status, 405);
  // The second fixture case carries no location, so it is reported rather than guessed at.
  const none = await worker.fetch(request(`/api/location?caseId=${live().cases[1].id}`));
  assert.equal(none.status, 404);
  assert.equal((await none.json()).error, 'location_unavailable');
});

test('upstream failures stay explicit and never leak the body or invent a record', async () => {
  const failures = [
    async () => new Response('PRIVATE', { status: 500 }),
    async () => new Response('', { status: 302, headers: { Location: 'https://elsewhere.example.org/' } }),
    async () => new Response('not json', { headers: { 'Content-Type': 'application/json' } }),
    async () => json({ standardShape: { locations: {} } }),
    async () => { throw new Error('PRIVATE'); },
  ];
  for (const upstreamImpl of failures) {
    const worker = createCloudflareWorker({ fetchImpl: async url =>
      (String(url).startsWith(LOCATION_DETAIL_BASE) ? upstreamImpl() : json(live())) });
    const response = await worker.fetch(request(`/api/location?caseId=${live().cases[0].id}`));
    assert.ok(response.status >= 500, `expected a failure status, got ${response.status}`);
    const body = await response.text();
    assert.doesNotMatch(body, /PRIVATE|Wellness/);
    assert.match(JSON.parse(body).error, /^location_source_/);
  }
});
