import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../apps/web/app.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise(setImmediate); };

// A deliberately small DOM surface for interaction tests, not a browser/layout
// substitute. HTML insertion is forbidden so data must flow through text nodes.
class TextNode {
  constructor(value) { this.textContent = String(value); }
}
class Element {
  constructor(tag) { this.tagName = tag.toLowerCase(); this.childNodes = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.value = ''; }
  set textContent(value) { this.childNodes = [new TextNode(value)]; }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set innerHTML(_value) { throw new Error('Untrusted HTML insertion is forbidden in the frontend'); }
  get children() { return this.childNodes.filter(node => node instanceof Element); }
  get lastElementChild() { return this.children.at(-1) || null; }
  set id(value) { this.attributes.id = value; }
  get id() { return this.attributes.id || ''; }
  set className(value) { this.attributes.class = value; }
  get className() { return this.attributes.class || ''; }
  get classList() { return { add: name => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), name])].join(' '); } }; }
  append(...nodes) { this.childNodes.push(...nodes.map(node => typeof node === 'string' ? new TextNode(node) : node)); }
  prepend(...nodes) { this.childNodes.unshift(...nodes.map(node => typeof node === 'string' ? new TextNode(node) : node)); }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name) { if (name === 'click' && this.disabled) return; for (const callback of this.listeners[name] || []) callback({ preventDefault() {} }); }
  click() { this.dispatch('click'); }
  scrollIntoView() {}
  querySelectorAll(selector) {
    const matches = node => {
      if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
      const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute) return attribute[1] in node.attributes && (attribute[2] === undefined || node.attributes[attribute[1]] === attribute[2]);
      return node.tagName === selector.toLowerCase();
    };
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
function documentFromHtml(source) {
  const root = new Element('document'); const stack = [root];
  const voids = new Set(['meta', 'link', 'input', 'br', 'hr', 'img']);
  for (const token of source.match(/<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (!token.startsWith('<')) { stack.at(-1).append(new TextNode(token)); continue; }
    const tag = token.match(/^<([a-z][a-z0-9-]*)/i)?.[1]; if (!tag) continue;
    const node = new Element(tag);
    for (const match of token.slice(tag.length + 1).matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(match[1], match[2] ?? match[3] ?? match[4] ?? '');
    stack.at(-1).append(node);
    if (!voids.has(tag.toLowerCase()) && !token.endsWith('/>')) stack.push(node);
  }
  root.getElementById = id => root.querySelectorAll('[id]').find(node => node.id === id) || null;
  root.createElement = tag => new Element(tag);
  root.createTextNode = value => new TextNode(value);
  return root;
}

function makeCase(id, kind, state = 'removed', name = `Example ${id}`) {
  return {
    id, organization: { name, locality: 'Brooklyn' },
    identifier: { kind, value: kind === 'website' ? `https://${id}.example/` : kind === 'email' ? `${id}@provider.example` : '+12125550123' },
    internal: { state, reasonCode: `${kind}_invalid`, flaggedAt: '2026-10-01T10:00:00Z', correctedAt: state === 'flagged' ? null : '2026-10-02T10:00:00Z', source: 'retained_ledger', coverage: 'retained_records_only' },
    replacement: null, externalReferences: [], reviewState: 'review_required', location: null
  };
}
const makeFeed = cases => ({ schemaVersion: 2, mode: 'live', generatedAt: '2026-10-28T10:00:00Z', coverage: { scope: 'retained_records_only', returned: cases.length, omitted: 0 }, cases });

// Halloween mode is the site default; most tests check the normal wording, so they store 'off'.
async function startApp(feed, { reporting, discovery, respond, failInitial = false, failRefresh = false, stored = { 'ghost-links-halloween': 'off' } } = {}) {
  const document = documentFromHtml(html); const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body });
    if (respond) { const response = await respond(url, options); if (response) return response; }
    if ((url === '/api/cases' && failInitial) || (url === '/api/refresh' && failRefresh)) return { ok: false, status: 503, json: async () => ({ error: 'source_unavailable' }) };
    if (url.startsWith('/api/reporting?')) return { ok: true, json: async () => structuredClone(reporting) };
    if (url === '/api/discovery/findings' && discovery !== undefined) return { ok: true, json: async () => structuredClone(discovery) };
    return { ok: true, json: async () => structuredClone(feed) };
  };
  const localStorage = { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = String(value); } };
  vm.runInNewContext(script, { document, fetch, URL, AbortController, setTimeout, clearTimeout, localStorage, window: { matchMedia: () => ({ matches: false }) } }, { filename: 'apps/web/app.js' });
  await flush();
  return { document, requests, $: id => document.getElementById(id), by: (attribute, value) => document.querySelectorAll(`[${attribute}="${value}"]`)[0] };
}

test('live records default to removed history and type/status/search controls select actual records', async () => {
  const app = await startApp(makeFeed([makeCase('site-a', 'website'), makeCase('phone-a', 'phone'), makeCase('email-a', 'email', 'flagged')]));
  assert.equal(app.$('record-list').children.length, 2);
  assert.equal(app.by('data-history-state', 'removed').getAttribute('aria-pressed'), 'true');
  assert.equal(app.by('data-count', 'email').textContent, '0');
  app.by('data-prompt', 'Show bad phone numbers').click();
  assert.equal(app.$('record-list').children.length, 1);
  assert.match(app.$('record-list').textContent, /phone-a/);
  app.$('search-input').value = ''; app.$('search-input').dispatch('input');
  app.by('data-history-state', 'flagged').click();
  assert.equal(app.$('record-list').children.length, 1);
  assert.match(app.$('case-detail').textContent, /Example email-a/);
  app.$('search-input').value = 'organization-that-does-not-exist'; app.$('search-input').dispatch('input');
  assert.equal(app.$('record-list').children.length, 0);
  assert.equal(app.$('empty-state').hidden, false);
  assert.doesNotMatch(app.$('case-detail').textContent, /Example email-a/);
});

test('record text is never inserted as HTML and placeholder identity is excluded from web search', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const unknown = makeCase('unknown', 'phone', 'removed', 'Historical provider (identity unavailable)');
  const app = await startApp(makeFeed([makeCase('injected', 'website', 'removed', malicious), unknown]));
  assert.match(app.$('case-detail').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(app.document.querySelectorAll('img').length, 0);
  app.$('record-list').children[1].click();
  const google = app.$('case-detail').querySelectorAll('a').find(anchor => anchor.href?.startsWith('https://www.google.com/search'));
  assert.ok(google); assert.equal(new URL(google.href).searchParams.get('q'), `"${unknown.identifier.value}"`);
  assert.ok(app.requests.every(request => request.url.startsWith('/api/')));
});

test('saved automated findings are displayed as unconfirmed scan leads', async () => {
  const item = makeCase('scan-lead', 'website', 'flagged');
  item.internal.source = 'saved_scan';
  const app = await startApp(makeFeed([item]));
  assert.match(app.$('case-detail').textContent, /Saved automated scan lead/);
  assert.match(app.$('case-detail').textContent, /not a confirmed takeover/);
  assert.doesNotMatch(app.$('case-detail').textContent, /Retained identifier ledger/);
});

test('reporting is fetched on a click and renders registrar plus safe recipient links', async () => {
  const item = makeCase('site-a', 'website');
  const app = await startApp(makeFeed([item]), { reporting: { caseId: item.id, kind: 'website', summary: 'Review current evidence first.', registration: { status: 'identified', domain: 'site-a.example', registrarName: 'Name.com', checkedAt: '2026-10-28T10:00:00Z', sourceUrl: 'https://lookup.icann.org/', abuseEmail: 'abuse@registrar.example', notice: 'Registrar and host can differ.' }, routes: [ { title: 'Name.com abuse form', url: 'https://www.name.com/abuse', scope: 'domain_abuse', requirements: ['Document current phishing evidence.'], steps: ['Review the report before sending.'] }, { title: '<img onerror=alert(1)>', url: 'javascript:alert(1)', scope: 'listing_correction', requirements: [], steps: [] } ] } });
  assert.equal(app.requests.filter(request => request.url.startsWith('/api/reporting')).length, 0);
  app.$('case-detail').querySelectorAll('.report-toggle')[0].click(); await flush();
  assert.equal(app.requests.filter(request => request.url.startsWith('/api/reporting')).length, 1);
  assert.match(app.$('case-detail').textContent, /Name.com/); assert.match(app.$('case-detail').textContent, /Registrar and host can differ/);
  const links = app.$('case-detail').querySelectorAll('a');
  assert.ok(links.some(anchor => anchor.href === 'https://www.name.com/abuse'));
  assert.ok(links.some(anchor => anchor.href === 'mailto:abuse@registrar.example'));
  assert.ok(links.every(anchor => !anchor.href?.startsWith('javascript:')));
  assert.equal(app.document.querySelectorAll('img').length, 0);
});

test('fixture mode permits local review without remote research or registrar lookup', async () => {
  const feed = { ...makeFeed([makeCase('demo-a', 'website')]), mode: 'fixture' };
  const app = await startApp(feed);
  assert.match(app.$('source-label').textContent, /Fictional/);
  const search = app.$('case-detail').querySelectorAll('a').find(anchor => anchor.getAttribute('aria-disabled') === 'true');
  assert.ok(search); assert.equal(search.href, undefined);
  app.$('case-detail').querySelectorAll('.report-toggle')[0].click(); await flush();
  // Loading local reviewer decisions is allowed; nothing reaches research or reporting.
  assert.deepEqual(app.requests.map(request => request.url), ['/api/cases', '/api/review-actions']);
  const research = app.$('case-detail').querySelectorAll('.research-button')[0];
  assert.ok(research); assert.equal(research.disabled, true);
});

test('categories group failed verifications and a reviewer decision is saved locally', async () => {
  const cases = [makeCase('scam-a', 'website'), makeCase('parked-b', 'website'), makeCase('phone-c', 'phone')];
  cases[0].internal.reasonCode = 'website_scam_content'; cases[1].internal.reasonCode = 'website_domain_parked';
  const app = await startApp(makeFeed(cases));
  const compromise = app.by('data-category', 'compromise');
  assert.match(compromise.textContent, /Possible compromise/); assert.match(compromise.textContent, /2/);
  compromise.click();
  assert.equal(app.$('record-list').children.length, 2);
  assert.match(app.$('record-list').textContent, /Compromise risk/);
  const resolve = app.$('case-detail').querySelectorAll('button').find(button => button.textContent === 'Mark resolved');
  resolve.click(); await flush();
  const saved = app.requests.find(request => request.url === '/api/review-actions' && request.method === 'POST');
  assert.ok(saved);
});

test('generic saved scan leads have their own category and no compromise badge', async () => {
  const item=makeCase('generic-scan','website','flagged');
  item.internal.source='saved_scan'; item.internal.reasonCode='scan_unverified_content_review';
  const app=await startApp(makeFeed([item]));
  app.by('data-category','scan').click();
  assert.equal(app.$('record-list').children.length,1);
  assert.doesNotMatch(app.$('record-list').textContent,/Compromise risk/);
  app.by('data-category','compromise').click();
  assert.equal(app.$('record-list').children.length,0);
});

test('an explicitly unavailable deployed research backend keeps local filtering and reporting while blocking mutations', async () => {
  const cases=[makeCase('site-a','website'),makeCase('phone-b','phone')];
  const app=await startApp(makeFeed(cases), { discovery:{mode:'live',findings:{},eligibleCaseIds:cases.map(item=>item.id),researchBackendAvailable:false},
    reporting:{caseId:'phone-b',kind:'phone',registration:null,routes:[],summary:'Review the current listing before correcting it.'} });
  assert.equal(app.$('research-capability-note').hidden,false);
  assert.match(app.$('research-capability-note').textContent,/Live web research is not connected yet/);
  assert.equal(app.$('search-submit').textContent,'Filter records');
  assert.equal(app.$('pipeline-submit').disabled,true);
  assert.equal(app.$('case-detail').querySelectorAll('.research-button')[0].disabled,true);
  assert.ok(app.$('case-detail').querySelectorAll('.decision-buttons')[0].children.every(button=>button.disabled));
  const discover=app.$('category-board').children.find(button=>button.textContent==='Live discovery unavailable');
  assert.equal(discover.disabled,true);
  app.$('search-input').value='phone'; app.$('search-input').dispatch('input');
  app.$('search-form').dispatch('submit');
  assert.equal(app.$('record-list').children.length,1);
  assert.match(app.$('record-list').textContent,/phone-b/);
  assert.match(app.$('route-output').textContent,/view reporting steps/);
  app.$('pipeline-form').dispatch('submit');
  app.$('case-detail').querySelectorAll('.report-toggle')[0].click(); await flush();
  assert.ok(app.requests.some(request=>request.url.startsWith('/api/reporting?')));
  assert.equal(app.requests.filter(request=>request.method==='POST').length,0);
});

test('an omitted capability preserves the local runtime research controls', async () => {
  const item=makeCase('local-a','website');
  const app=await startApp(makeFeed([item]),{discovery:{mode:'live',findings:{},eligibleCaseIds:[item.id],due:1}});
  assert.equal(app.$('research-capability-note').hidden,true);
  assert.equal(app.$('case-detail').querySelectorAll('.research-button')[0].disabled,false);
  assert.equal(app.$('pipeline-submit').disabled,false);
  assert.ok(app.$('case-detail').querySelectorAll('.decision-buttons')[0].children.every(button=>!button.disabled));
});

test('a live-source failure stays explicit and refresh failure preserves dated records', async () => {
  const failed = await startApp(makeFeed([]), { failInitial: true });
  assert.equal(failed.$('record-list').children.length, 0); assert.equal(failed.$('empty-state').hidden, false);
  assert.match(failed.$('load-status').textContent, /No fictional data has been substituted/);
  const app = await startApp(makeFeed([makeCase('site-a', 'website')]), { failRefresh: true });
  app.$('refresh-button').click(); await flush();
  assert.equal(app.$('record-list').children.length, 1);
  assert.match(app.$('load-status').textContent, /Previously loaded records remain visible/);
  assert.equal(app.$('refresh-button').disabled, false);
});

test('large queues render incrementally and preserve the actual total', async () => {
  const app = await startApp(makeFeed(Array.from({ length: 35 }, (_, i) => makeCase(`site-${i}`, 'website'))));
  assert.equal(app.$('record-list').children.length, 30); assert.equal(app.$('show-more').hidden, false);
  assert.equal(app.by('data-count', 'all').textContent, '35');
  app.$('show-more').click(); assert.equal(app.$('record-list').children.length, 35); assert.equal(app.$('show-more').hidden, true);
});

test('the review queue starts hidden for people seeking help and opens with Be a hero', async () => {
  const app = await startApp(makeFeed([makeCase('queue-a', 'website')]));
  assert.equal(app.$('results').hidden, true);
  assert.equal(app.$('pipeline-test').hidden, true);
  app.$('hero-toggle').click();
  assert.equal(app.$('results').hidden, false);
  assert.equal(app.$('hero-toggle').getAttribute('aria-expanded'), 'true');
  app.$('hero-toggle').click();
  assert.equal(app.$('results').hidden, true);
  app.by('data-prompt', 'Show bad phone numbers').click();
  assert.equal(app.$('results').hidden, false);
});

test('Halloween mode is on by default and a stored normal-mode choice is kept', async () => {
  const fresh = await startApp(makeFeed([makeCase('site-a', 'website')]), { stored: {} });
  assert.equal(fresh.$('halloween-toggle').textContent, '☀️ Normal mode');
  assert.equal(fresh.$('halloween-toggle').getAttribute('aria-pressed'), 'true');
  const normal = await startApp(makeFeed([makeCase('site-a', 'website')]));
  assert.equal(normal.$('halloween-toggle').textContent, '🎃 Halloween mode');
});

test('research access stays in memory and authorizes research, decisions and One only on explicit actions', async () => {
  const code = 'test_only_access_code_1234567890123456';
  const app = await startApp(makeFeed([makeCase('access-a', 'website')]), { respond: async (url, options) => {
    if (options.method !== 'POST') return;
    if (url === '/api/route') return { ok: true, text: async () => JSON.stringify({ type: 'result', kind: 'unsupported' }) };
    return { ok: true, json: async () => ({ subject: 'Test progress report' }) };
  } });
  const initialRequests = app.requests.length;
  app.$('research-access-code').value = code;
  app.$('research-access-form').dispatch('submit');
  assert.equal(app.requests.length, initialRequests, 'entering a code must not execute research or send anything');
  assert.equal(app.$('research-access-code').value, '');
  assert.doesNotMatch(app.document.textContent, new RegExp(code));
  app.$('search-input').value = 'Find help in Harlem';
  app.$('search-form').dispatch('submit'); await flush();
  app.$('case-detail').querySelectorAll('button').find(button => button.textContent === 'Mark resolved').click(); await flush();
  app.$('report-email').value = 'reviewer@example.org';
  app.$('report-form').dispatch('submit'); await flush();
  for (const path of ['/api/route', '/api/review-actions', '/api/one/ghost-report']) {
    const request = app.requests.find(request => request.url === path && request.method === 'POST');
    assert.ok(request, path);
    assert.equal(request.headers.Authorization, `Bearer ${code}`, path);
    assert.ok(!request.url.includes(code) && !String(request.body).includes(code));
  }
  app.$('refresh-button').click(); await flush();
  assert.ok(app.requests.filter(request => request.method === 'GET' || request.url === '/api/refresh').every(request => !request.headers.Authorization));
  app.$('research-access-clear').click();
  app.$('search-form').dispatch('submit'); await flush();
  assert.equal(app.requests.filter(request => request.url === '/api/route').at(-1).headers.Authorization, undefined);
  const reloaded = await startApp(makeFeed([makeCase('access-b', 'website')]));
  assert.match(reloaded.$('research-access-status').textContent, /Enter your team's code/);
});

test('a rejected research access code opens a clear instruction and is discarded', async () => {
  const app = await startApp(makeFeed([makeCase('locked-a', 'website')]), { respond: async (_url, options) => options.method === 'POST'
    ? { ok: false, status: 401, json: async () => ({ error: 'maintainer_access_required' }) } : undefined });
  app.$('research-access-code').value = 'invalid_code';
  app.$('research-access-form').dispatch('submit');
  assert.match(app.$('research-access-status').textContent, /32–256/);
  app.$('research-access-code').value = 'synthetic_rejected_access_code_12345678';
  app.$('research-access-form').dispatch('submit');
  app.$('search-input').value = 'Find help in Harlem';
  app.$('search-form').dispatch('submit'); await flush();
  assert.equal(app.$('research-access').open, true);
  assert.match(app.$('route-output').textContent, /enter the code shared by the maintainer/);
  app.$('search-form').dispatch('submit'); await flush();
  assert.equal(app.requests.filter(request => request.url === '/api/route').at(-1).headers.Authorization, undefined);
});
