import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGoogleMapsMatch } from '../packages/contracts/google-maps-match.mjs';
import { buildReportingPlan } from '../apps/agent/reporting-routes.mjs';

const now = Date.parse('2026-10-28T20:00:00Z');
const item = { id: 'case-1', location: { id: 'location-1' }, identifier: { kind: 'phone', value: '+12125550123' } };
const candidate = () => ({
  locationId: 'location-1', kind: 'phone', value: '+12125550123', placeId: 'ChIJ_SYNTHETIC_1234',
  name: 'Example Community Pantry', address: '123 Example Street, New York, NY', listedValue: '(212) 555-0123',
  observedAt: '2026-10-28T18:00:00Z', freshness: 'fresh', provenance: 'saved_google_places_match',
});

test('a bound saved match reconstructs a fixed Google Maps link and drops raw private fields', () => {
  const result = projectGoogleMapsMatch({ ...candidate(), url: 'https://evil.example/redirect', notes: 'PRIVATE_NOTE', raw: 'PRIVATE_EXPORT' }, item, { now });
  const url = new URL(result.url);
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/maps/search/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('query_place_id'), candidate().placeId);
  assert.equal(url.searchParams.get('query'), 'Example Community Pantry, 123 Example Street, New York, NY');
  assert.equal(result.freshness, 'fresh');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|evil\.example/);
});

test('unknown, mismatched, unsafe and future observations never become matched listings', () => {
  for (const value of [null, { ...candidate(), locationId: 'another-branch' }, { ...candidate(), kind: 'website' },
    { ...candidate(), value: '+12125550999' }, { ...candidate(), placeId: 'https://evil.example/' },
    { ...candidate(), name: '<img onerror=bad>' }, { ...candidate(), address: undefined },
    { ...candidate(), observedAt: '2026-10-29T00:00:00Z' }, { ...candidate(), observedAt: 'yesterday' },
    { ...candidate(), provenance: 'name_search' }, { ...candidate(), freshness: 'verified' }]) {
    assert.equal(projectGoogleMapsMatch(value, item, { now }), null);
  }
  assert.equal(projectGoogleMapsMatch(candidate(), { ...item, location: null }, { now }), null);
});

test('website binding preserves exact paths and never confuses branches on shared domains', () => {
  const website = { ...item, identifier: { kind: 'website', value: 'https://community.org/branch-a?service=food' } };
  const match = { ...candidate(), kind: 'website', value: website.identifier.value, listedValue: website.identifier.value };
  assert.ok(projectGoogleMapsMatch(match, website, { now }));
  assert.equal(projectGoogleMapsMatch({ ...match, value: 'https://community.org/branch-b?service=food' }, website, { now }), null);
  assert.equal(projectGoogleMapsMatch({ ...match, value: 'https://community.org/branch-a?service=shelter' }, website, { now }), null);
});

test('old or explicitly stale matches remain usable with an honest saved-observation label', async () => {
  for (const match of [{ ...candidate(), observedAt: '2026-10-01T18:00:00Z' }, { ...candidate(), freshness: 'stale' }]) {
    const plan = await buildReportingPlan(item, { googleMapsMatch: match, now });
    assert.equal(plan.googleMaps.freshness, 'stale');
    assert.match(plan.routes[0].title, /saved matching Google Maps/);
    assert.match(plan.routes[0].requirements.join(' '), /not a new check/);
    assert.match(plan.routes[0].requirements.join(' '), /stale; recheck/);
    assert.match(plan.routes[0].steps.join(' '), /only if the current listing needs correction/);
  }
  const generic = await buildReportingPlan(item, { googleMapsMatch: { ...candidate(), locationId: 'other' }, now });
  assert.equal(generic.googleMaps, null);
  assert.equal(generic.routes[0].url, 'https://support.google.com/maps/answer/7084895?hl=en');
});
