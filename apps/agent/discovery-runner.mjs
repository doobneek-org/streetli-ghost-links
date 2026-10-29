// Discovery worker: runs jobs from Ivan's planner through the Python research
// runtime, re-checks every model output with validateVerification, and keeps:
//   data/discovery-results.json  receipts in the planner's format (cache + backoff)
//   data/discovery-findings.json validated findings per case, for the dashboard
// Findings are research leads with cited evidence. Nothing here sends a report,
// edits Streetli, or changes a case's review state.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiscoveryPlan, normalizeDiscoveryIdentifier } from '../../packages/contracts/discovery-plan.mjs';
import { validateVerification } from '../../packages/contracts/research-output.mjs';
import { resolveResearchPython, researchPythonAvailable } from './python-runtime.mjs';

const AGENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const DATA = fileURLToPath(new URL('../../data/', import.meta.url));
const JOB_TIMEOUT_MS = 180000;
const FINDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STAGES = new Set(['route-request', 'plan-request', 'select-case', 'verify-reference', 'draft-correction']);
const EXCEPTION_CLASSES = new Set(['ValueError', 'TypeError', 'KeyError', 'RuntimeError', 'ValidationError', 'JSONDecodeError',
  'ImportError', 'ModuleNotFoundError', 'AttributeError', 'AuthenticationError', 'PermissionDeniedError', 'RateLimitError',
  'LLMRateLimitError', 'APITimeoutError', 'LLMTimeoutError', 'APIConnectionError', 'BadRequestError', 'InternalServerError', 'TimeoutError', 'ConnectionError', 'HTTPStatusError']);
const FAILURE_REASONS = new Set(['timeout', 'runtime_unavailable', 'no_result', 'model_exception', 'process_exit', 'stage_exception', 'invalid_stage_output']);

// Operator diagnostics contain fixed categories and exception class names only.
// Never include stderr, model output, stage input, identifiers or error messages.
export function reportResearchFailure({ operation = 'stage', stage, reason, exceptionClass, elapsedMs, exitCode, signal } = {},
  diagnostic = record => console.error(JSON.stringify(record))) {
  const record = { severity: 'ERROR', event: 'ghost_links_research_failure',
    operation: ['stage', 'discovery', 'event', 'case'].includes(operation) ? operation : 'unknown',
    ...(operation === 'stage' ? { stage: STAGES.has(stage) ? stage : 'unknown' } : {}),
    reason: FAILURE_REASONS.has(reason) ? reason : 'model_exception',
    ...(exceptionClass ? { exceptionClass: EXCEPTION_CLASSES.has(exceptionClass) ? exceptionClass : 'UnknownException' } : {}),
    ...(Number.isFinite(elapsedMs) ? { elapsedMs: Math.max(0, Math.round(elapsedMs)) } : {}),
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
    ...(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV'].includes(signal) ? { signal } : {}) };
  try { diagnostic(record); } catch { /* Logging must not change the research result. */ }
}

function identifierGroups(cases) {
  const groups=new Map();
  for (const item of cases) {
    const identifier=normalizeDiscoveryIdentifier(item.identifier);
    if (!identifier) continue;
    const key=JSON.stringify(identifier);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(item);
  }
  return [...groups.values()];
}

function currentCaseBindings(feed, time) {
  if (feed.mode !== 'live') return new Map();
  const groups=identifierGroups(feed.cases);
  const bindings=new Map();
  // Chunk whole identifier groups so every branch participates in its source
  // binding, including groups beyond the planner's per-batch 100-job limit.
  for(let start=0;start<groups.length;start+=100) {
    const cases=groups.slice(start,start+100).flat();
    const plan=buildDiscoveryPlan({...feed,cases},{now:time,maxJobs:100});
    for(const job of plan.jobs) for(const id of job.caseIds) bindings.set(id,job.binding);
  }
  return bindings;
}

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
export function runPython(payload, { onEvent = () => {}, python = resolveResearchPython(), cwd = AGENT_DIR, spawnImpl = spawn, timeoutMs = JOB_TIMEOUT_MS,
  onDiagnostic } = {}) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const context = payload?.stage ? { operation: 'stage', stage: payload.stage }
      : { operation: payload?.discoveryJob ? 'discovery' : payload?.eventText ? 'event' : 'case' };
    let child, timer, buffer = '', result = null, done = false, stderrTail = '';
    const finish = (value, details = {}) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (value?.error || value?.status === 'error') reportResearchFailure({ ...context,
        reason: ['timeout', 'runtime_unavailable', 'no_result'].includes(value.error) ? value.error : 'model_exception',
        ...(EXCEPTION_CLASSES.has(value.error) ? { exceptionClass: value.error } : {}), elapsedMs: Date.now() - startedAt, ...details }, onDiagnostic);
      resolve(value);
    };
    const parseLine = line => {
      line = line.trim();
      if (!line.startsWith('{')) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'event') onEvent(parsed);
        if (parsed.type === 'result') result = parsed;
      } catch { /* Ignore library output, never copy it to diagnostics. */ }
    };
    try { child = spawnImpl(python, ['-m', 'research.run', '--stdin', '--jsonl'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { finish({ status: 'error', error: 'runtime_unavailable' }); return; }
    timer = setTimeout(() => {
      // Resolve first: kill may synchronously emit close in process stubs, or race a real exit.
      finish({ status: 'error', error: 'timeout' });
      try { child.kill('SIGTERM'); } catch { /* The child may already have exited. */ }
    }, timeoutMs);
    child.on('error', () => finish({ status: 'error', error: 'runtime_unavailable' }));
    child.stdout.on('data', chunk => {
      if (done) return;
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        parseLine(line);
      }
    });
    child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString('utf8')).slice(-8192); });
    child.on('close', (exitCode, signal) => {
      if (done) return;
      if (buffer.trim()) parseLine(buffer);
      // Extract only a recognized Python traceback class, discarding its message.
      const exceptionClass = stderrTail.split(/\r?\n/).map(line => /^([A-Za-z]+(?:Error|Exception))(?::|$)/.exec(line)?.[1])
        .filter(name => EXCEPTION_CLASSES.has(name)).at(-1);
      finish(result || { status: 'error', error: 'no_result' }, { exitCode, signal, ...(exceptionClass ? { exceptionClass } : {}) });
    });
    child.stdin.on?.('error', () => finish({ status: 'error', error: 'runtime_unavailable' }));
    try { child.stdin.end(JSON.stringify(payload)); } catch { finish({ status: 'error', error: 'runtime_unavailable' }); }
  });
}

export function createDiscoveryRunner({ dataDir = DATA, run = runPython, available = researchPythonAvailable, now = () => new Date() } = {}) {
  const resultsPath = `${dataDir}discovery-results.json`;
  const findingsPath = `${dataDir}discovery-findings.json`;
  let running = false;

  async function record(job, outcome, cases) {
    const receipts = await readJson(resultsPath, []);
    const prior = receipts.filter(item => item.binding === job.binding).at(-1);
    const at = now().toISOString().replace(/\.\d+Z$/, 'Z');
    const findings = await readJson(findingsPath, {});
    const saved = [];
    const verifications = Array.isArray(outcome?.verifications) ? outcome.verifications : [];
    const checkedAt = Number.isFinite(Date.parse(outcome?.checkedAt)) && Date.parse(outcome.checkedAt) <= Date.parse(at)
      ? outcome.checkedAt : at;
    let complete = outcome?.status === 'completed' && cases.length > 0;
    for (const item of cases) {
      const candidates = verifications.filter(candidate => candidate?.caseId === item.id);
      const verification = candidates.length === 1 ? candidates[0] : null;
      let finding;
      if (outcome?.status !== 'completed' || verification?.error || !verification?.output) finding = {
        verdict: 'error', gate: 'model_failed', evidence: [], missingEvidence: [],
        summary: 'The model did not return a usable verification. No new claim was kept; retry after the short backoff.'
      };
      else {
        try {
          validateVerification(verification.output, { case: item, documents: outcome.documents, now: Date.parse(outcome.checkedAt) });
          const urls = Object.fromEntries(outcome.documents.map(document => [document.id, document.url]));
          finding = { ...verification.output, gate: 'passed',
            evidence: verification.output.evidence.map(evidence => ({ ...evidence, url: urls[evidence.documentId] })) };
        } catch (error) {
          // Only a fixed validator code survives; the rejected output is never returned.
          const reason = /^Invalid research output: ([a-z_]{1,60})$/.exec(String(error.message))?.[1] || 'invalid_output';
          finding = { verdict: 'uncertain', gate: `rejected:${reason}`, evidence: [], missingEvidence: [],
            summary: reason === 'unbound_quote'
              ? 'The model quoted text that was not found verbatim in the fetched page. No claim was kept; retry after the short backoff.'
              : 'The model output failed the evidence checks. No claim was kept; retry after the short backoff.' };
        }
      }
      const previous = findings[item.id];
      const previousAt = Date.parse(previous?.checkedAt || '');
      const keptPrevious = finding.gate !== 'passed' && previous?.gate === 'passed' && previous.caseId === item.id
        && previous.binding === job.binding && Number.isFinite(previousAt) && previousAt <= Date.parse(at)
        && Date.parse(at) - previousAt < FINDING_MAX_AGE_MS;
      if (finding.gate !== 'passed') complete = false;
      findings[item.id] = keptPrevious
        ? { ...previous, lastAttempt: { checkedAt: at, gate: finding.gate, keptPrevious: true } }
        : { ...finding, caseId: item.id, jobId: job.id, binding: job.binding, checkedAt,
          pages: Array.isArray(outcome?.documents) ? outcome.documents.filter(document => document.status === 'fetched').length : 0 };
      saved.push(findings[item.id]);
    }
    // A process finishing is not a successful evidence check. Any missing or rejected
    // verification uses the planner's short error backoff, never its 24-hour cache.
    const receipt = complete
      ? { binding: job.binding, status: 'completed', checkedAt }
      : { binding: job.binding, status: 'error', checkedAt: at, attemptedAt: at, attempts: (prior?.attempts || 0) + 1 };
    await writeJson(resultsPath, [...receipts.filter(item => item.binding !== job.binding), receipt].slice(-2000));
    await writeJson(findingsPath, findings);
    return { findings: saved, status: receipt.status };
  }

  return {
    get busy() { return running; },
    available,
    async findings(feed) {
      const saved=await readJson(findingsPath, {});
      if (!feed) return saved;
      const time=now().getTime();
      const bindings=currentCaseBindings(feed,time);
      return Object.fromEntries(Object.entries(saved).filter(([id,finding])=> {
        const checked=Date.parse(finding.checkedAt || '');
        return finding.binding === bindings.get(id) && bindings.has(id)
          && Number.isFinite(checked) && checked <= time && time-checked < FINDING_MAX_AGE_MS;
      }));
    },
    async plan(feed, options = {}) {
      const time = now().getTime();
      const [receipts, saved] = await Promise.all([readJson(resultsPath, []), readJson(findingsPath, {})]);
      const idsByBinding = new Map();
      for (const [id, binding] of currentCaseBindings(feed, time)) {
        if (!idsByBinding.has(binding)) idsByBinding.set(binding, []);
        idsByBinding.get(binding).push(id);
      }
      // Older runtimes marked a finished model process completed even after its
      // output was rejected. Correct that planner input without rewriting history
      // or starting a paid retry. The original attempt time still controls backoff.
      const previousResults = receipts.map(receipt => {
        const ids = idsByBinding.get(receipt?.binding);
        const failed = ids?.some(id => {
          const finding = saved[id], checkedAt = Date.parse(finding?.checkedAt || '');
          return finding?.binding !== receipt.binding || finding?.gate !== 'passed'
            || !Number.isFinite(checkedAt) || checkedAt > time || time - checkedAt >= FINDING_MAX_AGE_MS;
        });
        return receipt?.status === 'completed' && failed
          ? { ...receipt, status: 'error', attemptedAt: receipt.checkedAt, attempts: 1 }
          : receipt;
      });
      return buildDiscoveryPlan(feed, { previousResults, now: time, ...options });
    },
    // Runs up to maxJobs due jobs sequentially. onEvent receives progress lines.
    async runDue(feed, { maxJobs = 3, onlyCaseIds = null, onEvent = () => {} } = {}) {
      if (running) throw Object.assign(new Error('research_busy'), { code: 'research_busy', status: 429 });
      running = true;
      try {
        const selectedIds=onlyCaseIds ? new Set(onlyCaseIds) : null;
        const planningFeed=selectedIds ? {...feed,cases:identifierGroups(feed.cases)
          .filter(group=>group.some(item=>selectedIds.has(item.id))).flat()} : feed;
        // Target the complete identifier group before applying the batch cap.
        // Filtering a capped global plan would silently lose later case IDs.
        let plan = await this.plan(planningFeed, { maxJobs });
        let jobs = plan.jobs;
        if (onlyCaseIds) jobs = jobs.filter(job => job.caseIds.some(id => onlyCaseIds.includes(id)));
        jobs = jobs.slice(0, maxJobs);
        onEvent({ type: 'plan', eligible: plan.eligibleCaseIds.length, due: plan.jobs.length, running: jobs.length, skipped: plan.skipped });
        const saved = [];
        for (const [index, job] of jobs.entries()) {
          onEvent({ type: 'job', index: index + 1, total: jobs.length, kind: job.kind, caseIds: job.caseIds });
          const cases = feed.cases.filter(item => job.caseIds.includes(item.id));
          const outcome = await run({ discoveryJob: job, cases }, { onEvent });
          const recorded = await record(job, outcome, cases);
          onEvent({ type: 'job_done', index: index + 1, status: recorded.status, findings: recorded.findings });
          saved.push(...recorded.findings);
        }
        return { plan: { eligible: plan.eligibleCaseIds.length, due: plan.jobs.length, ran: jobs.length, skipped: plan.skipped }, findings: saved };
      } finally { running = false; }
    }
  };
}
