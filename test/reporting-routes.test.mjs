import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportingPlan, createDomainRegistrationLookup, websiteDomain } from '../apps/agent/reporting-routes.mjs';

const sample = (kind = 'website', value = 'https://www.community.example.org/old') => ({ id: 'demo-case', identifier: { kind, value }, internal: { reasonCode: 'website_repurposed' } });
const registration = (registrarName = 'Name.com, Inc.') => ({ status: 'identified', registrarName, domain: 'community.example.org', abuseEmail: 'abuse@registrar.example.org', sourceUrl: 'https://rdap.registry.example.org/domain/community.example.org', checkedAt: '2026-10-28T19:00:00Z', registrant: { private: 'DO_NOT_EXPOSE' }, vcardArray: ['vcard', [['fn', {}, 'text', 'PRIVATE_REGISTRANT']]] });
const json = (data, options) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' }, ...options });
const bootstrap = { services: [[['org'], ['https://rdap.registry.example.org/']]] };
const rdap = name => ({ ldhName: name, entities: [
  { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'PRIVATE_REGISTRANT'], ['email', {}, 'text', 'private@person.example.org']]] },
  { roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Name.com, Inc.']]], entities: [{ roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'abuse@registrar.example.org']]] }] },
] });

test('Name.com plan provides direct form and projects only public registrar fields', async () => {
  const plan = await buildReportingPlan(sample(), { lookupRegistration: async () => registration() });
  assert.equal(plan.caseId, 'demo-case');
  assert.equal(plan.registration.registrarName, 'Name.com, Inc.');
  assert(plan.routes.some(route => route.url === 'https://www.name.com/abuse'));
  assert(plan.routes.some(route => route.url === 'https://search.google.com/search-console/report-spam'));
  assert(plan.routes.some(route => route.url === 'https://company.findhelp.com/about/contact/'));
  assert.doesNotMatch(JSON.stringify(plan), /DO_NOT_EXPOSE|PRIVATE_REGISTRANT/);
  assert.match(plan.routes.find(route => route.scope === 'domain_abuse').requirements.join(' '), /not by itself proof/);
  assert.match(plan.registration.notice, /Nameservers do not establish/);
});

test('other registrar uses its abuse contact and never assumes Name.com or a host', async () => {
  const plan = await buildReportingPlan(sample(), { lookupRegistration: async () => registration('Other Registrar') });
  assert(plan.routes.some(route => route.url === 'mailto:abuse@registrar.example.org'));
  assert(!plan.routes.some(route => route.url === 'https://www.name.com/abuse'));
  assert(!Object.hasOwn(plan.registration, 'host'));
  const imposter = await buildReportingPlan(sample(), { lookupRegistration: async () => registration('Name.com.evil') });
  assert(!imposter.routes.some(route => route.url === 'https://www.name.com/abuse'));
});

test('exact GoDaddy registrar uses the verified current abuse portal even without RDAP email', async () => {
  const plan = await buildReportingPlan(sample(), { lookupRegistration: async () => ({ ...registration('GoDaddy.com, LLC'), abuseEmail: null }) });
  const report = plan.routes.find(route => route.scope === 'domain_abuse');
  assert.equal(report.url, 'https://legalportal.godaddy.com/abuse');
  assert.match(report.title, /GoDaddy/);
  assert.match(report.requirements.join(' '), /not by itself proof/);
  assert.match(plan.registration.notice, /not the hosting provider/);
  const lookalike = await buildReportingPlan(sample(), { lookupRegistration: async () => ({ ...registration('GoDaddy.com, LLC.evil'), abuseEmail: null }) });
  assert.equal(lookalike.routes.find(route => route.scope === 'domain_abuse').url, 'https://lookup.icann.org/');
});

test('unknown or failed lookup remains unknown and offers ICANN lookup', async () => {
  for (const lookupRegistration of [async () => ({ status: 'unknown' }), async () => { throw new Error('secret network detail'); }]) {
    const plan = await buildReportingPlan(sample(), { lookupRegistration });
    assert.equal(plan.registration.status, 'unknown');
    assert(plan.routes.some(route => route.scope === 'domain_abuse' && route.url === 'https://lookup.icann.org/'));
    assert.doesNotMatch(JSON.stringify(plan), /secret network detail/);
  }
});

test('email and phone request directory correction without any registration queries', async () => {
  for (const kind of ['email', 'phone']) {
    const plan = await buildReportingPlan(sample(kind, kind === 'email' ? 'old@retired.example.org' : '+12125550123'), { lookupRegistration: async () => assert.fail('must not query') });
    assert.equal(plan.registration, null);
    assert(plan.routes.every(route => route.scope === 'listing_correction'));
    assert.match(plan.routes.map(route => route.steps.join(' ')).join(' '), /branch/);
  }
});

test('malformed, private, credentialed and fictional website identifiers never invoke lookup', async () => {
  for (const value of ['not a url', 'https://user:pass@community.org', 'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://internal.local/', 'https://a.example/', 'https://a.test/', 'https://good.org\\@localhost/', 'file:///tmp/x', 'https://2130706433/']) {
    assert.equal(websiteDomain(value), null, value);
    const plan = await buildReportingPlan(sample('website', value), { lookupRegistration: async () => assert.fail(`must not query ${value}`) });
    assert.equal(plan.registration, null);
  }
  assert.equal(websiteDomain('https://WWW.COMMUNITY.ORG/path?x=y'), 'www.community.org');
});

test('unsupported identifier gives explicit unsupported plan', async () => {
  const plan = await buildReportingPlan(sample('unsupported'), { lookupRegistration: async () => assert.fail('must not query') });
  assert.equal(plan.kind, 'unsupported');
  assert.deepEqual(plan.routes, []);
});

test('passive RDAP uses only official bootstrap registry, bounded projection and deduplicated cache', async () => {
  const calls = [];
  let time = Date.parse('2026-10-28T19:00:00Z');
  const lookup = createDomainRegistrationLookup({ now: () => time, fetchImpl: async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, 'error');
    assert(options.signal);
    return String(url).includes('data.iana.org') ? json(bootstrap) : json({ ...rdap('community.org'), links: [{ href: 'http://localhost/private' }] });
  } });
  const [a, b] = await Promise.all([lookup('community.org'), lookup('community.org')]);
  assert.deepEqual(a, b);
  assert.equal(a.status, 'identified');
  assert.equal(a.abuseEmail, 'abuse@registrar.example.org');
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(a), /PRIVATE_REGISTRANT|private@person/);
  await lookup('community.org');
  assert.equal(calls.length, 2);
  time += 3600001;
  await lookup('community.org');
  assert.equal(calls.length, 3, 'domain cache expires after at least an hour; bootstrap remains cached');
  time += 24 * 3600000;
  await lookup('community.org');
  assert.equal(calls.length, 5, 'daily bootstrap refresh');
  assert(!calls.some(url => /localhost|private/.test(url)));
});

test('RDAP subdomain 404 falls back only through parents under the registry suffix', async () => {
  const calls = [];
  const lookup = createDomainRegistrationLookup({ fetchImpl: async url => {
    calls.push(String(url));
    if (String(url).includes('iana.org')) return json(bootstrap);
    if (String(url).endsWith('/www.community.org')) return new Response('', { status: 404 });
    return json(rdap('community.org'));
  } });
  const result = await lookup('www.community.org');
  assert.equal(result.domain, 'community.org');
  assert.equal(calls.length, 3);
});

test('RDAP rejects unsafe bootstrap endpoints, redirects, oversized and mismatched responses', async () => {
  const attempts = [
    async url => String(url).includes('iana.org') ? json({ services: [[['org'], ['http://localhost/', 'https://127.0.0.1/']]] }) : assert.fail('unsafe endpoint'),
    async url => String(url).includes('iana.org') ? json(bootstrap) : new Response('', { status: 302, headers: { Location: 'https://untrusted.example.org/' } }),
    async url => String(url).includes('iana.org') ? json(bootstrap) : new Response('x', { headers: { 'Content-Length': '2097153' } }),
    async url => String(url).includes('iana.org') ? json(bootstrap) : new Response(' '.repeat(2097153)),
    async url => String(url).includes('iana.org') ? json(bootstrap) : json(rdap('different.org')),
    async () => { throw new Error('arbitrary failure'); },
  ];
  for (const fetchImpl of attempts) assert.equal((await createDomainRegistrationLookup({ fetchImpl })('community.org')).status, 'unknown');
});

test('non-abuse registrant emails never become registrar abuse contacts', async () => {
  const document = rdap('community.org');
  document.entities[1].entities = [];
  const lookup = createDomainRegistrationLookup({ fetchImpl: async url => json(String(url).includes('iana.org') ? bootstrap : document) });
  const result = await lookup('community.org');
  assert.equal(result.status, 'identified');
  assert.equal(result.abuseEmail, null);
});
