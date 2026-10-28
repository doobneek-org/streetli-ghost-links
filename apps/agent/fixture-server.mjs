import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateCaseFeed } from '../../packages/contracts/cases.mjs';

export async function createFixtureServer() {
  const fixture = validateCaseFeed(JSON.parse(await readFile(new URL('../../fixtures/cases.demo.json', import.meta.url), 'utf8')));
  if (fixture.mode !== 'fixture') throw new Error('This development server only serves fictional fixtures.');
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return send(405, { error: 'read_only_fixture_api' }); }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/api/cases') return send(200, fixture);
    if (path === '/health') return send(200, { ok: true, mode: 'fixture', liveResearchImplemented: false });
    if (path === '/') return send(200, { project: 'Ghost Links collaboration starter', mode: 'fixture', cases: '/api/cases', health: '/health', status: 'Frontend, live Streetli adapter, and sponsor integrations are not implemented yet.' });
    return send(404, { error: 'not_found' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  const server = await createFixtureServer();
  server.listen(port, '127.0.0.1', () => console.log(`Fictional fixture API: http://127.0.0.1:${port}/api/cases`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
