import { isIP } from 'node:net';

const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const LOOKUP = 'https://lookup.icann.org/';
const LIMIT = 2 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const NOTICE = 'Registration identifies the registrar, not the hosting provider. Nameservers do not establish who hosts the website. Domain repurposing alone does not prove DNS abuse.';
const clean = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const validDomain = value => typeof value === 'string' && value.length <= 253 && !isIP(value)
  && value.includes('.') && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  && !/\.(?:localhost|local|internal|example|invalid|test)$/i.test(value) && /[a-z]/i.test(value.split('.').at(-1));

export function websiteDomain(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const domain = url.hostname.toLowerCase().replace(/\.$/, '');
    return validDomain(domain) ? domain : null;
  } catch { return null; }
}

function publicSourceUrl(value) {
  try {
    const url = new URL(value);
    return typeof value === 'string' && value.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && validDomain(url.hostname) ? url.href : LOOKUP;
  } catch { return LOOKUP; }
}

function unknown(domain, checkedAt, notice = 'Registration lookup unavailable; verify the current registrar in ICANN Lookup.') {
  return { status: 'unknown', domain, registrarName: null, abuseEmail: null, sourceUrl: LOOKUP, checkedAt, notice: `${notice} ${NOTICE}` };
}

async function boundedJson(response) {
  if (!response.ok || Number(response.headers?.get('content-length')) > LIMIT) throw new Error('lookup_unavailable');
  let length = 0;
  const chunks = [];
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') throw new Error('invalid_lookup_response');
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > LIMIT) throw new Error('lookup_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function registryBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || !validDomain(url.hostname)) return null;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch { return null; }
}

function cardValues(entity, property) {
  const entries = entity?.vcardArray?.[1];
  return Array.isArray(entries) ? entries.filter(row => Array.isArray(row) && row[0] === property).map(row => row[3]) : [];
}

function registrationDetails(document) {
  let count = 0;
  let registrar = null;
  const visit = (entities, depth, callback) => {
    if (!Array.isArray(entities) || depth > 6) return;
    for (const entity of entities.slice(0, 100)) {
      if (++count > 200) return;
      if (!entity || typeof entity !== 'object') continue;
      callback(entity);
      visit(entity.entities, depth + 1, callback);
    }
  };
  visit(document?.entities, 0, entity => {
    if (!registrar && Array.isArray(entity.roles) && entity.roles.includes('registrar')) registrar = entity;
  });
  if (!registrar) return null;
  const name = [...cardValues(registrar, 'fn'), ...cardValues(registrar, 'org')].find(value => typeof value === 'string' && clean(value));
  if (!name) return null;
  let abuseEmail = null;
  count = 0;
  // Read only the registrar's abuse-role contacts; never expose registrant cards.
  visit([registrar], 0, entity => {
    if (abuseEmail || !Array.isArray(entity.roles) || !entity.roles.includes('abuse')) return;
    abuseEmail = cardValues(entity, 'email').find(value => typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value)) || null;
  });
  return { registrarName: clean(name), abuseEmail };
}

// Injectable fetch/clock keep tests passive and deterministic. All network traffic
// is GET to IANA or an HTTPS registry base from IANA; no target website is fetched.
export function createDomainRegistrationLookup({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let bootstrap = null;
  let bootstrapAt = 0;
  let bootstrapFlight = null;
  const cache = new Map();
  const flights = new Map();
  const getBootstrap = async signal => {
    if (bootstrap && now() - bootstrapAt < 24 * HOUR) return bootstrap;
    if (!bootstrapFlight) bootstrapFlight = (async () => {
      const data = await boundedJson(await fetchImpl(BOOTSTRAP, { redirect: 'error', signal, headers: { Accept: 'application/json' } }));
      if (!Array.isArray(data.services)) throw new Error('invalid_bootstrap');
      const services = data.services.slice(0, 5000).flatMap(service => {
        if (!Array.isArray(service?.[0]) || !Array.isArray(service?.[1])) return [];
        const bases = service[1].map(registryBase).filter(Boolean);
        return service[0].filter(suffix => typeof suffix === 'string' && /^[a-z0-9.-]{2,253}$/i.test(suffix)).map(suffix => ({ suffix: suffix.toLowerCase(), bases }));
      });
      bootstrap = services;
      bootstrapAt = now();
      return bootstrap;
    })().finally(() => { bootstrapFlight = null; });
    return bootstrapFlight;
  };
  return async function lookup(domain) {
    domain = typeof domain === 'string' ? domain.toLowerCase() : '';
    const checkedAt = new Date(now()).toISOString();
    if (!validDomain(domain)) return unknown(domain, checkedAt, 'No public domain was available for passive registration lookup.');
    if (cache.has(domain) && now() - cache.get(domain).time < HOUR) return { ...cache.get(domain).value };
    if (flights.has(domain)) return { ...await flights.get(domain) };
    const flight = (async () => {
      let result;
      try {
        const signal = AbortSignal.timeout(8000);
        const services = await getBootstrap(signal);
        const service = services.filter(item => domain === item.suffix || domain.endsWith(`.${item.suffix}`)).sort((a, b) => b.suffix.length - a.suffix.length)[0];
        if (!service?.bases.length) throw new Error('no_registry');
        let candidate = domain;
        const minimumLabels = service.suffix.split('.').length + 1;
        while (candidate.split('.').length >= minimumLabels) {
          const endpoint = new URL(`domain/${encodeURIComponent(candidate)}`, service.bases[0]).href;
          const response = await fetchImpl(endpoint, { redirect: 'error', signal, headers: { Accept: 'application/rdap+json, application/json' } });
          if (response.status === 404 && candidate.split('.').length > minimumLabels) { await response.body?.cancel?.(); candidate = candidate.split('.').slice(1).join('.'); continue; }
          const document = await boundedJson(response);
          if (typeof document.ldhName !== 'string' || document.ldhName.toLowerCase().replace(/\.$/, '') !== candidate) throw new Error('domain_mismatch');
          const details = registrationDetails(document);
          result = details ? { status: 'identified', domain: candidate, ...details, sourceUrl: endpoint, checkedAt, notice: NOTICE } : unknown(candidate, checkedAt, 'Registry response did not identify a registrar.');
          break;
        }
        if (!result) throw new Error('no_domain');
      } catch { result = unknown(domain, checkedAt); }
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(domain, { time: now(), value: result });
      return result;
    })();
    flights.set(domain, flight);
    try { return { ...await flight }; } finally { flights.delete(domain); }
  };
}

export const lookupDomainRegistration = createDomainRegistrationLookup();

const route = (title, url, scope, steps, requirements) => ({ title, url, steps, scope, requirements });

export async function buildReportingPlan(caseRecord, { lookupRegistration = lookupDomainRegistration } = {}) {
  const kind = ['website', 'email', 'phone'].includes(caseRecord?.identifier?.kind) ? caseRecord.identifier.kind : 'unsupported';
  const caseId = clean(caseRecord?.id, 200);
  if (kind === 'unsupported') return { caseId, kind, summary: 'Unsupported identifier: review the case before choosing a reporting route.', routes: [], registration: null };
  const requirements = ['Confirm the exact organization and branch; an internal removal is not proof that a public listing is still wrong.', 'Open and check the current listing. Include its URL, observation time and evidence; search snippets alone are leads.', 'Use a verified replacement when available. A reviewer chooses whether to submit; no report has been sent.'];
  const routes = [
    route('Correct Google Maps / business listing', 'https://support.google.com/maps/answer/7084895?hl=en', 'listing_correction', ['Open the matching place in Google Maps and choose Suggest an edit.', `Correct the ${kind === 'website' ? 'website' : kind === 'phone' ? 'phone number' : 'relevant contact information, or use listing feedback when email is not an editable field'}. Keep the real organization listed.`, 'Attach supporting current evidence and save the submission status for follow-up.'], requirements),
    route('Request a Findhelp directory correction', 'https://company.findhelp.com/about/contact/', 'listing_correction', ['Find and verify the affected program listing and branch.', 'Use Findhelp support/contact to send the exact program URL and the outdated field; authorized program staff can manage their claimed listing.', 'Request a correction or removal of the stale identifier and track the response.'], requirements),
    route('Correct other directories and AI citations at the source', 'https://support.google.com/websearch/answer/6223687?hl=en', 'listing_correction', ['Open each cited source and verify that it currently repeats the old identifier for this organization and branch.', 'Use that directory operator’s own correction/contact route; do not send a request to the retired phone or email.', 'For an AI answer, use the product’s feedback control and provide the corrected source. Fixing Streetli does not automatically update a directory or AI answer.'], requirements),
  ];
  let registration = null;
  if (kind === 'website') {
    routes.push(route('Report supported Google Search spam', 'https://search.google.com/search-console/report-spam', 'search_report', ['Identify the exact current Search result and affected page URL.', 'Choose the supported issue, such as expired-domain ranking abuse, hacked pages or deceptive redirects; describe observable evidence.', 'Use ordinary Search feedback for inaccurate results. If the source changed or disappeared, consider Refresh Outdated Content instead.'], ['Repurposing or gambling content alone does not prove search spam, phishing or malware.', 'Google reviews reports and controls the outcome; no removal or completion is guaranteed.', 'Do not include private notes or personally identifying information in a spam report.']));
    routes.push(route('Refresh a stale Google result after the source changed', 'https://search.google.com/search-console/remove-outdated-content', 'search_report', ['Check that the old content has actually changed or the source page is gone.', 'Request a refresh of the outdated Google result using the affected URL.'], ['Use only when the indexed result is outdated relative to the current source.', 'This does not remove a still-live unwanted website and is separate from ownership-based Search Console removals.']));
    const domain = websiteDomain(caseRecord.identifier.value);
    if (domain) {
      try {
        const result = await lookupRegistration(domain);
        // Re-project even injected lookups: never return raw RDAP or registrant data.
        const registrarName = clean(result?.registrarName);
        registration = result?.status === 'identified' && registrarName
          ? { status: 'identified', domain: validDomain(result.domain) && (result.domain === domain || domain.endsWith(`.${result.domain}`)) ? result.domain : domain, registrarName, abuseEmail: typeof result.abuseEmail === 'string' && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(result.abuseEmail) && result.abuseEmail.length <= 254 ? result.abuseEmail : null, sourceUrl: publicSourceUrl(result.sourceUrl), checkedAt: typeof result.checkedAt === 'string' && result.checkedAt.length <= 40 && Number.isFinite(Date.parse(result.checkedAt)) ? result.checkedAt : new Date().toISOString(), notice: NOTICE }
          : unknown(domain, new Date().toISOString());
      } catch { registration = unknown(domain, new Date().toISOString()); }
      const isName = registration.status === 'identified' && /^name\.com(?:,?\s+(?:inc\.?|llc))?$/i.test(registration.registrarName);
      // Verified 2026-10-28: https://www.godaddy.com/help/reporting-abuse-27154
      // links to the current legal portal. Match the registrar name exactly;
      // registrar identification does not assert that GoDaddy hosts the content.
      const isGoDaddy = registration.status === 'identified' && registration.registrarName.toLowerCase() === 'godaddy.com, llc';
      const url = isName ? 'https://www.name.com/abuse' : isGoDaddy ? 'https://legalportal.godaddy.com/abuse' : registration.abuseEmail ? `mailto:${registration.abuseEmail}` : LOOKUP;
      const title = isName ? 'Review Name.com abuse-report eligibility' : isGoDaddy ? 'Review GoDaddy abuse-report eligibility' : registration.status === 'identified' ? 'Review current registrar abuse-report eligibility' : 'Identify the current registrar before reporting abuse';
      routes.push(route(title, url, 'domain_abuse', ['Prioritize correcting directory links that still associate the old domain with the provider.', 'Review the current registrar’s abuse policy. Supply the exact URL, timestamp, redirect evidence and the specific supported policy violation.', 'Identify the hosting provider separately if content removal is needed; this lookup does not establish a host.', 'Keep any report as a draft until reviewed; record the recipient response before any escalation.'], ['A changed or expired domain reused for gambling is not by itself proof of DNS abuse.', 'Support phishing, malware, botnets, pharming or another applicable provider-policy violation with evidence; do not assert it from an old internal verdict.', 'Registrar control concerns domain registration; a host may control page content. Nameservers do not prove hosting.', 'No takedown is promised, and no external report has been submitted.']));
    }
  }
  return { caseId, kind, summary: 'Prepare corrections for stale public references; internal removal, current external evidence, submission and verified correction are separate states.', routes, registration };
}
