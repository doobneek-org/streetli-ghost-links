// "Find me food services that may be at risk": Parasail decides what the request
// means (plan-request stage), code applies that plan to every loaded record, then
// Ivan's select-case stage picks up to three to research, re-checked with
// validateSelection. The model never grants research scope; the planner does.
import { validateSelection } from '../../packages/contracts/research-output.mjs';

// Mirrors the category board in apps/web/app.js.
export const CATEGORIES = {
  compromise: { detail: 'scam content, suspected takeover, repurposed or parked website', codes: ['website_scam_content', 'website_suspected_compromise', 'website_repurposed', 'website_domain_parked'] },
  website: { detail: 'website that no longer loads', codes: ['website_not_found'] },
  phone: { detail: 'phone number flagged disconnected', codes: ['phone_disconnected'] },
  email: { detail: 'email address or domain failing delivery checks', codes: ['email_invalid', 'email_domain_no_mx'] },
  scan: { detail: 'former website link a past scan saw', codes: ['scan_historical_reference'] },
  other: { detail: 'other invalid, risky or manually flagged contacts', codes: [] }
};
const RISK_ORDER = ['website_scam_content', 'website_suspected_compromise', 'website_repurposed', 'website_domain_parked'];
const MAX_CANDIDATES = 40;

export function categoryOf(item) {
  const known = Object.entries(CATEGORIES).find(([, category]) => category.codes.includes(item.internal.reasonCode))?.[0];
  if (known) return known;
  return item.internal.source === 'saved_scan' && item.identifier.kind === 'website' ? 'compromise' : 'other';
}

// Bounds model output before code uses it as a filter.
export function cleanPlan(output) {
  const words = Array.isArray(output?.serviceTerms) ? output.serviceTerms : [];
  return {
    serviceTerms: words.filter(term => typeof term === 'string' && term.trim().length >= 3 && term.length <= 40).map(term => term.trim().toLowerCase()).slice(0, 12),
    categories: (Array.isArray(output?.categories) ? output.categories : []).filter(id => Object.hasOwn(CATEGORIES, id)),
    kinds: (Array.isArray(output?.kinds) ? output.kinds : []).filter(kind => ['website', 'phone', 'email'].includes(kind)),
    locality: typeof output?.locality === 'string' && output.locality.trim() && output.locality.length <= 160 ? output.locality.trim() : null,
    explanation: typeof output?.explanation === 'string' ? output.explanation.slice(0, 400) : ''
  };
}

export function applyPlan(cases, plan) {
  const place = plan.locality?.toLowerCase().split(',')[0].trim();
  return cases.filter(item => {
    const name = item.organization.name.toLowerCase();
    if (plan.serviceTerms.length && !plan.serviceTerms.some(term => name.includes(term))) return false;
    if (plan.categories.length && !plan.categories.includes(categoryOf(item))) return false;
    if (plan.kinds.length && !plan.kinds.includes(item.identifier.kind)) return false;
    if (place && !item.organization.locality.toLowerCase().includes(place)) return false;
    return true;
  }).sort((a, b) => (RISK_ORDER.indexOf(a.internal.reasonCode) + 1 || 9) - (RISK_ORDER.indexOf(b.internal.reasonCode) + 1 || 9));
}

export async function answerRequest(request, feed, { runStage, eligibleCaseIds = [], onEvent = () => {} }) {
  onEvent({ step: 'plan', status: 'start', message: 'Parasail interpreting the request via CrewAI' });
  const planned = await runStage('plan-request', { request, categories: Object.fromEntries(Object.entries(CATEGORIES).map(([id, c]) => [id, c.detail])) });
  if (!planned.output) return { error: 'request_not_understood' };
  const plan = cleanPlan(planned.output);
  const matches = applyPlan(feed.cases, plan);
  onEvent({ step: 'plan', status: 'done', message: `${matches.length} records match: ${plan.explanation}` });
  const result = { plan, matchedIds: matches.slice(0, 2000).map(item => item.id), matched: matches.length, selection: null, placeholderPrompts: ['plan-request'] };
  if (!matches.length) return result;

  const candidates = matches.slice(0, MAX_CANDIDATES);
  const ids = new Set(candidates.map(item => item.id));
  const researchCaseIds = eligibleCaseIds.filter(id => ids.has(id));
  onEvent({ step: 'select', status: 'start', message: `Choosing up to three of ${candidates.length} to research first` });
  const selected = await runStage('select-case', { request, mode: feed.mode, cases: candidates, researchCaseIds, now: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  try {
    result.selection = validateSelection(selected.output, { cases: candidates, mode: feed.mode, researchCaseIds });
    onEvent({ step: 'select', status: 'done', message: `${result.selection.caseIds.length} selected (${result.selection.intent})` });
  } catch (error) {
    result.selectionGate = String(error.message || 'invalid').replace(/^.*: /, '');
    onEvent({ step: 'select', status: 'error', message: `Selection rejected by the output gate (${result.selectionGate}); showing the filtered records only` });
  }
  return result;
}
