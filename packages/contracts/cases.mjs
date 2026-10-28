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
  object(feed, ['schemaVersion', 'mode', 'generatedAt', 'cases'], 'feed');
  if (feed.schemaVersion !== 1) fail('schemaVersion must be 1');
  one(feed.mode, ['fixture', 'live'], 'mode');
  timestamp(feed.generatedAt, 'generatedAt');
  if (!Array.isArray(feed.cases) || feed.cases.length > 100) fail('cases must be an array of at most 100 records');
  const ids = new Set();
  for (const item of feed.cases) {
    object(item, ['id', 'organization', 'identifier', 'internal', 'replacement', 'externalReferences', 'reviewState'], 'case');
    text(item.id, 'id', 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id)) fail('case IDs must be unique stable identifiers');
    ids.add(item.id);
    object(item.organization, ['name', 'locality'], 'organization');
    text(item.organization.name, 'organization.name', 200); text(item.organization.locality, 'organization.locality', 160);
    object(item.identifier, ['kind', 'value'], 'identifier');
    one(item.identifier.kind, ['website', 'phone', 'email'], 'identifier.kind');
    identifierValue(item.identifier.kind, item.identifier.value, 'identifier.value');
    object(item.internal, ['state', 'reasonCode', 'correctedAt', 'source', 'coverage'], 'internal');
    one(item.internal.state, ['removed', 'replaced'], 'internal.state');
    text(item.internal.reasonCode, 'internal.reasonCode', 80);
    if (!/^[a-z][a-z0-9_]*$/.test(item.internal.reasonCode)) fail('reasonCode must be a code');
    timestamp(item.internal.correctedAt, 'internal.correctedAt');
    one(item.internal.source, ['confirmed_correction', 'retained_ledger'], 'internal.source');
    one(item.internal.coverage, ['retained_records_only'], 'internal.coverage');
    if (item.internal.state === 'replaced') {
      object(item.replacement, ['value'], 'replacement');
      identifierValue(item.identifier.kind, item.replacement.value, 'replacement.value');
    } else if (item.replacement !== null) fail('removed identifiers require replacement:null');
    one(item.reviewState, ['review_required', 'approved_for_research'], 'reviewState');
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
