// Discovery worker: runs jobs from Ivan's planner through the Python research
// runtime, re-checks every model output with validateVerification, and keeps:
//   data/discovery-results.json  receipts in the planner's format (cache + backoff)
//   data/discovery-findings.json validated findings per case, for the dashboard
// Findings are research leads with cited evidence. Nothing here sends a report,
// edits Streetli, or changes a case's review state.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiscoveryPlan } from '../../packages/contracts/discovery-plan.mjs';
import { validateVerification } from '../../packages/contracts/research-output.mjs';

const AGENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PYTHON = fileURLToPath(new URL('./.venv/bin/python', import.meta.url));
const DATA = fileURLToPath(new URL('../../data/', import.meta.url));
const JOB_TIMEOUT_MS = 180000;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 1), { mode: 0o600 });
  await rename(temporary, path);
}

// Runs the Python CLI once with a JSON payload; resolves with its result line.
export function runPython(payload, { onEvent = () => {}, python = PYTHON, cwd = AGENT_DIR, spawnImpl = spawn, timeoutMs = JOB_TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    const child = spawnImpl(python, ['-m', 'research.run', '--stdin', '--jsonl'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = ''; let result = null; let done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ status: 'error', error: 'timeout' }); }, timeoutMs);
    child.on('error', () => finish({ status: 'error', error: 'runtime_unavailable' }));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'event') onEvent(parsed);
          if (parsed.type === 'result') result = parsed;
        } catch { /* ignore library output */ }
      }
    });
    child.stderr.on('data', () => {});
    child.on('close', () => finish(result || { status: 'error', error: 'no_result' }));
    child.stdin.end(JSON.stringify(payload));
  });
}

export function createDiscoveryRunner({ dataDir = DATA, run = runPython, available = () => existsSync(PYTHON), now = () => new Date() } = {}) {
  const resultsPath = `${dataDir}discovery-results.json`;
  const findingsPath = `${dataDir}discovery-findings.json`;
  let running = false;

  async function record(job, outcome, cases) {
    const receipts = await readJson(resultsPath, []);
    const prior = receipts.filter(item => item.binding === job.binding).at(-1);
    const at = now().toISOString().replace(/\.\d+Z$/, 'Z');
    const receipt = outcome.status === 'completed'
      ? { binding: job.binding, status: 'completed', checkedAt: outcome.checkedAt || at }
      : { binding: job.binding, status: 'error', checkedAt: at, attemptedAt: at, attempts: (prior?.attempts || 0) + 1 };
    // Keep the newest receipt per binding, bounded.
    await writeJson(resultsPath, [...receipts.filter(item => item.binding !== job.binding), receipt].slice(-2000));
    if (outcome.status !== 'completed') return [];
    const findings = await readJson(findingsPath, {});
    const saved = [];
    for (const verification of outcome.verifications || []) {
      const item = cases.find(candidate => candidate.id === verification.caseId);
      if (!item) continue;
      let finding;
      if (verification.error || !verification.output) finding = { verdict: 'error', gate: 'model_failed' };
      else {
        try {
          validateVerification(verification.output, { case: item, documents: outcome.documents, now: Date.parse(outcome.checkedAt) });
          const urls = Object.fromEntries(outcome.documents.map(document => [document.id, document.url]));
          finding = { ...verification.output, gate: 'passed',
            evidence: verification.output.evidence.map(evidence => ({ ...evidence, url: urls[evidence.documentId] })) };
        } catch (error) {
          // Unbound quotes or stale sources: keep only the failure, never the claim.
          finding = { verdict: 'uncertain', gate: `rejected:${String(error.message).replace(/^.*: /, '')}`, evidence: [], missingEvidence: [], summary: 'The model output failed the evidence gate and was discarded.' };
        }
      }
      findings[item.id] = { ...finding, caseId: item.id, jobId: job.id, checkedAt: outcome.checkedAt,
        pages: outcome.documents.filter(document => document.status === 'fetched').length };
      saved.push(findings[item.id]);
    }
    await writeJson(findingsPath, findings);
    return saved;
  }

  return {
    get busy() { return running; },
    available,
    findings: () => readJson(findingsPath, {}),
    async plan(feed, options = {}) {
      return buildDiscoveryPlan(feed, { previousResults: await readJson(resultsPath, []), now: now().getTime(), ...options });
    },
    // Runs up to maxJobs due jobs sequentially. onEvent receives progress lines.
    async runDue(feed, { maxJobs = 3, onlyCaseIds = null, onEvent = () => {} } = {}) {
      if (running) throw Object.assign(new Error('research_busy'), { code: 'research_busy', status: 429 });
      running = true;
      try {
        let plan = await this.plan(feed, { maxJobs: onlyCaseIds ? 100 : maxJobs });
        let jobs = plan.jobs;
        if (onlyCaseIds) jobs = jobs.filter(job => job.caseIds.some(id => onlyCaseIds.includes(id)));
        jobs = jobs.slice(0, maxJobs);
        onEvent({ type: 'plan', eligible: plan.eligibleCaseIds.length, due: plan.jobs.length, running: jobs.length, skipped: plan.skipped });
        const saved = [];
        for (const [index, job] of jobs.entries()) {
          onEvent({ type: 'job', index: index + 1, total: jobs.length, kind: job.kind, caseIds: job.caseIds });
          const cases = feed.cases.filter(item => job.caseIds.includes(item.id));
          const outcome = await run({ discoveryJob: job, cases }, { onEvent });
          const findings = await record(job, outcome, cases);
          onEvent({ type: 'job_done', index: index + 1, status: outcome.status, findings });
          saved.push(...findings);
        }
        return { plan: { eligible: plan.eligibleCaseIds.length, due: plan.jobs.length, ran: jobs.length, skipped: plan.skipped }, findings: saved };
      } finally { running = false; }
    }
  };
}
