import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCaseFeed } from '../../packages/contracts/cases.mjs';
import { PUBLIC_CASES_URL } from '../../packages/contracts/case-source.mjs';
import { createResearchRunner, manualTestCase } from './research-route.mjs';
import { createReviewStore, parseDecision } from './review-actions.mjs';
import { createDiscoveryRunner, runPython } from './discovery-runner.mjs';
import { mkdir as mkdirCache, readFile as readCache, writeFile as writeCache } from 'node:fs/promises';
import { eventRows, ghostReportEmail, gmailRaw, loadOneConfig, normalizePhone, oneStatus, runOneAction, serviceListEmail, serviceListSms, teamTicketText, validEmail } from './one-actions.mjs';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const contentTypes = { '/': 'text/html; charset=utf-8', '/app.js': 'text/javascript; charset=utf-8', '/styles.css': 'text/css; charset=utf-8' };
const assetNames = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
const safeError = (code, status = 503) => Object.assign(new Error(code), { code, status });
const BACKEND_TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

// Hosted backend mode (Cloud Run behind the Cloudflare Worker): every request except
// /health must carry the Worker's `Bearer RESEARCH_BACKEND_TOKEN`.
export function backendAuthorized(header, backendToken) {
  const supplied = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header || '')?.[1];
  return Boolean(supplied && supplied.length === backendToken.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(backendToken)));
}

export async function loadLocalEnv(path = resolve('.env'), environment = process.env) {
  let file;
  try { file = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const line of file.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || Object.hasOwn(environment, match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    environment[match[1]] = value;
  }
}

export function createLiveSource({ sourceUrl, token, fetchImpl = fetch, ttlMs = 300000, timeoutMs = 120000 } = {}) {
  let url;
  try { url = new URL(sourceUrl); } catch { throw safeError('invalid_case_source_config', 500); }
  const publicSource = url.href === PUBLIC_CASES_URL;
  if ((!publicSource && (typeof token !== 'string' || token.length < 24))
    || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000
    || url.username || url.password || url.search || url.hash
    || !['http:', 'https:'].includes(url.protocol)
    || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw safeError('invalid_case_source_config', 500);
  let cached = null;
  let loadedAt = 0;
  let inFlight = null;
  return async ({ refresh = false } = {}) => {
    if (!refresh && cached && Date.now() - loadedAt < ttlMs) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const endpoint = new URL(url);
      if (refresh) endpoint.searchParams.set('refresh', '1');
      let response;
      try { response = await fetchImpl(endpoint, { headers: publicSource ? {} : { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
      catch { throw safeError('case_source_unavailable'); }
      if (!response.ok) throw safeError(response.status === 401 ? 'case_source_unauthorized' : 'case_source_unavailable');
      if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) throw safeError('case_source_too_large');
      let body;
      try {
        let length = 0;
        const chunks = [];
        for await (const chunk of response.body) {
          length += chunk.byteLength;
          if (length > MAX_RESPONSE_BYTES) throw new Error('size');
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        validateCaseFeed(body);
        if (body.mode !== 'live') throw new Error('mode');
      } catch { throw safeError('case_source_invalid_response'); }
      cached = body;
      loadedAt = Date.now();
      return cached;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  };
}

// NDJSON progress stream to the browser.
function startStream(response) {
  response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  response.writeHead(200);
  return line => { if (!response.writableEnded) response.write(`${JSON.stringify(line)}\n`); };
}

const describeDiscovery = event => event.type === 'plan' ? { step: 'plan', status: 'done', message: `${event.running} of ${event.due} due jobs running · ${event.eligible} eligible records · ${event.skipped?.freshCache || 0} fresh in cache` }
    : event.type === 'job' ? { step: 'job', status: 'start', message: `Job ${event.index}/${event.total}: ${event.kind} used by ${event.caseIds.length} record(s)` }
    : event.type === 'job_done' ? { step: 'job', status: event.status === 'completed' ? 'done' : 'error', message: `Job ${event.index} ${event.status}: ${event.findings.map(f => f.verdict).join(', ') || 'no findings'}` }
    : event;

async function streamDiscovery(response, feed, options) {
  const write = startStream(response);
  try {
    const result = await options.discovery.runDue(feed, { ...options, onEvent: event => write({ type: 'event', ...describeDiscovery(event) }) });
    write({ type: 'result', kind: 'discovery', ...result });
  } catch (error) {
    write({ type: 'error', message: error.code === 'research_busy' ? 'Another research run is in progress.' : 'Discovery failed. Check the server console and provider keys.' });
  }
  response.end();
}

async function readJsonBody(request, limit = 4096) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw safeError('request_too_large', 413);
  }
  try { return JSON.parse(body); } catch { throw safeError('invalid_request', 400); }
}

export async function createFixtureServer({ sourceUrl = '', token = '', fetchImpl = fetch, source = null, research = createResearchRunner(), reviews = createReviewStore(), discovery = createDiscoveryRunner(), python = runPython, one = {}, backendToken = '' } = {}) {
  const oneConfig = one.loadConfig || loadOneConfig;
  const oneFetch = one.fetchImpl || fetch;
  const oneEnv = one.env || process.env;
  let lastServiceResult = null;
  // Demo mode: the last successful result per request, saved under ignored data/.
  const cacheFile = one.cacheFile || new URL('../../data/route-cache.json', import.meta.url);
  const cacheKey = text => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const readRouteCache = async () => { try { return JSON.parse(await readCache(cacheFile, 'utf8')); } catch { return {}; } };
  const saveRouteCache = async (text, result) => {
    try {
      const cache = await readRouteCache();
      cache[cacheKey(text)] = { savedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), result };
      const entries = Object.entries(cache).sort((a, b) => String(b[1].savedAt).localeCompare(String(a[1].savedAt))).slice(0, 25);
      await mkdirCache(new URL('.', cacheFile), { recursive: true });
      await writeCache(cacheFile, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
    } catch { /* the cache is optional */ }
  };
  let lastOneAction = 0;
  const fixture = validateCaseFeed(JSON.parse(await readFile(new URL('../../fixtures/cases.demo.json', import.meta.url), 'utf8')));
  const mode = source || sourceUrl ? 'live' : 'fixture';
  const getCases = source || (sourceUrl ? createLiveSource({ sourceUrl, token, fetchImpl }) : async () => fixture);
  let lastFeed = null;
  let lastRefreshStarted = 0;
  let routing = false;
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, body) => { response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.writeHead(status); response.end(JSON.stringify(body)); };
    const host = String(request.headers.host || '');
    if (backendToken) {
      // Browsers never call the backend directly; the Worker sends no Origin.
      if (request.headers.origin) return send(403, { error: 'cross_origin_request_rejected' });
      if (!(request.url === '/health' && request.method === 'GET') && !backendAuthorized(request.headers.authorization, backendToken)) return send(401, { error: 'backend_token_required' });
    } else if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) return send(403, { error: 'local_dev_only' });
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return send(403, { error: 'cross_origin_request_rejected' });
    if (request.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'cross_origin_request_rejected' });
    let path;
    try { path = new URL(request.url, `http://${host}`).pathname; } catch { return send(400, { error: 'invalid_request' }); }
    try {
      if (path === '/health' && request.method === 'GET') return send(200, { ok: true, mode, liveResearchImplemented: true,
        researchRuntimeAvailable: discovery.available(), caseCount: lastFeed?.cases.length ?? null, generatedAt: lastFeed?.generatedAt ?? null });
      if (path === '/api/cases' && request.method === 'GET') {
        lastFeed = validateCaseFeed(await getCases());
        return send(200, lastFeed);
      }
      if (path === '/api/reporting' && request.method === 'GET') {
        const params = new URL(request.url, `http://${host}`).searchParams;
        const caseId = params.get('caseId') || '';
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(caseId) || params.getAll('caseId').length !== 1
          || [...params.keys()].some(key => key !== 'caseId')) return send(400, {error: 'invalid_case_request'});
        lastFeed = validateCaseFeed(await getCases());
        if (lastFeed.mode !== 'live') return send(409, {error: 'fixture_reporting_disabled'});
        const selected = lastFeed.cases.find(item => item.id === caseId);
        if (!selected) return send(404, {error: 'case_not_found'});
        const { buildReportingPlan } = await import('./reporting-routes.mjs');
        return send(200, await buildReportingPlan(selected));
      }
      // Mirrors the Cloudflare Worker's /api/location so the inline Streetli panel behaves
      // the same under `npm run dev` as it does on the deployed site. Public read, no token.
      if (path === '/api/location' && request.method === 'GET') {
        const params = new URL(request.url, `http://${host}`).searchParams;
        const caseId = params.get('caseId') || '';
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(caseId) || params.getAll('caseId').length !== 1
          || [...params.keys()].some(key => key !== 'caseId')) return send(400, {error: 'invalid_case_request'});
        lastFeed = validateCaseFeed(await getCases());
        const selected = lastFeed.cases.find(item => item.id === caseId);
        if (!selected) return send(404, {error: 'case_not_found'});
        const { buildLocationDetailUrl, projectLocationDetail } = await import('../../packages/contracts/location-detail.mjs');
        const target = buildLocationDetailUrl(selected.location?.id);
        if (!target) return send(404, {error: 'location_unavailable'});
        try {
          const response = await fetchImpl(target, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
          if (!response.ok) return send(503, {error: 'location_source_unavailable'});
          const detail = projectLocationDetail(await response.json());
          return detail ? send(200, { caseId, detail }) : send(502, {error: 'location_source_invalid_response'});
        } catch { return send(503, {error: 'location_source_unavailable'}); }
      }
      if (path === '/api/refresh' && request.method === 'POST') {
        if (Date.now() - lastRefreshStarted < 10000) return send(429, { error: 'refresh_throttled' });
        lastRefreshStarted = Date.now();
        lastFeed = validateCaseFeed(await getCases({ refresh: true }));
        return send(200, lastFeed);
      }
      // Live case research runs the discovery planner's job for that case: approved cases,
      // or cases in the planner's trusted eligibility scope. Fixtures never reach live search.
      if (path === '/api/research' && request.method === 'POST') {
        const params = new URL(request.url, `http://${host}`).searchParams;
        const caseId = params.get('caseId') || '';
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(caseId) || [...params.keys()].some(key => key !== 'caseId')) return send(400, { error: 'invalid_case_request' });
        lastFeed = validateCaseFeed(await getCases());
        if (lastFeed.mode !== 'live') return send(409, { error: 'fixture_research_disabled' });
        const selected = lastFeed.cases.find(item => item.id === caseId);
        if (!selected) return send(404, { error: 'case_not_found' });
        const plan = await discovery.plan(lastFeed, { maxJobs: 100 });
        if (selected.reviewState !== 'approved_for_research' && !plan.eligibleCaseIds.includes(caseId)) return send(409, { error: 'research_requires_approval' });
        if (!discovery.available()) return send(503, { error: 'research_runtime_missing' });
        if (research.busy || discovery.busy) return send(429, { error: 'research_busy' });
        return streamDiscovery(response, lastFeed, { discovery, maxJobs: 1, onlyCaseIds: [caseId] });
      }
      if (path === '/api/discovery/run' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const maxJobs = Number.isInteger(body?.maxJobs) ? Math.min(Math.max(body.maxJobs, 1), 5) : 3;
        lastFeed = validateCaseFeed(await getCases());
        if (lastFeed.mode !== 'live') return send(409, { error: 'fixture_research_disabled' });
        if (!discovery.available()) return send(503, { error: 'research_runtime_missing' });
        if (research.busy || discovery.busy) return send(429, { error: 'research_busy' });
        // Optionally target one dashboard category (for example the possible-compromise records).
        const { CATEGORIES, categoryOf } = await import('./ask.mjs');
        const onlyCaseIds = Object.hasOwn(CATEGORIES, body?.category) ? lastFeed.cases.filter(item => categoryOf(item) === body.category).map(item => item.id) : null;
        if (onlyCaseIds && !onlyCaseIds.length) return send(409, { error: 'no_cases_in_category' });
        return streamDiscovery(response, lastFeed, { discovery, maxJobs, ...(onlyCaseIds ? { onlyCaseIds } : {}) });
      }
      if (path === '/api/discovery/findings' && request.method === 'GET') {
        const feedNow = lastFeed || validateCaseFeed(await getCases());
        if (feedNow.mode !== 'live') return send(200, { mode: feedNow.mode, findings: {}, eligibleCaseIds: [] });
        const plan = await discovery.plan(feedNow, { maxJobs: 100 });
        const ids = new Set(feedNow.cases.map(item => item.id));
        const findings = Object.fromEntries(Object.entries(await discovery.findings(feedNow)).filter(([id]) => ids.has(id)));
        return send(200, { mode: feedNow.mode, findings, eligibleCaseIds: plan.eligibleCaseIds, due: plan.jobs.length });
      }
      if (path === '/api/ask' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const text = typeof body?.request === 'string' ? body.request.trim() : '';
        if (text.length < 3 || text.length > 300 || /[\u0000-\u001f]/.test(text)) return send(400, { error: 'invalid_request_text' });
        if (!discovery.available()) return send(503, { error: 'research_runtime_missing' });
        lastFeed = validateCaseFeed(await getCases());
        const eligible = lastFeed.mode === 'live' ? (await discovery.plan(lastFeed, { maxJobs: 100 })).eligibleCaseIds : [];
        const write = startStream(response);
        const { answerRequest } = await import('./ask.mjs');
        const runStage = (stage, input) => python({ stage, input });
        try {
          const result = await answerRequest(text, lastFeed, { runStage, eligibleCaseIds: eligible, onEvent: event => write({ type: 'event', ...event }) });
          write(result.error ? { type: 'error', message: 'The request could not be interpreted. Try rephrasing it.' } : { type: 'result', kind: 'ask', ...result });
        } catch { write({ type: 'error', message: 'The request failed. Check the server console and provider keys.' }); }
        return response.end();
      }
      // Demo mode: return the saved result for this request, clearly labeled as saved.
      if (path === '/api/route/cached' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const text = typeof body?.request === 'string' ? body.request.trim() : '';
        const hit = text ? (await readRouteCache())[cacheKey(text)] : null;
        if (!hit) return send(404, { error: 'no_saved_result' });
        if (hit.result.kind === 'event' || hit.result.kind === 'find') lastServiceResult = hit.result;
        return send(200, { ...hit.result, cached: true, savedAt: hit.savedAt });
      }
      // One box: a Parasail router (route-request stage) decides which flow handles the message.
      if (path === '/api/route' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const text = typeof body?.request === 'string' ? body.request.trim() : '';
        if (text.length < 3 || text.length > 300 || /[\u0000-\u001f]/.test(text)) return send(400, { error: 'invalid_request_text' });
        if (!discovery.available()) return send(503, { error: 'research_runtime_missing' });
        if (research.busy || discovery.busy || routing) return send(429, { error: 'research_busy' });
        // The person chose "search all of New York City" after being asked where to look.
        const citywide = body?.citywide === true;
        const cacheKey = citywide ? `${text} (all of New York City)` : text;
        routing = true;
        const write = startStream(response);
        const onEvent = event => write({ type: 'event', ...event });
        try {
          lastFeed = validateCaseFeed(await getCases());
          onEvent({ step: 'route', status: 'start', message: 'Parasail deciding how to handle this via CrewAI' });
          const routed = await python({ stage: 'route-request', input: { request: text } });
          const route = ['records', 'event', 'find_services', 'unsupported'].includes(routed.output?.route) ? routed.output.route : 'unsupported';
          onEvent({ step: 'route', status: 'done', message: `${route.replace('_', ' ')}: ${String(routed.output?.reason || '').slice(0, 200)}` });
          if (route === 'records') {
            const eligible = lastFeed.mode === 'live' ? (await discovery.plan(lastFeed, { maxJobs: 100 })).eligibleCaseIds : [];
            const { answerRequest } = await import('./ask.mjs');
            const result = await answerRequest(text, lastFeed, { runStage: (stage, input) => python({ stage, input }), eligibleCaseIds: eligible, onEvent });
            // Ask goes on to check the shortlist: is each old identifier still shown by a third
            // party, and what is the official way to report it. Fresh cached findings are reused.
            const shortlist = result.selection?.caseIds || [];
            if (!result.error && shortlist.length && lastFeed.mode === 'live') {
              const due = shortlist.filter(id => eligible.includes(id));
              if (due.length) {
                onEvent({ step: 'research', status: 'start', message: `Checking where ${due.length} old identifier(s) are still listed (You.com + Parasail)` });
                try { await discovery.runDue(lastFeed, { maxJobs: 3, onlyCaseIds: due, onEvent: event => onEvent(describeDiscovery(event)) }); }
                catch (error) { onEvent({ step: 'research', status: 'error', message: error.code === 'research_busy' ? 'Another research run is in progress; showing saved findings.' : 'Research failed; showing saved findings.' }); }
              }
              const findings = await discovery.findings(lastFeed);
              const { buildReportingPlan } = await import('./reporting-routes.mjs');
              result.checked = await Promise.all(shortlist.map(async id => {
                const item = lastFeed.cases.find(candidate => candidate.id === id);
                const plan = item ? await buildReportingPlan(item).catch(() => null) : null;
                return { caseId: id, finding: findings[id] || null, routes: (plan?.routes || []).slice(0, 4).map(({ title, url }) => ({ title, url })) };
              }));
              onEvent({ step: 'research', status: 'done', message: `${result.checked.filter(entry => entry.finding?.verdict === 'stale_reference').length} of ${shortlist.length} still listed by a third party` });
            }
            if (!result.error) await saveRouteCache(text, { kind: 'ask', route, ...result });
            write(result.error ? { type: 'error', message: 'The request could not be interpreted. Try rephrasing it.' } : { type: 'result', kind: 'ask', route, ...result });
          } else if (route === 'event' || route === 'find_services') {
            // Only real provider names may go to live search; fictional fixtures stay local.
            const cases = lastFeed.mode === 'live' ? lastFeed.cases.slice(0, 2000).map(item => ({ id: item.id, name: item.organization.name, locality: item.organization.locality })) : [];
            const result = await python({ eventText: text, cases, findOnly: route === 'find_services', citywide }, { onEvent });
            const { annotateRisk } = await import('./ask.mjs');
            if (result.kind) { lastServiceResult = { ...result, services: annotateRisk(result.services, lastFeed) }; if (!result.stopped) await saveRouteCache(cacheKey, { route, ...lastServiceResult }); }
            write(result.kind ? { type: 'result', route, ...lastServiceResult } : { type: 'error', message: 'The service search failed. Check the server console and provider keys.' });
          } else {
            write({ type: 'result', kind: 'unsupported', route, reason: routed.output?.reason || '' });
          }
        } catch { write({ type: 'error', message: 'The request failed. Check the server console and provider keys.' }); }
        finally { routing = false; }
        return response.end();
      }
      // ---- One actions: each runs only on an explicit click; content is built here ----
      if (path === '/api/one/status' && request.method === 'GET') return send(200, oneStatus(await oneConfig(), oneEnv));
      if (path.startsWith('/api/one/') && request.method === 'POST') {
        const body = await readJsonBody(request);
        if (Date.now() - lastOneAction < 3000) return send(429, { error: 'one_throttled' });
        const config = await oneConfig();
        const status = oneStatus(config, oneEnv);
        const run = (name, options) => runOneAction(config, name, options, { env: oneEnv, fetchImpl: oneFetch });
        const by = typeof body?.by === 'string' && /^[\p{L}\p{N} ._'-]{1,40}$/u.test(body.by) ? body.by : '';
        try {
          if (path === '/api/one/team-ticket') {
            if (!status.discord) return send(503, { error: 'one_discord_not_configured' });
            const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
            lastFeed = lastFeed || validateCaseFeed(await getCases());
            const item = lastFeed.cases.find(candidate => candidate.id === caseId);
            if (!item) return send(404, { error: 'case_not_found' });
            const finding = lastFeed.mode === 'live' ? (await discovery.findings(lastFeed))[caseId] : null;
            const note = typeof body?.note === 'string' ? body.note.slice(0, 300) : '';
            lastOneAction = Date.now();
            const channel = oneEnv.DISCORD_CHANNEL_ID;
            await run('discordMessage', { pathVariables: { channelId: channel, channel_id: channel, id: channel }, body: { content: teamTicketText({ item, finding, note, by }) } });
            return send(200, { ok: true, sent: 'discord', channel });
          }
          if (path === '/api/one/email-list' || path === '/api/one/ghost-report') {
            if (!status.gmail) return send(503, { error: 'one_gmail_not_configured' });
            if (!validEmail(body?.to)) return send(400, { error: 'invalid_email' });
            let message;
            if (path === '/api/one/email-list') {
              if (!lastServiceResult?.services?.length) return send(409, { error: 'no_service_results' });
              message = serviceListEmail({ services: lastServiceResult.services, area: lastServiceResult.searchedArea || lastServiceResult.event?.area, event: lastServiceResult.kind === 'event' ? lastServiceResult.event?.event_type : '' });
            } else {
              lastFeed = lastFeed || validateCaseFeed(await getCases());
              const decisions = await reviews.list(lastFeed.mode);
              const findings = lastFeed.mode === 'live' ? await discovery.findings(lastFeed) : {};
              message = ghostReportEmail({ decisions, findings, mode: lastFeed.mode });
            }
            lastOneAction = Date.now();
            // One's own "Send Email" action takes fields; Gmail's raw send endpoint takes an RFC 822 message.
            const gmail = config.gmailSend;
            await run('gmailSend', { pathVariables: { userId: 'me', user_id: 'me' }, body: gmail.path.endsWith('/send-email')
              ? { connectionKey: gmail.connectionKey, to: body.to, subject: message.subject, body: message.text }
              : { raw: gmailRaw({ to: body.to, ...message }) } });
            return send(200, { ok: true, sent: 'gmail', subject: message.subject });
          }
          if (path === '/api/one/text-list') {
            if (!status.sms) return send(503, { error: 'one_sms_not_configured' });
            const to = normalizePhone(body?.to);
            if (!to) return send(400, { error: 'invalid_phone' });
            if (!lastServiceResult?.services?.length) return send(409, { error: 'no_service_results' });
            const from = oneEnv.TWILIO_FROM;
            const sid = oneEnv.TWILIO_ACCOUNT_SID;
            lastOneAction = Date.now();
            await run('twilioSms', { pathVariables: { TWILIO_ACCOUNT_SID: sid, AccountSid: sid }, form: {
              To: to, ...(/^MG[0-9a-fA-F]{32}$/.test(from) ? { MessagingServiceSid: from } : { From: from }),
              Body: serviceListSms({ services: lastServiceResult.services, area: lastServiceResult.searchedArea || lastServiceResult.event?.area }) } });
            return send(200, { ok: true, sent: 'sms', to: `…${to.slice(-4)}` });
          }
          if (path === '/api/one/log-event') {
            if (!status.sheets) return send(503, { error: 'one_sheets_not_configured' });
            if (!lastServiceResult?.services) return send(409, { error: 'no_service_results' });
            const { eventRow, actionRows } = eventRows(lastServiceResult);
            const sheet = oneEnv.GHOST_LINKS_SHEET_ID;
            lastOneAction = Date.now();
            const append = (range, values) => run('sheetsAppend', { pathVariables: { spreadsheetId: sheet, spreadsheet_id: sheet, range }, query: { valueInputOption: 'USER_ENTERED' }, body: { values } });
            await append('Events!A1', [eventRow]);
            if (actionRows.length) await append('Actions!A1', actionRows);
            return send(200, { ok: true, sent: 'sheets', events: 1, actions: actionRows.length });
          }
          return send(404, { error: 'not_found' });
        } catch (error) {
          return send(error.status || 502, { error: String(error.message || 'one_action_failed').split(':')[0], platformStatus: error.platformStatus });
        }
      }
      // A labeled manual pipeline test on an identifier the user types (not a Streetli case).
      if (path === '/api/research/test' && request.method === 'POST') {
        const manual = manualTestCase(await readJsonBody(request));
        if (!manual) return send(400, { error: 'invalid_manual_test' });
        if (!research.available()) return send(503, { error: 'research_runtime_missing' });
        if (research.busy || discovery.busy) return send(429, { error: 'research_busy' });
        return research.run(response, { case: manual, manualTest: true });
      }
      // Reviewer decisions. Local notes only: they never edit Streetli or mark a correction verified.
      if (path === '/api/review-actions' && request.method === 'GET') {
        const feedNow = lastFeed || validateCaseFeed(await getCases());
        const actions = await reviews.list(feedNow.mode);
        return send(200, { mode: feedNow.mode, actions, one: oneStatus(await oneConfig(), oneEnv) });
      }
      if (path === '/api/review-actions' && request.method === 'POST') {
        const decision = parseDecision(await readJsonBody(request));
        if (!decision) return send(400, { error: 'invalid_review_decision' });
        const feedNow = lastFeed || validateCaseFeed(await getCases());
        if (!feedNow.cases.some(item => item.id === decision.caseId)) return send(404, { error: 'case_not_found' });
        const action = await reviews.set(feedNow.mode, decision.caseId, decision.decision, decision.note, decision.by);
        return send(200, { caseId: decision.caseId, action });
      }
      // Event check: which services near an event can still help, from public sources.
      if (path === '/api/event-check' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        if (text.length < 8 || text.length > 300 || /[\u0000-\u001f]/.test(text)) return send(400, { error: 'invalid_event_text' });
        if (!research.available()) return send(503, { error: 'research_runtime_missing' });
        if (research.busy) return send(429, { error: 'research_busy' });
        // Only real provider names may go to live search; fictional fixtures stay local.
        const feedNow = lastFeed || validateCaseFeed(await getCases());
        const cases = feedNow.mode === 'live'
          ? feedNow.cases.slice(0, 2000).map(item => ({ id: item.id, name: item.organization.name, locality: item.organization.locality }))
          : [];
        return research.run(response, { eventText: text, cases });
      }
      if (request.method !== 'GET') { response.setHeader('Allow', path === '/api/refresh' ? 'POST' : 'GET'); return send(405, { error: 'read_only_case_api' }); }
      if (Object.hasOwn(assetNames, path)) {
        const content = await readFile(new URL(`../web/${assetNames[path]}`, import.meta.url));
        response.setHeader('Content-Type', contentTypes[path]); response.writeHead(200); return response.end(content);
      }
      return send(404, { error: 'not_found' });
    } catch (error) {
      return send(error.status || 503, { error: ['case_source_unavailable', 'case_source_unauthorized', 'case_source_invalid_response', 'case_source_too_large', 'invalid_request', 'request_too_large'].includes(error.code) ? error.code : 'case_data_unavailable', mode });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await loadLocalEnv();
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  const sourceUrl = process.env.STREETLI_CASES_MODE === 'fixture' ? '' : process.env.STREETLI_CASES_URL?.trim() || PUBLIC_CASES_URL;
  const live = Boolean(sourceUrl);
  // HOST=0.0.0.0 (the container default) is the hosted backend and requires a backend token.
  const listenHost = process.env.HOST?.trim() || '127.0.0.1';
  const backendToken = process.env.RESEARCH_BACKEND_TOKEN?.trim() || '';
  if (backendToken && !BACKEND_TOKEN.test(backendToken)) throw new Error('RESEARCH_BACKEND_TOKEN must match ^[A-Za-z0-9_-]{32,256}$.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(listenHost) && !backendToken) throw new Error(`Refusing to listen on ${listenHost} without RESEARCH_BACKEND_TOKEN.`);
  const server = await createFixtureServer({ sourceUrl, token: process.env.STREETLI_CASES_TOKEN || '', backendToken });
  server.listen(port, listenHost, () => console.log(`Ghost Links ${backendToken ? 'research backend' : 'dev app'}: http://${listenHost}:${port} (${sourceUrl === PUBLIC_CASES_URL ? 'shared live case feed' : live ? 'custom live case feed' : 'fictional fixtures'})`));
  server.on('error', error => { console.error(error.code || 'dev_server_failed'); process.exitCode = 1; });
}
