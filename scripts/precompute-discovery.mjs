// Plan from the live source automatically. This does not call paid providers.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadLocalEnv, createLiveSource } from '../apps/agent/fixture-server.mjs';
import { buildDiscoveryPlan } from '../packages/contracts/discovery-plan.mjs';

const args = process.argv.slice(2);
if (args.some(value => value !== '--watch') || args.length > 1) throw new Error('Use npm run precompute [-- --watch].');
await loadLocalEnv();
if (!process.env.STREETLI_CASES_URL) throw new Error('Configure the live STREETLI_CASES_URL and server-only token first.');
const getCases = createLiveSource({ sourceUrl: process.env.STREETLI_CASES_URL, token: process.env.STREETLI_CASES_TOKEN });
const directory = resolve('data');
const outputPath = resolve(directory, 'discovery-plan.json');

async function previousResults() {
  let text;
  try { text = await readFile(resolve(directory, 'discovery-results.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw new Error('discovery_results_unavailable'); }
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('discovery_results_too_large');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('discovery_results_invalid'); }
  if (!Array.isArray(parsed)) throw new Error('discovery_results_invalid');
  return parsed;
}

async function precompute() {
  const feed = await getCases();
  const plan = buildDiscoveryPlan(feed, { previousResults: await previousResults() });
  await mkdir(directory, { recursive: true });
  const temporaryPath = resolve(directory, `discovery-plan.${process.pid}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  await rename(temporaryPath, outputPath);
  // Logs contain counts only, never source credentials, identifiers or queries.
  console.log(JSON.stringify({ generatedAt: plan.generatedAt, baselineCases: feed.cases.length,
    eligibleCases: plan.eligibleCaseIds.length, plannedJobs: plan.jobs.length, skipped: plan.skipped,
    skippedCases: plan.skippedCases, providerRequests: 0 }));
}

do {
  try { await precompute(); }
  catch { console.error('Discovery precomputation failed; the last saved plan is unchanged. Check the live source and local results.'); if (!args.includes('--watch')) process.exitCode = 1; }
  if (!args.includes('--watch')) break;
  await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
} while (true);
