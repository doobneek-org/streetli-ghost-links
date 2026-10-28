// Original model-output checks. These bind outputs to supplied records/evidence;
// they cannot establish semantic truth or authorize external actions.
const fail = code => { throw new TypeError(`Invalid research output: ${code}`); };
const values = (items, allowed) => Array.isArray(items) && items.every(item => allowed.includes(item)) && new Set(items).size === items.length;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function shape(output, fields) {
  if (!output || typeof output !== 'object' || Array.isArray(output)
    || Object.keys(output).length !== fields.length || !fields.every(field => Object.hasOwn(output, field))) fail('unexpected_fields');
}
function list(items, limit, maxText = 300) {
  if (!Array.isArray(items) || items.length > limit || items.some(item => !text(item, maxText))) fail('invalid_list');
}
function fresh(document, now, maxAgeMs) {
  const observed = Date.parse(document?.observedAt || '');
  return document?.status === 'fetched' && Number.isFinite(observed)
    && observed <= now && now - observed <= maxAgeMs;
}

export function validateSelection(output, { cases = [], mode, researchCaseIds = [] } = {}) {
  shape(output, ['intent', 'kinds', 'states', 'locality', 'caseIds', 'question', 'explanation']);
  if (!['browse', 'verify_external', 'prepare_report', 'clarify', 'unsupported'].includes(output.intent)
    || !values(output.kinds, ['website', 'phone', 'email']) || !values(output.states, ['flagged', 'removed', 'replaced'])
    || !(output.locality === null || text(output.locality, 160)) || !text(output.explanation, 600)) fail('invalid_selection');
  list(output.caseIds, 3, 200);
  if (new Set(output.caseIds).size !== output.caseIds.length) fail('duplicate_case');
  const byId = new Map(cases.map(item => [item.id, item]));
  // This scope comes from the trusted discovery planner, never model output.
  // Permission to research a flag does not confirm the flag or permit a report.
  if (!Array.isArray(researchCaseIds) || researchCaseIds.some(id => !byId.has(id))) fail('invalid_research_scope');
  const researchScope = new Set(researchCaseIds);
  for (const id of output.caseIds) {
    const item = byId.get(id);
    if (!item) fail('unknown_case');
    if (output.kinds.length && !output.kinds.includes(item.identifier?.kind)) fail('wrong_kind');
    if (output.states.length && !output.states.includes(item.internal?.state)) fail('wrong_state');
  }
  if (['verify_external', 'prepare_report'].includes(output.intent)
    && (mode !== 'live' || !output.caseIds.length || output.caseIds.some(id => byId.get(id).reviewState !== 'approved_for_research'
      && !researchScope.has(id)))) fail('research_not_approved');
  if (output.intent === 'clarify' ? !text(output.question, 300) : output.question !== null) fail('invalid_question');
  if (['clarify', 'unsupported'].includes(output.intent) && output.caseIds.length) fail('unexpected_selection');
  return output;
}

export function validateVerification(output, { case: item, documents = [], now = Date.now(), maxAgeMs = 86400000 } = {}) {
  shape(output, ['caseId', 'verdict', 'evidence', 'missingEvidence', 'summary']);
  const time = typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(time) || output.caseId !== item?.id
    || !['stale_reference', 'historical_mention', 'different_entity', 'not_present', 'uncertain'].includes(output.verdict)
    || !text(output.summary, 800) || !Array.isArray(output.evidence) || output.evidence.length > 6) fail('invalid_verification');
  list(output.missingEvidence, 6);
  const byId = new Map(documents.map(document => [document.id, document]));
  const roles = new Set();
  for (const evidence of output.evidence) {
    shape(evidence, ['documentId', 'quote', 'role']);
    const source = byId.get(evidence.documentId);
    if (!source || typeof source.text !== 'string' || !text(evidence.quote, 400) || evidence.quote.length < 8
      || !source.text.includes(evidence.quote)) fail('unbound_quote');
    if (!['current_association', 'identity', 'contradiction', 'historical_context', 'current_correction'].includes(evidence.role)) fail('invalid_evidence_role');
    if (output.verdict !== 'uncertain' && !fresh(source, time, maxAgeMs)) fail('unverified_source');
    roles.add(evidence.role);
  }
  if (output.verdict === 'stale_reference'
    && (!roles.has('current_association') || !roles.has('identity') || !roles.has('contradiction'))) fail('missing_stale_reference_evidence');
  if (output.verdict === 'historical_mention' && !roles.has('historical_context')) fail('missing_historical_context');
  if (output.verdict === 'different_entity' && !roles.has('identity')) fail('missing_identity_context');
  if (output.verdict === 'not_present' && !documents.some(document => fresh(document, time, maxAgeMs))) fail('no_checked_page');
  if (output.verdict === 'uncertain' && !output.missingEvidence.length) fail('uncertainty_needs_missing_evidence');
  return output;
}

export function validateCorrection(output, context = {}) {
  shape(output, ['caseId', 'disposition', 'routeId', 'subject', 'body', 'evidenceDocumentIds', 'needsHumanApproval', 'missingEvidence']);
  const { case: item, verification, routes = [] } = context;
  validateVerification(verification, context);
  if (output.caseId !== item?.id || !['draft_ready', 'needs_review', 'no_action'].includes(output.disposition)
    || output.needsHumanApproval !== true) fail('invalid_correction');
  list(output.evidenceDocumentIds, 6, 200); list(output.missingEvidence, 6);
  const evidenceIds = new Set(verification.evidence.map(evidence => evidence.documentId));
  if (output.evidenceDocumentIds.some(id => !evidenceIds.has(id))) fail('unknown_evidence');
  if (output.disposition === 'draft_ready') {
    const route = routes.find(candidate => candidate.id === output.routeId);
    if (verification.verdict !== 'stale_reference' || !route || !['listing_correction', 'search_report', 'domain_abuse'].includes(route.scope)
      || !text(output.subject, 200) || !text(output.body, 2400) || !output.evidenceDocumentIds.length) fail('draft_not_supported');
    if (route.scope !== 'listing_correction' && route.policyBasisConfirmed !== true) fail('policy_basis_not_confirmed');
  } else if (output.routeId !== null || output.subject !== null || output.body !== null) fail('unexpected_draft');
  if (verification.verdict === 'uncertain' && (output.disposition !== 'needs_review' || !output.missingEvidence.length)) fail('unresolved_evidence');
  if (['historical_mention', 'different_entity', 'not_present'].includes(verification.verdict) && output.disposition !== 'no_action') fail('non_error_must_not_escalate');
  return output;
}
