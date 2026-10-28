import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateSelection, validateVerification, validateCorrection } from '../packages/contracts/research-output.mjs';

export async function loadEvaluationSet() {
  return JSON.parse(await readFile(new URL('../prompts/evaluations.json', import.meta.url), 'utf8'));
}

export function evaluationInput(suite, item) {
  const record = structuredClone(suite.case);
  if (item.reviewState) record.reviewState = item.reviewState;
  if (item.stage === 'select-case') return {request: item.request, mode: item.feedMode, cases: [record], now: suite.now};
  return {case: record, documents: item.documentIds.map(id => suite.documents[id]), now: suite.now,
    ...(item.stage === 'prepare-correction' ? {verification: suite.referenceVerification, routes: item.routes} : {})};
}

export function scoreEvaluationOutputs(suite, predictions) {
  if (!Array.isArray(predictions) || predictions.length > suite.tests.length) throw new TypeError('Expected one bounded array of {id,output} predictions.');
  const byId = new Map();
  const knownIds = new Set(suite.tests.map(item => item.id));
  for (const prediction of predictions) {
    if (!prediction || !knownIds.has(prediction.id) || byId.has(prediction.id)) throw new TypeError('Unknown or duplicate evaluation ID.');
    byId.set(prediction.id, prediction.output);
  }
  const gates = {'select-case': validateSelection, 'verify-reference': validateVerification, 'prepare-correction': validateCorrection};
  const results = suite.tests.map(item => {
    if (!byId.has(item.id)) return {id: item.id, status: 'missing'};
    const output = byId.get(item.id);
    try {
      gates[item.stage](output, evaluationInput(suite, item));
      const matches = Object.entries(item.expected).every(([key, value]) => JSON.stringify(output[key]) === JSON.stringify(value));
      return {id: item.id, status: matches ? 'pass' : 'expected_decision_mismatch'};
    } catch { return {id: item.id, status: 'evidence_or_output_gate_failed'}; }
  });
  return {total: results.length, supplied: predictions.length, passed: results.filter(item => item.status === 'pass').length, results,
    limitation: 'Decision labels and output/evidence gates only. Human review is still needed for semantic support and draft quality.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const suite = await loadEvaluationSet();
  const outputPath = process.argv[2];
  if (!outputPath || process.argv.length !== 3) {
    console.log(JSON.stringify({status: 'not_model_evaluated', cases: suite.tests.length, usage: 'node scripts/evaluate-prompts.mjs <ignored-local-predictions.json>',
      format: '[{"id":"stale-directory","output":{...}}]', note: 'No model call or network request is made. Supply actual model outputs to score them.'}, null, 2));
  } else {
    const predictions = JSON.parse(await readFile(outputPath, 'utf8'));
    const score = scoreEvaluationOutputs(suite, predictions);
    console.log(JSON.stringify(score, null, 2));
    if (score.passed !== score.total) process.exitCode = 1;
  }
}
