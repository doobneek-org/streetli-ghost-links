import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

const DAY = 24 * 60 * 60 * 1000;
const BASE_RETRY = 5 * 60 * 1000;
const MAX_RETRY = 6 * 60 * 60 * 1000;
const MAX_CASES = 10000;
const MAX_JOBS = 100;
// Surfaces we operate. A stale identifier on one of these is corrected at the source,
// not reported as an external finding, so discovery must not spend a query rediscovering
// our own listings. Verified owned before being added; see docs/external-discovery.md.
export const OWNED_DOMAINS = ['gogetta.nyc', 'yourpeer.nyc'];
const hash = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const domain = value => typeof value === 'string' && value.length <= 253 && value.includes('.') && !isIP(value)
  && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  && /[a-z]/i.test(value.split('.').at(-1)) && !/\.(?:localhost|local|internal|example|invalid|test)$/i.test(value);
const quote = value => `"${value.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
const timestamp = value => {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)) return NaN;
  return Date.parse(value);
};

export function normalizeDiscoveryIdentifier(identifier) {
  const { kind, value } = identifier || {};
  if (!boundedText(value, 2048)) return null;
  const input = value.trim();
  if (kind === 'phone') return /^\+[1-9]\d{6,14}(?:;ext=\d{1,10})?$/.test(input) ? { kind, value: input } : null;
  if (kind === 'email') {
    const match = input.match(/^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64})@([A-Za-z0-9.-]+)$/);
    return match && input.length <= 254 && domain(match[2]) && !match[1].startsWith('.') && !match[1].endsWith('.') && !match[1].includes('..')
      ? { kind, value: input.toLowerCase() } : null;
  }
  if (kind !== 'website' || /[\s"\\]/.test(input)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !domain(url.hostname)) return null;
    // Public contact URLs must not leak authentication material to search APIs.
    if ([...url.searchParams.keys()].some(key => /(?:^|[_-])(?:token|secret|password|auth|authorization|credential|session|signature|key|code|sid|api[_-]?key)(?:$|[_-])/i.test(key))) return null;
    url.hash = '';
    return { kind, value: url.href };
  } catch { return null; }
}

function publicIdentity(organization) {
  if (!boundedText(organization?.name, 200)) return null;
  const name = organization.name.trim().replace(/\s+/g, ' ');
  if (!/[\p{L}\p{N}]/u.test(name)
    || /\b(?:identity (?:unavailable|unknown|ambiguous)|(?:unknown|unavailable|unspecified|unresolved|historical) (?:provider|organization)|multiple providers|ambiguous identity|fictional)\b/i.test(name)
    || /^(?:unknown|unavailable|n\/?a|provider|organization|location|not known|not available)$/i.test(name)) return null;
  const locality = boundedText(organization.locality, 160) ? organization.locality.trim().replace(/\s+/g, ' ') : '';
  return { name, locality: /^(?:unknown|unavailable|n\/?a|not known|not available)$/i.test(locality) ? '' : locality };
}

function sourceBinding(item, identity) {
  // Bind only approved public source fields. Feed generation/check timestamps,
  // cached external evidence and review-state changes do not alter the source.
  const field = value => typeof value === 'string' && value.length <= 2048 ? value : null;
  return {
    caseId: item.id,
    identifier: { kind: field(item.identifier.kind), value: field(item.identifier.value) },
    identity,
    locationId: field(item.location?.id),
    internal: {
      state: field(item.internal?.state), source: field(item.internal?.source), reasonCode: field(item.internal?.reasonCode),
      correctedAt: field(item.internal?.correctedAt), flaggedAt: field(item.internal?.flaggedAt),
    },
    replacement: field(item.replacement?.value),
  };
}

/**
 * Pure, research-only scheduling over an already validated case feed.
 *
 * previousResults: [{ binding, status: 'completed'|'error', checkedAt,
 *   attemptedAt?, attempts?, retryAt? }]. completed.checkedAt is the discovery
 * run completion time, never an assertion that a page was freshly fetched.
 * Errors use attemptedAt (or checkedAt for older saved results); observedAt,
 * fetchedAt and feed.generatedAt never refresh this cache. Page evidence keeps
 * its own retrieval timestamps and truth/approval gates outside this planner.
 *
 * skipped counts identifier groups; skippedCases counts input case rows.
 * eligibleCaseIds includes safe known-identity rows even when cached/deferred.
 * scheduledCaseIds contains only case IDs belonging to jobs returned this run.
 */
export function buildDiscoveryPlan(feed, { previousResults = [], now = Date.now(), maxJobs = 20, ownedDomains = [] } = {}) {
  const time = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(time)) throw new TypeError('Discovery planning requires a valid current time.');
  if (!feed || !['live', 'fixture'].includes(feed.mode) || !Array.isArray(feed.cases) || feed.cases.length > MAX_CASES) throw new TypeError('Discovery planning requires a bounded validated case feed.');
  const limit = Number.isFinite(Number(maxJobs)) ? Math.max(0, Math.min(MAX_JOBS, Math.floor(Number(maxJobs)))) : 20;
  const excludedDomains = [...new Set([...OWNED_DOMAINS, ...(Array.isArray(ownedDomains) ? ownedDomains.slice(0, 20).filter(domain).map(value => value.toLowerCase()) : [])])].sort(compare);
  const plan = { generatedAt: new Date(time).toISOString(), mode: feed.mode, researchOnly: true, jobs: [], eligibleCaseIds: [], scheduledCaseIds: [],
    skipped: { freshCache: 0, retryBackoff: 0, capacity: 0 }, skippedCases: { fixture: 0, invalidIdentifier: 0, unknownIdentity: 0, invalidCase: 0 } };
  if (feed.mode === 'fixture') { plan.skippedCases.fixture = feed.cases.length; return plan; }
  const groups = new Map();
  const ids = new Set();
  for (const item of feed.cases) {
    if (!item || !boundedText(item.id, 200) || !/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id)) { plan.skippedCases.invalidCase++; continue; }
    ids.add(item.id);
    const identifier = normalizeDiscoveryIdentifier(item.identifier);
    if (!identifier) { plan.skippedCases.invalidIdentifier++; continue; }
    const identity = publicIdentity(item.organization);
    if (!identity) { plan.skippedCases.unknownIdentity++; continue; }
    const key = `${identifier.kind}\n${identifier.value}`;
    if (!groups.has(key)) groups.set(key, { key, identifier, items: [], identities: new Map() });
    const group = groups.get(key);
    group.items.push({ item, identity });
    group.identities.set(JSON.stringify(identity), identity);
  }
  const priorByBinding = new Map();
  for (const result of Array.isArray(previousResults) ? previousResults.slice(0, 20000) : []) {
    if (!result || !/^[a-f0-9]{64}$/.test(result.binding) || !['completed', 'error'].includes(result.status)) continue;
    const resultTime = timestamp(result.status === 'error' ? result.attemptedAt || result.checkedAt : result.checkedAt);
    if (!Number.isFinite(resultTime) || resultTime > time) continue;
    if (!priorByBinding.has(result.binding) || priorByBinding.get(result.binding).time < resultTime) priorByBinding.set(result.binding, { result, time: resultTime });
  }
  for (const group of [...groups.values()].sort((a, b) => compare(a.key, b.key))) {
    group.items.sort((a, b) => compare(a.item.id, b.item.id));
    const caseIds = group.items.map(({ item }) => item.id);
    plan.eligibleCaseIds.push(...caseIds);
    const identities = [...group.identities.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
    const binding = hash(JSON.stringify({ queryVersion: 2, identifier: group.identifier, sources: group.items.map(({ item, identity }) => sourceBinding(item, identity)), excludedDomains }));
    const prior = priorByBinding.get(binding);
    if (prior?.result.status === 'completed' && time - prior.time < DAY) { plan.skipped.freshCache++; continue; }
    if (prior?.result.status === 'error') {
      const attempts = Number.isInteger(prior.result.attempts) ? Math.max(1, Math.min(8, prior.result.attempts)) : 1;
      const delay = Math.min(MAX_RETRY, BASE_RETRY * 2 ** (attempts - 1));
      const explicitRetry = timestamp(prior.result.retryAt);
      const retryAt = Number.isFinite(explicitRetry) ? Math.max(prior.time + delay, Math.min(prior.time + MAX_RETRY, explicitRetry)) : prior.time + delay;
      if (time < retryAt) { plan.skipped.retryBackoff++; continue; }
    }
    if (plan.jobs.length >= limit) { plan.skipped.capacity++; continue; }
    const exclusions = excludedDomains.map(value => `-site:${value}`).join(' ');
    const exact = quote(group.identifier.value);
    const queries = [`${exact} ${exclusions}`];
    // Shared identifiers are searched broadly once; do not choose an arbitrary
    // organization/branch and hide legitimate uses by the others.
    const nationalPhone = group.identifier.kind === 'phone' && group.identifier.value.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
    if (nationalPhone) {
      const [, area, exchange, subscriber] = nationalPhone;
      const variants = `(${quote(`${area}-${exchange}-${subscriber}`)} OR ${quote(`(${area}) ${exchange}-${subscriber}`)} OR ${quote(`${area} ${exchange} ${subscriber}`)})`;
      const identity = identities.length === 1 ? identities[0] : null;
      queries.push(`${variants}${identity ? ` ${quote(identity.name)}${identity.locality ? ` ${quote(identity.locality)}` : ''}` : ''} ${exclusions}`);
    } else if (identities.length === 1) {
      const identity = identities[0];
      queries.push(`${exact} ${quote(identity.name)}${identity.locality ? ` ${quote(identity.locality)}` : ''} ${exclusions}`);
    }
    plan.jobs.push({ id: `discovery-${hash(group.key).slice(0, 24)}`, binding, kind: group.identifier.kind, identifier: { ...group.identifier }, caseIds, identities,
      queries, excludedDomains: [...excludedDomains], maxResults: 5, maxPages: 3, researchOnly: true });
    plan.scheduledCaseIds.push(...caseIds);
  }
  plan.eligibleCaseIds.sort(compare);
  plan.scheduledCaseIds.sort(compare);
  return plan;
}
