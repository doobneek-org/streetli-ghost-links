// Runs the Python research flow (apps/agent/research) for one case and streams its
// progress to the browser as NDJSON: {"type":"event",...} lines, then one
// {"type":"result",...} or {"type":"error",...}. Nothing here sends reports.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AGENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PYTHON = fileURLToPath(new URL('./.venv/bin/python', import.meta.url));
const TIMEOUT_MS = 180000;
const MAX_LINE = 256 * 1024;
const KINDS = ['website', 'phone', 'email'];

const bounded = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;

// A manual pipeline test runs on an identifier the user types. It is not a Streetli
// case: the Python flow labels it and marks its drafts testOnly.
export function manualTestCase(body) {
  const kind = KINDS.includes(body?.kind) ? body.kind : null;
  const value = bounded(body?.value, 300);
  const name = bounded(body?.organization, 200);
  const locality = typeof body?.locality === 'string' && body.locality.length <= 160 ? body.locality.trim() : null;
  if (!kind || !value || !name || locality === null) return null;
  return {
    id: 'manual-test', organization: { name, locality }, identifier: { kind, value },
    internal: { state: 'removed', reasonCode: 'manual_test', correctedAt: null },
    replacement: null, reviewState: 'manual_test'
  };
}

export function createResearchRunner({ python = PYTHON, cwd = AGENT_DIR, spawnImpl = spawn, timeoutMs = TIMEOUT_MS } = {}) {
  let running = false;
  return {
    get busy() { return running; },
    available: () => existsSync(python),
    // Writes a complete streamed response. The caller has already validated the case.
    run(response, payload) {
      running = true;
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      response.writeHead(200);
      const write = line => { if (!response.writableEnded) response.write(`${JSON.stringify(line)}\n`); };
      const child = spawnImpl(python, ['-m', 'research.run', '--stdin', '--jsonl'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '';
      let finished = false;
      const finish = error => {
        if (finished) return;
        finished = true; running = false; clearTimeout(timer);
        if (error) write({ type: 'error', message: error });
        response.end();
      };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish('Research timed out; results so far are incomplete.'); }, timeoutMs);
      response.on('close', () => { if (!finished) { child.kill('SIGTERM'); finish(); } });
      child.on('error', () => finish('The research runtime could not start.'));
      child.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.length > MAX_LINE) { child.kill('SIGTERM'); return finish('Research output was too large.'); }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (!line.startsWith('{')) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'event' || parsed.type === 'result') write(parsed);
            if (parsed.type === 'result') finish();
          } catch { /* ignore non-JSON library output */ }
        }
      });
      // Library warnings go to stderr. They stay in the server console, never the browser.
      let stderr = '';
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
      child.on('close', code => {
        if (code !== 0 && !finished) console.error(`research exited with ${code}:\n${stderr.split('\n').filter(line => !/approximate input token/.test(line)).join('\n').trim()}`);
        finish(code === 0 ? 'Research ended without a result.' : 'Research failed. Check the server console and provider keys.');
      });
      child.stdin.end(JSON.stringify(payload));
    }
  };
}
