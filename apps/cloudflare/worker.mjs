// Cloudflare edge entry point. The Python research process remains a separate,
// explicitly configured runtime; this Worker never simulates its output.
import { PUBLIC_CASES_URL } from '../../packages/contracts/case-source.mjs';
import { validateCaseFeed } from '../../packages/contracts/cases.mjs';
import { buildDiscoveryPlan } from '../../packages/contracts/discovery-plan.mjs';
import { buildReportingPlan } from '../agent/reporting-routes.mjs';
import { buildLocationDetailUrl, projectLocationDetail } from '../../packages/contracts/location-detail.mjs';

const MAX_LOCATION_BYTES = 8 * 1024 * 1024;
const MAX_FEED_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4096;
const routes = new Map([
  ['/api/review-actions', ['GET', 'POST']], ['/api/discovery/findings', ['GET']],
  ['/api/discovery/run', ['POST']], ['/api/research', ['POST']],
  ['/api/research/test', ['POST']], ['/api/ask', ['POST']],
  ['/api/route', ['POST']], ['/api/route/cached', ['POST']], ['/api/event-check', ['POST']],
  ['/api/one/status', ['GET']], ['/api/one/team-ticket', ['POST']],
  ['/api/one/email-list', ['POST']], ['/api/one/ghost-report', ['POST']],
  ['/api/one/text-list', ['POST']], ['/api/one/log-event', ['POST']],
]);
const safeError = (code, status = 503) => Object.assign(new Error(code), { code, status });
// The Workers runtime rejects redirect: 'error'; 'manual' surfaces the 3xx so we refuse it ourselves.
const NO_REDIRECT = 'manual';
const redirected = response => response.status >= 300 && response.status < 400;
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);

function headers(api = true) {
  const result = new Headers({
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  if (api) result.set('Cache-Control', 'no-store');
  return result;
}
function json(payload, status = 200) {
  const responseHeaders = headers(); responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}
async function boundedText(body, limit, code) {
  if (!body) return '';
  const reader = body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw safeError(code, code === 'request_too_large' ? 413 : 503); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(output);
}
function backendConfiguration(environment) {
  if (!environment.RESEARCH_BACKEND_URL) return null;
  let base;
  try { base = new URL(environment.RESEARCH_BACKEND_URL); } catch { throw safeError('research_backend_configuration_invalid'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || !token(environment.RESEARCH_BACKEND_TOKEN)) throw safeError('research_backend_configuration_invalid');
  return { base, token: environment.RESEARCH_BACKEND_TOKEN };
}
function maintainerAuthorized(request, environment) {
  if (!token(environment.MAINTAINER_TOKEN)) return false;
  const supplied = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!supplied || supplied.length !== environment.MAINTAINER_TOKEN.length) return false;
  let different = 0;
  for (let index = 0; index < supplied.length; index++) different |= supplied.charCodeAt(index) ^ environment.MAINTAINER_TOKEN.charCodeAt(index);
  return different === 0;
}
function validCaseQuery(url) {
  const id = url.searchParams.get('caseId') || '';
  return /^[A-Za-z0-9_-]{1,200}$/.test(id) && url.searchParams.getAll('caseId').length === 1
    && [...url.searchParams.keys()].every(key => key === 'caseId') ? id : null;
}

export function createCloudflareWorker({ fetchImpl = fetch, now = Date.now, reporting = buildReportingPlan, ttlMs = 60000 } = {}) {
  let cached = null, loadedAt = 0, pending = null, lastRefreshAt = -Infinity;
  async function getCases({ refresh = false } = {}) {
    if (!refresh && cached && now() >= loadedAt && now() - loadedAt < ttlMs) return cached;
    if (pending) return pending;
    pending = (async () => {
      let response;
      try { response = await fetchImpl(PUBLIC_CASES_URL, { headers: { Accept: 'application/json' }, redirect: NO_REDIRECT, signal: AbortSignal.timeout(30000) }); }
      catch { throw safeError('case_source_unavailable'); }
      if (redirected(response) || !response.ok) throw safeError('case_source_unavailable');
      if (Number(response.headers.get('content-length')) > MAX_FEED_BYTES) throw safeError('case_source_too_large');
      const text = await boundedText(response.body, MAX_FEED_BYTES, 'case_source_too_large');
      let feed;
      try { feed = validateCaseFeed(JSON.parse(text)); if (feed.mode !== 'live') throw new Error('mode'); }
      catch { throw safeError('case_source_invalid_response'); }
      cached = feed; loadedAt = now(); return feed;
    })();
    try { return await pending; } finally { pending = null; }
  }
  // Reads the public, unauthenticated Streetli location projection for one case the feed
  // already lists. The id always comes from the feed, never from the caller, so this cannot
  // be steered at an arbitrary host, and no caller credential is forwarded upstream.
  async function locationDetail(item) {
    const target = buildLocationDetailUrl(item.location?.id);
    if (!target) throw safeError('location_unavailable', 404);
    let response;
    try { response = await fetchImpl(target, { headers: { Accept: 'application/json' }, redirect: NO_REDIRECT, signal: AbortSignal.timeout(30000) }); }
    catch { throw safeError('location_source_unavailable'); }
    if (redirected(response) || !response.ok) throw safeError('location_source_unavailable');
    const body = await boundedText(response.body, MAX_LOCATION_BYTES, 'location_source_too_large');
    let detail;
    try { detail = projectLocationDetail(JSON.parse(body)); } catch { throw safeError('location_source_invalid_response', 502); }
    if (!detail) throw safeError('location_source_invalid_response', 502);
    return { caseId: item.id, detail };
  }
  async function proxy(request, url, environment, backend) {
    if (request.method === 'POST') {
      if (!token(environment.MAINTAINER_TOKEN)) return json({ error: 'maintainer_access_not_configured' }, 503);
      if (!maintainerAuthorized(request, environment)) return json({ error: 'maintainer_access_required' }, 401);
    }
    const target = new URL(backend.base);
    target.pathname = `${target.pathname.replace(/\/$/, '')}${url.pathname}`;
    target.search = url.search;
    const body = request.method === 'POST' ? await boundedText(request.body, MAX_REQUEST_BYTES, 'request_too_large') : undefined;
    let response;
    try {
      response = await fetchImpl(target, { method: request.method, body, redirect: NO_REDIRECT,
        headers: { Authorization: `Bearer ${backend.token}`, Accept: request.headers.get('Accept') === 'application/x-ndjson' ? 'application/x-ndjson' : 'application/json',
          ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(600000) });
    } catch { return json({ error: 'research_backend_unavailable' }, 503); }
    if (redirected(response)) return json({ error: 'research_backend_unavailable' }, 503);
    if (!response.ok) {
      const status = [400, 404, 409, 413, 429].includes(response.status) ? response.status : 503;
      return json({ error: response.status === 429 ? 'research_busy' : 'research_backend_unavailable' }, status);
    }
    const type = response.headers.get('Content-Type') || '';
    if (!/^application\/(?:json|x-ndjson)(?:;|$)/i.test(type)) return json({ error: 'research_backend_invalid_response' }, 502);
    const responseHeaders = headers(); responseHeaders.set('Content-Type', type);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  }
  return {
    async fetch(request, environment = {}) {
      const url = new URL(request.url);
      const api = url.pathname.startsWith('/api/') || url.pathname === '/health';
      if (!api) {
        if (!environment.ASSETS?.fetch) return json({ error: 'assets_unavailable' }, 503);
        const response = await environment.ASSETS.fetch(request);
        const responseHeaders = new Headers(response.headers);
        for (const [key, value] of headers(false)) responseHeaders.set(key, value);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
      }
      if (request.method === 'POST' && ((request.headers.get('Origin') && request.headers.get('Origin') !== url.origin)
        || request.headers.get('Sec-Fetch-Site') === 'cross-site')) return json({ error: 'cross_origin_request_rejected' }, 403);
      try {
        if (url.pathname === '/health' && request.method === 'GET') {
          const backend = backendConfiguration(environment);
          return json({ ok: true, mode: 'live', liveResearchImplemented: Boolean(backend), researchBackendConfigured: Boolean(backend),
            researchBackendAvailable: backend ? null : false, caseCount: cached?.cases.length ?? null, generatedAt: cached?.generatedAt ?? null });
        }
        if (url.pathname === '/api/cases' && request.method === 'GET') {
          if (url.search) return json({ error: 'invalid_request' }, 400);
          return json(await getCases());
        }
        if (url.pathname === '/api/refresh' && request.method === 'POST') {
          if (url.search) return json({ error: 'invalid_request' }, 400);
          if (now() - lastRefreshAt < 10000) return json({ error: 'refresh_throttled' }, 429);
          lastRefreshAt = now(); return json(await getCases({ refresh: true }));
        }
        if (url.pathname === '/api/reporting' && request.method === 'GET') {
          const id = validCaseQuery(url);
          if (!id) return json({ error: 'invalid_case_request' }, 400);
          const selected = (await getCases()).cases.find(item => item.id === id);
          return selected ? json(await reporting(selected)) : json({ error: 'case_not_found' }, 404);
        }
        if (url.pathname === '/api/location' && request.method === 'GET') {
          const id = validCaseQuery(url);
          if (!id) return json({ error: 'invalid_case_request' }, 400);
          const selected = (await getCases()).cases.find(item => item.id === id);
          return selected ? json(await locationDetail(selected)) : json({ error: 'case_not_found' }, 404);
        }
        if (routes.has(url.pathname)) {
          if (!routes.get(url.pathname).includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
          if (url.pathname === '/api/research' ? !validCaseQuery(url) : Boolean(url.search)) return json({ error: 'invalid_request' }, 400);
          const backend = backendConfiguration(environment);
          if (backend) return await proxy(request, url, environment, backend);
          if (url.pathname === '/api/review-actions' && request.method === 'GET') return json({ mode: 'live', actions: {}, researchBackendAvailable: false });
          if (url.pathname === '/api/discovery/findings') {
            const plan = buildDiscoveryPlan(await getCases(), { now: now(), maxJobs: 100 });
            return json({ mode: 'live', findings: {}, eligibleCaseIds: plan.eligibleCaseIds,
              due: plan.jobs.length + plan.skipped.capacity, researchBackendAvailable: false });
          }
          return json({ error: 'research_backend_unavailable', researchBackendAvailable: false }, 503);
        }
        const known = ['/health', '/api/cases', '/api/refresh', '/api/reporting', '/api/location'].includes(url.pathname);
        return json({ error: known ? 'method_not_allowed' : 'not_found' }, known ? 405 : 404);
      } catch (error) {
        const allowed = ['case_source_unavailable', 'case_source_too_large', 'case_source_invalid_response', 'request_too_large', 'research_backend_configuration_invalid',
          'location_unavailable', 'location_source_unavailable', 'location_source_too_large', 'location_source_invalid_response'];
        return json({ error: allowed.includes(error.code) ? error.code : 'case_data_unavailable' }, error.status || 503);
      }
    },
  };
}

export default createCloudflareWorker();
