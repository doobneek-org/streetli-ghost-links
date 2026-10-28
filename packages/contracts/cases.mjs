// Strict allowlist for the collaboration contract. This does not establish truth,
// authorize publication, or replace the private adapter's provenance review.
const fail = message => { throw new TypeError(`Invalid case feed: ${message}`); };
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}.${key} is not allowed`);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
}
function text(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail(`${label} must be bounded text`);
}
function one(value, options, label) { if (!options.includes(value)) fail(`${label} is unsupported`); }
function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} must be a UTC timestamp`);
}
function webUrl(value, label) {
  text(value, label, 2048);
  let url;
  try { url = new URL(value); } catch { fail(`${label} must be an absolute web URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(`${label} must be a credential-free HTTP(S) URL`);
}
function identifierValue(kind, value, label) {
  text(value, label, 2048);
  if (kind === 'website') webUrl(value, label);
  if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(`${label} must be an email address`);
  if (kind === 'phone' && !/^\+[1-9]\d{6,14}(?:;ext=\d{1,10})?$/.test(value)) fail(`${label} must be an international phone number`);
}
export function validateCaseFeed(feed) {
  const version = feed?.schemaVersion;
  if (![1, 2].includes(version)) fail('schemaVersion must be 1 or 2');
  object(feed, ['schemaVersion', 'mode', 'generatedAt', 'cases', ...(version === 2 ? ['coverage'] : [])], 'feed');
  one(feed.mode, ['fixture', 'live'], 'mode');
  timestamp(feed.generatedAt, 'generatedAt');
  if (!Array.isArray(feed.cases) || feed.cases.length > (version === 2 ? 10000 : 100)) fail('cases must be a bounded array');
  if (version === 2) {
    object(feed.coverage, ['scope', 'sourceCounts', 'returned', 'omitted'], 'coverage');
    one(feed.coverage.scope, ['retained_records_only'], 'coverage.scope');
    object(feed.coverage.sourceCounts, ['website', 'phone', 'email'], 'coverage.sourceCounts');
    for (const value of [...Object.values(feed.coverage.sourceCounts), feed.coverage.returned, feed.coverage.omitted]) {
      if (!Number.isSafeInteger(value) || value < 0) fail('coverage counts must be nonnegative integers');
    }
    if (feed.coverage.returned !== feed.cases.length) fail('coverage.returned must match the case count');
  }
  const ids = new Set();
  for (const item of feed.cases) {
    object(item, ['id', 'organization', 'identifier', 'internal', 'replacement', 'externalReferences', 'reviewState', ...(version === 2 ? ['location'] : [])], 'case');
    text(item.id, 'id', version === 2 ? 200 : 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id)) fail('case IDs must be unique stable identifiers');
    ids.add(item.id);
    object(item.organization, ['name', 'locality'], 'organization');
    text(item.organization.name, 'organization.name', 200); text(item.organization.locality, 'organization.locality', 160);
    object(item.identifier, ['kind', 'value'], 'identifier');
    one(item.identifier.kind, ['website', 'phone', 'email'], 'identifier.kind');
    // Bad-format historical phone/email identifiers remain bounded text in v2.
    // Consumers must not infer safe tel/mailto/website action URLs from them.
    if (version === 2) text(item.identifier.value, 'identifier.value', 2048);
    else identifierValue(item.identifier.kind, item.identifier.value, 'identifier.value');
    object(item.internal, ['state', 'reasonCode', 'correctedAt', 'source', 'coverage', ...(version === 2 ? ['flaggedAt'] : [])], 'internal');
    one(item.internal.state, version === 2 ? ['flagged', 'removed', 'replaced'] : ['removed', 'replaced'], 'internal.state');
    text(item.internal.reasonCode, 'internal.reasonCode', 80);
    if (!/^[a-z][a-z0-9_]*$/.test(item.internal.reasonCode)) fail('reasonCode must be a code');
    if (version === 1 || item.internal.correctedAt !== null) timestamp(item.internal.correctedAt, 'internal.correctedAt');
    if (version === 2 && item.internal.flaggedAt !== null) timestamp(item.internal.flaggedAt, 'internal.flaggedAt');
    if (item.internal.state === 'flagged' && item.internal.correctedAt !== null) fail('flagged contacts cannot assert a correction date');
    one(item.internal.source, ['confirmed_correction', 'retained_ledger', ...(version === 2 ? ['saved_scan'] : [])], 'internal.source');
    if (item.internal.source === 'saved_scan'
      && (item.internal.state !== 'flagged' || item.internal.correctedAt !== null)) fail('saved scans are unconfirmed flags, not corrections');
    one(item.internal.coverage, ['retained_records_only'], 'internal.coverage');
    if (item.internal.state === 'replaced') {
      object(item.replacement, ['value'], 'replacement');
      identifierValue(item.identifier.kind, item.replacement.value, 'replacement.value');
    } else if (item.replacement !== null) fail('unreplaced identifiers require replacement:null');
    one(item.reviewState, ['review_required', 'approved_for_research'], 'reviewState');
    if (version === 2 && item.location !== null) {
      object(item.location, ['id', 'url'], 'location');
      text(item.location.id, 'location.id', 120);
      if (!/^[A-Za-z0-9_-]+$/.test(item.location.id)) fail('location.id must be stable');
      webUrl(item.location.url, 'location.url');
      const locationUrl = new URL(item.location.url);
      if (locationUrl.protocol !== 'https:' || locationUrl.hostname !== 'gogetta.nyc'
        || !locationUrl.pathname.startsWith(`/team/location/${item.location.id}/`)
        || locationUrl.search || locationUrl.hash || locationUrl.port) fail('location.url must target the matching authenticated Sheets entry');
    }
    if (!Array.isArray(item.externalReferences) || item.externalReferences.length > 20) fail('externalReferences must be bounded');
    for (const reference of item.externalReferences) {
      object(reference, ['url', 'observedAt', 'state', 'quote', 'reportState'], 'externalReference');
      webUrl(reference.url, 'externalReference.url'); timestamp(reference.observedAt, 'externalReference.observedAt');
      one(reference.state, ['possible_match', 'still_present', 'not_present', 'unknown'], 'externalReference.state');
      if (typeof reference.quote !== 'string' || reference.quote.length > 500) fail('externalReference.quote must be bounded text');
      if (reference.state === 'still_present' && reference.quote.trim().length < 8) fail('still_present requires source evidence');
      one(reference.reportState, ['not_started', 'draft', 'submitted', 'verified_corrected'], 'externalReference.reportState');
      if (reference.reportState === 'verified_corrected' && reference.state !== 'not_present') fail('verified_corrected requires a checked absence of the old identifier');
    }
    if (feed.mode === 'fixture') {
      if (!item.id.startsWith('demo-') || !/fictional/i.test(item.organization.name)) fail('fixture cases must be visibly fictional');
      if (item.identifier.kind !== 'website' || !new URL(item.identifier.value).hostname.endsWith('.example')) fail('fixture identifiers must use reserved .example websites');
      if (item.replacement && !new URL(item.replacement.value).hostname.endsWith('.example')) fail('fixture replacements must use .example');
      if (item.externalReferences.some(r => !new URL(r.url).hostname.endsWith('.example'))) fail('fixture references must use .example');
    }
  }
  return feed;
}
