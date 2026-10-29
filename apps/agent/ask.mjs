// "Find me food services that may be at risk": Parasail decides what the request
// means (plan-request stage), code applies that plan to every loaded record, then
// Ivan's select-case stage picks up to three to research, re-checked with
// validateSelection. The model never grants research scope; the planner does.
import { validateSelection } from '../../packages/contracts/research-output.mjs';
import { normalizeDiscoveryIdentifier } from '../../packages/contracts/discovery-plan.mjs';

// Mirrors the category board in apps/web/app.js.
export const CATEGORIES = {
  compromise: { detail: 'scam content, suspected takeover, repurposed or parked website', codes: ['website_scam_content', 'website_suspected_compromise', 'website_repurposed', 'website_domain_parked', 'scan_suspected_compromise', 'scan_parked_domain'] },
  website: { detail: 'website that no longer loads', codes: ['website_not_found', 'invalid_website'] },
  phone: { detail: 'phone number flagged disconnected', codes: ['phone_disconnected'] },
  email: { detail: 'email address or domain failing delivery checks', codes: ['email_invalid', 'email_domain_no_mx'] },
  scan: { detail: 'automated website review leads, including former links', codes: ['scan_historical_reference'] },
  other: { detail: 'other invalid, risky or manually flagged contacts', codes: [] }
};
const RISK_ORDER = ['website_scam_content', 'website_suspected_compromise', 'scan_suspected_compromise', 'website_repurposed', 'website_domain_parked', 'scan_parked_domain'];
const MAX_CANDIDATES = 40;

export function categoryOf(item) {
  const known = Object.entries(CATEGORIES).find(([, category]) => category.codes.includes(item.internal.reasonCode))?.[0];
  if (known) return known;
  return item.internal.source === 'saved_scan' && item.identifier.kind === 'website' ? 'scan' : 'other';
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
  onEvent({ step: 'plan', status: 'done', message: `${matches.length} records match${plan.serviceTerms.length ? ` (names with ${plan.serviceTerms.slice(0, 4).map(term => `“${term}”`).join(', ')})` : ''}: ${plan.explanation}` });
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

// Marks a found service's phone or website "at risk" when it matches an identifier
// Streetli has flagged. Live data only: fixture identifiers are fictional.
const websiteIdentity = value => {
  const identifier=normalizeDiscoveryIdentifier({kind:'website',value});
  if (!identifier) return '';
  const url=new URL(identifier.value);
  // Common www aliases are comparable; paths and meaningful queries identify
  // distinct resources on shared hosts and must never be discarded.
  url.hostname=url.hostname.replace(/^www\./,'');
  return url.href;
};
const phoneIdentity = value => {
  if (typeof value !== 'string' || value.length>100 || /[\u0000-\u001f]/.test(value)) return '';
  let number=value.trim();
  const extension=number.match(/(?:;ext=|\bext(?:ension)?\.?\s*[:=]?\s*|(?:\bx|#)\s*)(\d{1,10})\s*$/i);
  if (extension) number=number.slice(0,extension.index).trim();
  if (!/^[+()\d\s.-]+$/.test(number) || /\+/.test(number.slice(1))) return '';
  const digits=number.replace(/\D/g,'');
  const international=number.startsWith('+') ? `+${digits}`
    : digits.length===10 ? `+1${digits}` : digits.length===11 && digits.startsWith('1') ? `+${digits}` : '';
  if (!international) return '';
  return normalizeDiscoveryIdentifier({kind:'phone',value:`${international}${extension ? `;ext=${extension[1]}` : ''}`})?.value || '';
};

export function annotateRisk(services, feed) {
  if (feed?.mode !== 'live' || !Array.isArray(services)) return services;
  const byWebsite = new Map(); const byPhone = new Map();
  for (const item of feed.cases) {
    if (item.identifier.kind === 'website' && websiteIdentity(item.identifier.value)) byWebsite.set(websiteIdentity(item.identifier.value), item);
    if (item.identifier.kind === 'phone' && phoneIdentity(item.identifier.value)) byPhone.set(phoneIdentity(item.identifier.value), item);
  }
  return services.map(service => {
    const matches = { website: byWebsite.get(websiteIdentity(service.website)), phone: byPhone.get(phoneIdentity(service.phone)) };
    if (!matches.website && !matches.phone) return service;
    const checks = (service.checks || []).map(check => {
      const item = matches[check.field];
      return item ? { ...check, state: 'at_risk', caseId: item.id,
        detail: `Streetli flagged this ${check.field} (${item.internal.reasonCode.replace(/_/g, ' ')}, ${item.internal.state})` } : check;
    });
    return { ...service, checks };
  });
}
