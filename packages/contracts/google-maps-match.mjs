import { normalizeDiscoveryIdentifier } from './discovery-plan.mjs';

const DAY = 24 * 60 * 60 * 1000;
const bounded = (value, max) => typeof value === 'string' && value.trim() && value.length <= max
  && !/[\u0000-\u001f\u007f<>]/.test(value);

// Only a saved match bound to the selected location and identifier can become a
// direct Maps link. A name-only search is never promoted to a matched listing.
export function projectGoogleMapsMatch(candidate, item, { now = Date.now() } = {}) {
  if (!candidate || candidate.provenance !== 'saved_google_places_match'
    || !['fresh', 'stale'].includes(candidate.freshness)
    || !item?.location?.id || candidate.locationId !== item.location.id
    || candidate.kind !== item?.identifier?.kind
    || !/^[A-Za-z0-9_-]{8,256}$/.test(candidate.placeId || '')
    || !bounded(candidate.name, 300) || !bounded(candidate.listedValue, 2048)
    || (candidate.address !== '' && !bounded(candidate.address, 500))) return null;
  const expected = normalizeDiscoveryIdentifier(item.identifier);
  const actual = normalizeDiscoveryIdentifier({ kind: candidate.kind, value: candidate.value });
  if (!expected || !actual || expected.kind !== actual.kind || expected.value !== actual.value) return null;
  const observed = typeof candidate.observedAt === 'string'
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(candidate.observedAt)
    ? Date.parse(candidate.observedAt) : NaN;
  if (!Number.isFinite(observed) || !Number.isFinite(now) || observed > now) return null;
  const name = candidate.name.trim(), address = candidate.address.trim();
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', [name, address].filter(Boolean).join(', '));
  url.searchParams.set('query_place_id', candidate.placeId);
  return {
    locationId: item.location.id, kind: actual.kind, value: actual.value,
    placeId: candidate.placeId, name, address, listedValue: candidate.listedValue.trim(),
    observedAt: candidate.observedAt,
    freshness: candidate.freshness === 'stale' || now - observed > DAY ? 'stale' : 'fresh',
    provenance: 'saved_google_places_match', url: url.href,
  };
}
