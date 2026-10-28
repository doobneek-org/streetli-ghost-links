import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSelection, validateVerification, validateCorrection } from '../packages/contracts/research-output.mjs';
import { loadEvaluationSet, evaluationInput, scoreEvaluationOutputs } from '../scripts/evaluate-prompts.mjs';

const suite = await loadEvaluationSet();
const context = evaluationInput(suite, suite.tests.find(item => item.id === 'stale-directory'));
const selection = () => ({intent: 'verify_external', kinds: ['website'], states: ['removed'], locality: 'Brooklyn', caseIds: [suite.case.id], question: null, explanation: 'Check the approved exact historical website case.'});
const draft = () => ({caseId: suite.case.id, disposition: 'draft_ready', routeId: 'directory', subject: 'Please review a former website association', body: 'Please review the website association on the checked listing using the cited current provider evidence.', evidenceDocumentIds: ['listing', 'official'], needsHumanApproval: true, missingEvidence: []});

test('request plans cannot invent cases, ignore type filters, or bypass owner approval', () => {
  const input = {cases: [suite.case], mode: 'live'};
  validateSelection(selection(), input);
  assert.throws(() => validateSelection({...selection(), caseIds: ['invented']}, input), /unknown_case/);
  assert.throws(() => validateSelection({...selection(), kinds: ['phone']}, input), /wrong_kind/);
  assert.throws(() => validateSelection(selection(), {...input, mode: 'fixture'}), /research_not_approved/);
  assert.throws(() => validateSelection(selection(), {mode: 'live', cases: [{...suite.case, reviewState: 'review_required'}]}), /research_not_approved/);
});

test('verified stale claims require literal current association, identity and contradiction', () => {
  validateVerification(suite.referenceVerification, context);
  const invented = structuredClone(suite.referenceVerification); invented.evidence[0].quote = 'The model invented this evidence.';
  assert.throws(() => validateVerification(invented, context), /unbound_quote/);
  const weak = structuredClone(suite.referenceVerification); weak.evidence = weak.evidence.filter(item => item.role !== 'contradiction');
  assert.throws(() => validateVerification(weak, context), /missing_stale_reference_evidence/);
  const staleContext = structuredClone(context); staleContext.documents[0].status = 'snippet';
  assert.throws(() => validateVerification(suite.referenceVerification, staleContext), /unverified_source/);
  const oldContext = structuredClone(context); oldContext.documents[0].observedAt = '2026-10-20T18:00:00Z';
  assert.throws(() => validateVerification(suite.referenceVerification, oldContext), /unverified_source/);
});

test('empty search or unavailable page cannot become checked absence or global correction', () => {
  const output = {caseId: suite.case.id, verdict: 'not_present', evidence: [], missingEvidence: [], summary: 'The old identifier was not present on this checked page.'};
  assert.throws(() => validateVerification(output, {...context, documents: []}), /no_checked_page/);
  assert.throws(() => validateVerification({...output, verdict: 'uncertain'}, context), /uncertainty_needs_missing_evidence/);
  validateVerification({...output, verdict: 'uncertain', missingEvidence: ['A current fetched listing page.']}, {...context, documents: []});
});

test('correction gate preserves reviewer approval and rejects unsupported registrar escalation', () => {
  const input = evaluationInput(suite, suite.tests.find(item => item.id === 'correct-association-first'));
  validateCorrection(draft(), input);
  assert.throws(() => validateCorrection({...draft(), needsHumanApproval: false}, input), /invalid_correction/);
  assert.throws(() => validateCorrection({...draft(), routeId: 'registrar'}, input), /policy_basis_not_confirmed/);
  assert.throws(() => validateCorrection({...draft(), routeId: 'invented'}, input), /draft_not_supported/);
  assert.throws(() => validateCorrection({...draft(), evidenceDocumentIds: ['invented']}, input), /unknown_evidence/);
});

test('evaluation runner reports missing cases and mismatches, not invented model-quality success', () => {
  const pending = scoreEvaluationOutputs(suite, []);
  assert.equal(pending.passed, 0); assert.equal(pending.supplied, 0); assert.equal(pending.total, 11);
  const scored = scoreEvaluationOutputs(suite, [{id: 'stale-directory', output: suite.referenceVerification}]);
  assert.equal(scored.passed, 1); assert.equal(scored.results.filter(item => item.status === 'missing').length, 10);
  assert.throws(() => scoreEvaluationOutputs(suite, [{id: 'not-a-test', output: {}}]), /Unknown/);
});

test('prompt manifest files and output schemas are consistent and evaluation examples remain fictional', async () => {
  const manifest = JSON.parse(await readFile(new URL('../prompts/manifest.json', import.meta.url), 'utf8'));
  const schemas = JSON.parse(await readFile(new URL('../prompts/output-schemas.json', import.meta.url), 'utf8'));
  for (const [stage, filename] of Object.entries(manifest.stages)) {
    assert.equal(schemas[stage].additionalProperties, false);
    assert.ok((await readFile(new URL(`../prompts/${filename}`, import.meta.url), 'utf8')).length > 500);
  }
  assert.equal(suite.mode, 'synthetic_offline'); assert.match(suite.case.organization.name, /fictional/);
  assert.ok(Object.values(suite.documents).every(document => new URL(document.url).hostname.endsWith('.example')));
});
