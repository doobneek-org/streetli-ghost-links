import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCaseFeed } from '../../packages/contracts/cases.mjs';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const contentTypes = { '/': 'text/html; charset=utf-8', '/app.js': 'text/javascript; charset=utf-8', '/styles.css': 'text/css; charset=utf-8' };
const assetNames = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
const safeError = (code, status = 503) => Object.assign(new Error(code), { code, status });

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

export function createLiveSource({ sourceUrl, token, fetchImpl = fetch, ttlMs = 300000 } = {}) {
  let url;
  try { url = new URL(sourceUrl); } catch { throw safeError('invalid_case_source_config', 500); }
  if (!token || token.length < 24 || url.username || url.password || url.search || url.hash
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
      try { response = await fetchImpl(endpoint, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(120000) }); }
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

export async function createFixtureServer({ sourceUrl = '', token = '', fetchImpl = fetch, source = null } = {}) {
  const fixture = validateCaseFeed(JSON.parse(await readFile(new URL('../../fixtures/cases.demo.json', import.meta.url), 'utf8')));
  const mode = source || sourceUrl ? 'live' : 'fixture';
  const getCases = source || (sourceUrl ? createLiveSource({ sourceUrl, token, fetchImpl }) : async () => fixture);
  let lastFeed = null;
  let lastRefreshStarted = 0;
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, body) => { response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.writeHead(status); response.end(JSON.stringify(body)); };
    const host = String(request.headers.host || '');
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) return send(403, { error: 'local_dev_only' });
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return send(403, { error: 'cross_origin_request_rejected' });
    if (request.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'cross_origin_request_rejected' });
    let path;
    try { path = new URL(request.url, `http://${host}`).pathname; } catch { return send(400, { error: 'invalid_request' }); }
    try {
      if (path === '/health' && request.method === 'GET') return send(200, { ok: true, mode, liveResearchImplemented: false, caseCount: lastFeed?.cases.length ?? null, generatedAt: lastFeed?.generatedAt ?? null });
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
      if (path === '/api/refresh' && request.method === 'POST') {
        if (Date.now() - lastRefreshStarted < 10000) return send(429, { error: 'refresh_throttled' });
        lastRefreshStarted = Date.now();
        lastFeed = validateCaseFeed(await getCases({ refresh: true }));
        return send(200, lastFeed);
      }
      if (request.method !== 'GET') { response.setHeader('Allow', path === '/api/refresh' ? 'POST' : 'GET'); return send(405, { error: 'read_only_case_api' }); }
      if (Object.hasOwn(assetNames, path)) {
        const content = await readFile(new URL(`../web/${assetNames[path]}`, import.meta.url));
        response.setHeader('Content-Type', contentTypes[path]); response.writeHead(200); return response.end(content);
      }
      return send(404, { error: 'not_found' });
    } catch (error) {
      return send(error.status || 503, { error: ['case_source_unavailable', 'case_source_unauthorized', 'case_source_invalid_response', 'case_source_too_large'].includes(error.code) ? error.code : 'case_data_unavailable', mode });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await loadLocalEnv();
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  const live = Boolean(process.env.STREETLI_CASES_URL);
  const server = await createFixtureServer({ sourceUrl: process.env.STREETLI_CASES_URL || '', token: process.env.STREETLI_CASES_TOKEN || '' });
  server.listen(port, '127.0.0.1', () => console.log(`Ghost Links dev app: http://127.0.0.1:${port} (${live ? 'live private case feed' : 'fictional fixtures'})`));
  server.on('error', error => { console.error(error.code || 'dev_server_failed'); process.exitCode = 1; });
}
