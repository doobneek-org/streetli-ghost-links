(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const elements = {
    form: $('search-form'), input: $('search-input'), list: $('record-list'),
    detail: $('case-detail'), banner: $('source-banner'), status: $('load-status'),
    source: $('source-label'), counts: $('result-count'), empty: $('empty-state'),
    emptyTitle: $('empty-title'), emptyDescription: $('empty-description'),
    refresh: $('refresh-button'), more: $('show-more'), coverage: $('coverage-note')
  };
  const labels = { website: 'Website', phone: 'Phone number', email: 'Email' };
  const stateLabels = { flagged: 'Flagged', removed: 'Removed', replaced: 'Replaced' };
  const reasons = {
    website_repurposed: 'Website content changed', website_not_found: 'Page not found',
    website_domain_parked: 'Domain parked', website_scam_content: 'Suspect website content',
    website_suspected_compromise: 'Possible website compromise', phone_disconnected: 'Disconnected number',
    email_invalid: 'Email flagged invalid', invalid: 'Previously flagged invalid', risky: 'Risk flag',
    manual_bad: 'Previously flagged bad', email_domain_no_mx: 'Email domain issue'
  };
  let feed = null;
  let items = [];
  let selectedId = null;
  let activeKind = 'all';
  let activeState = 'all';
  let stateChosen = false;
  let query = '';
  let visibleCount = 30;
  let busy = false;
  let loadFailed = false;
  const reportingPlans = new Map();

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const readableReason = code => reasons[code] || String(code || 'Past identifier flag').replace(/[_-]+/g, ' ').replace(/^./, ch => ch.toUpperCase());
  const date = value => {
    const parsed = value ? new Date(value) : null;
    return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded';
  };
  const number = value => Number(value || 0).toLocaleString('en-US');
  const checkedTime = value => { const parsed = value ? new Date(value) : null; return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Time not recorded'; };
  const safeReportingUrl = value => {
    try {
      if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f]/.test(value)) return null;
      const parsed = new URL(value);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.href;
      if (parsed.protocol === 'mailto:' && /^[^\s@?]+@[^\s@?]+\.[^\s@?]+$/.test(parsed.pathname) && !parsed.search) return parsed.href;
      return null;
    } catch { return null; }
  };
  const externalAnchor = (title, url, className = 'report-link') => {
    const safeUrl = safeReportingUrl(url);
    if (!safeUrl) return null;
    const anchor = make('a', className, title); anchor.href = safeUrl;
    anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.referrerPolicy = 'no-referrer';
    return anchor;
  };
  const safeStreetliUrl = value => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && ['gogetta.nyc', 'www.gogetta.nyc', 'doobneek.org', 'www.doobneek.org', 'streetli.org', 'www.streetli.org'].includes(parsed.hostname) && !parsed.username && !parsed.password ? parsed.href : null;
    } catch { return null; }
  };

  function queryPlan(value) {
    const lowered = String(value || '').trim().toLowerCase();
    const kinds = new Set();
    if (/\b(?:websites?|sites?|domains?|urls?|links?)\b/.test(lowered)) kinds.add('website');
    if (/\b(?:phones?|numbers?|telephone|tel)\b/.test(lowered)) kinds.add('phone');
    if (/\b(?:emails?|e-mails?|mailboxes?)\b/.test(lowered)) kinds.add('email');
    const stop = new Set('a an the and or of for in at on to me us our i you can how make social safety net better improve help find show get search please that have were are not working down issue issues with some records record historical history previously flagged bad broken invalid risky removed replaced identifiers identifier contacts contact bugs bug all everything needs review websites website sites site domains domain urls url links link phones phone numbers number telephone tel emails email e-mails e-mail mailboxes mailbox addresses address'.split(' '));
    const terms = lowered.split(/\s+/).map(word => word.replace(/^["']+|["',?!]+$/g, '')).filter(word => word && !stop.has(word));
    return { kinds, terms };
  }

  function filteredByQuery() {
    const plan = queryPlan(query);
    return items.filter(item => {
      if (plan.kinds.size && !plan.kinds.has(item.identifier.kind)) return false;
      const haystack = [item.organization.name, item.organization.locality, item.identifier.value, item.identifier.kind, item.internal.reasonCode, readableReason(item.internal.reasonCode), stateLabels[item.internal.state]].join(' ').toLowerCase();
      return plan.terms.every(term => haystack.includes(term));
    });
  }

  function setBanner(text, type = 'ready') {
    elements.status.textContent = text;
    elements.banner.dataset.state = type;
  }

  function renderSource() {
    if (!feed) return;
    const fixture = feed.mode === 'fixture';
    elements.source.textContent = fixture ? 'Fictional example data' : 'Streetli retained records';
    const generated = date(feed.generatedAt);
    setBanner(fixture
      ? `${number(items.length)} fictional examples loaded. This is fixture mode; no real providers or live findings are shown.`
      : `${number(items.length)} historical identifier records loaded · ${generated}. External web verification has not run.`, fixture ? 'fixture' : 'ready');
    const omitted = Number(feed.coverage?.omitted || 0);
    elements.coverage.textContent = `Coverage: retained records only. Past flags do not establish a current error.${omitted ? ` ${number(omitted)} records omitted by source limits or projection checks.` : ''}`;
  }

  function renderList() {
    const queryMatches = filteredByQuery();
    const matchesState = (item, target) => target === 'all' || (target === 'removed' ? ['removed', 'replaced'].includes(item.internal.state) : item.internal.state === 'flagged');
    const stateMatches = queryMatches.filter(item => matchesState(item, activeState));
    const matches = activeKind === 'all' ? stateMatches : stateMatches.filter(item => item.identifier.kind === activeKind);
    document.querySelectorAll('[data-history-state]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyState === activeState)));
    document.querySelectorAll('[data-state-count]').forEach(span => { span.textContent = number(queryMatches.filter(item => matchesState(item, span.dataset.stateCount)).length); });
    document.querySelectorAll('[data-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kind === activeKind)));
    document.querySelectorAll('[data-count]').forEach(span => { span.textContent = number(span.dataset.count === 'all' ? stateMatches.length : stateMatches.filter(item => item.identifier.kind === span.dataset.count).length); });
    elements.counts.textContent = feed ? `${number(matches.length)} ${matches.length === 1 ? 'record' : 'records'}${query || activeKind !== 'all' || activeState !== 'all' ? ' matching' : ' loaded'}` : busy ? 'Loading records' : 'Source unavailable';
    elements.list.replaceChildren();
    elements.empty.hidden = busy || matches.length > 0;
    elements.emptyTitle.textContent = loadFailed && !items.length ? 'The source could not be loaded' : 'No matching records';
    elements.emptyDescription.textContent = loadFailed && !items.length ? 'Check the local Streetli adapter, then refresh. Live-source errors do not switch to fictional data.' : items.length ? 'Try another organization, identifier, or record type.' : 'The source returned no eligible historical records.';
    if (!matches.some(item => item.id === selectedId)) selectedId = matches[0]?.id || null;
    matches.slice(0, visibleCount).forEach(item => {
      const button = make('button', 'record');
      button.type = 'button';
      button.dataset.caseId = item.id;
      button.setAttribute('aria-current', String(item.id === selectedId));
      const top = make('span', 'record-top');
      const provider = make('span');
      provider.append(make('span', 'record-provider', item.organization.name), make('span', 'record-place', item.organization.locality));
      top.append(provider, make('span', 'record-kind', labels[item.identifier.kind] || item.identifier.kind));
      const bottom = make('span', 'record-bottom');
      const historicalDate = item.internal.correctedAt || item.internal.flaggedAt;
      const metadata = make('span', 'record-meta');
      metadata.append(make('span', 'record-state', stateLabels[item.internal.state] || item.internal.state));
      if (historicalDate) { const recorded = make('time', 'record-date', date(historicalDate)); recorded.dateTime = historicalDate; metadata.append(recorded); }
      bottom.append(make('span', 'record-reason', readableReason(item.internal.reasonCode)), metadata);
      button.append(top, make('span', 'record-value', item.identifier.value), bottom);
      if (historicalDate) button.setAttribute('aria-label', `${item.organization.name}, ${labels[item.identifier.kind]}, ${item.identifier.value}, ${stateLabels[item.internal.state]}, ${date(historicalDate)}`);
      button.addEventListener('click', () => {
        selectedId = item.id;
        elements.list.querySelectorAll('.record').forEach(record => record.setAttribute('aria-current', String(record.dataset.caseId === selectedId)));
        renderDetail(item);
        if (window.matchMedia('(max-width: 690px)').matches) elements.detail.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      });
      elements.list.append(button);
    });
    elements.more.hidden = matches.length <= visibleCount;
    if (!elements.more.hidden) elements.more.textContent = `Show ${number(Math.min(30, matches.length - visibleCount))} more records`;
    renderDetail(matches.find(item => item.id === selectedId));
  }

  function renderDetail(item) {
    if (!item) {
      elements.detail.replaceChildren();
      const placeholder = make('div', 'detail-placeholder');
      placeholder.append(make('span', 'detail-placeholder-mark', '↖'), make('h3', '', 'Your next useful correction starts here.'), make('p', '', 'Select a record to review its history and see the next steps.'));
      elements.detail.append(placeholder);
      return;
    }
    elements.detail.replaceChildren();
    const kicker = make('div', 'detail-kicker');
    const reviewApproved = item.reviewState === 'approved_for_research';
    kicker.append(make('span', 'eyebrow', `${labels[item.identifier.kind] || item.identifier.kind} history`), make('span', `review-badge${reviewApproved ? ' approved' : ''}`, reviewApproved ? 'Approved for research' : 'Needs review'));
    const identifier = make('div', 'identifier-block');
    identifier.append(make('div', 'eyebrow', item.internal.state === 'flagged' ? 'Flagged identifier' : 'Former identifier'), make('span', 'identifier-text', item.identifier.value), make('p', 'identifier-disclaimer', 'Historical value · shown as text, not a contact recommendation'));
    const facts = make('dl', 'detail-facts');
    const addFact = (name, value) => facts.append(make('dt', '', name), make('dd', '', value));
    addFact('Streetli state', stateLabels[item.internal.state] || item.internal.state);
    addFact('Recorded reason', readableReason(item.internal.reasonCode));
    if (item.internal.flaggedAt) addFact('Flag recorded', date(item.internal.flaggedAt));
    if (item.internal.correctedAt) addFact(item.internal.source === 'confirmed_correction' ? 'Correction recorded' : 'Removal recorded', date(item.internal.correctedAt));
    addFact('Provenance', item.internal.source === 'confirmed_correction' ? 'Confirmed correction record'
      : item.internal.source === 'saved_scan' ? 'Saved automated scan lead' : 'Retained identifier ledger');
    if (item.replacement?.value) addFact('Replacement', item.replacement.value);
    const context = make('p', 'detail-context', item.internal.source === 'confirmed_correction'
      ? 'This records an internal correction. Check current public sources before claiming that another listing is outdated.'
      : item.internal.source === 'saved_scan'
        ? 'An automated scan flagged this destination for review. It is not a confirmed takeover or current external error; check fresh public evidence.'
        : 'This is a previously recorded flag. Confirm the provider, identifier, and current conditions before making a correction request.');
    const links = make('div', 'detail-links');
    const streetliUrl = safeStreetliUrl(item.location?.url);
    if (streetliUrl) {
      const original = make('a', 'primary-button', 'Open Streetli record ↗');
      original.href = streetliUrl; original.target = '_blank'; original.rel = 'noopener noreferrer'; links.append(original);
    }
    const webSearch = make('a', streetliUrl ? 'secondary-button' : 'primary-button', 'Open web search ↗');
    if (feed?.mode === 'fixture') { webSearch.setAttribute('aria-disabled', 'true'); webSearch.textContent = 'Web search unavailable for fixtures'; }
    else {
      const searchUrl = new URL('https://www.google.com/search');
      const organization = item.organization.name === 'Historical provider (identity unavailable)' ? '' : ` "${item.organization.name}"`;
      searchUrl.searchParams.set('q', `"${item.identifier.value}"${organization}`);
      webSearch.href = searchUrl.href; webSearch.target = '_blank'; webSearch.rel = 'noopener noreferrer';
    }
    links.append(webSearch);
    const instructionsId = 'selected-report-steps';
    const toggle = make('button', 'report-toggle'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', instructionsId);
    toggle.append(make('span', '', 'View reporting steps'), make('span', '', '+'));
    const stepsBox = make('div'); stepsBox.id = instructionsId; stepsBox.hidden = true;
    const steps = make('ol', 'report-steps');
    const guidance = item.identifier.kind === 'website' ? [
      'Find a public listing that still presents this website as the provider’s current website. Open the page and verify the exact organization and branch.',
      'Collect the listing URL, the relevant quotation, and the observation time. Independently verify any replacement website with an official provider source.',
      'Use the directory’s correction contact, or Suggest an edit on the matching Google Maps listing. Request a website correction while preserving the real provider listing.',
      'If the destination appears repurposed, separate that observation from an abuse allegation. A registrar or hosting report needs evidence that meets the recipient’s policy; a changed category alone is insufficient.'
    ] : item.identifier.kind === 'phone' ? [
      'Check a public directory or provider page for the exact old number and the correct organization or branch.',
      'Use current official contact information to establish a supported correction. A former disconnected number may since have been reassigned; do not call it as part of this review.',
      'Use the directory’s correction form or Suggest an edit on the matching Maps listing. Include the old value, source page, observation time, and a verified replacement if available.',
      'Keep a submission receipt separate from a confirmed correction. Reopen the public listing later to verify its displayed contact information.'
    ] : [
      'Find a current public page associating the exact email address with this provider. Confirm whether it is a public contact, referral, or a historical staff listing.',
      'Check current official provider contact information. A past delivery or risk flag alone does not prove that the mailbox is invalid today; do not email the flagged address to test it.',
      'Ask the page operator to review or correct the contact association. Include the public page URL, exact quotation, observation time, and supported replacement if available.',
      'Track the request as submitted until a new check of the page confirms the correction.'
    ];
    guidance.forEach(step => steps.append(make('li', '', step)));
    stepsBox.append(steps, make('p', 'report-status', 'No external report has been sent by this app.'));
    let reportingRequested = false;
    toggle.addEventListener('click', () => {
      const opened = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!opened)); stepsBox.hidden = opened;
      toggle.lastElementChild.textContent = opened ? '+' : '−';
      if (!opened && !reportingRequested && feed?.mode !== 'fixture') {
        reportingRequested = true;
        loadReportingPlan(item, stepsBox);
      }
    });
    elements.detail.append(kicker, make('h3', 'detail-title', item.organization.name), make('p', 'detail-locality', item.organization.locality), identifier, facts, context, links, make('p', 'detail-footnote', feed?.mode === 'fixture' ? 'Fictional example · do not report this case to a real platform.' : 'Opening web search sends this identifier and organization name to Google.'), researchSection(item), toggle, stepsBox);
  }

  // ---- Web research: You.com search + CrewAI/Parasail verification, streamed from the server ----
  const researchStates = {
    still_present: ['Still shows it', 'found'], possible_match: ['Possible match', 'maybe'],
    not_present: ['Not present', 'clear'], unknown: ['Unknown', 'unknown']
  };
  const researchErrors = {
    fixture_research_disabled: 'Live research is off for fictional fixtures.',
    research_requires_approval: 'Research runs only on cases approved for research.',
    research_runtime_missing: 'The Python research runtime is not installed. See apps/agent/README.md.',
    research_busy: 'Another research run is in progress. Try again when it finishes.',
    invalid_manual_test: 'Enter a type, an identifier, and an organization name.'
  };

  function researchSection(item) {
    const section = make('section', 'research');
    const fixture = feed?.mode === 'fixture';
    const approved = item.reviewState === 'approved_for_research';
    const button = make('button', 'primary-button research-button', 'Research the web');
    button.type = 'button';
    button.disabled = fixture || !approved;
    const note = make('p', 'research-note', fixture
      ? 'Live research is off for fictional fixtures. Use the pipeline test below the queue to watch a real run.'
      : !approved ? 'Research runs only on cases approved for research.'
      : 'Searches You.com for this identifier, then a CrewAI agent on Parasail checks each page. Nothing is sent.');
    const output = make('div', 'research-output');
    button.addEventListener('click', () => runResearch(`/api/research?caseId=${encodeURIComponent(item.id)}`, {}, output, button));
    section.append(make('div', 'eyebrow', 'Web research'), button, note, output);
    return section;
  }

  function progressItem(event) {
    const row = make('li', `research-step step-${event.status}`);
    row.append(make('span', 'step-icon', ({ done: '✓', start: '…', error: '✗' })[event.status] || '·'), make('span', 'step-name', event.step), make('span', 'step-message', event.message));
    return row;
  }

  async function runResearch(url, body, output, button) {
    const label = button.textContent;
    button.disabled = true; button.textContent = 'Researching…';
    const live = make('p', 'research-live', 'Starting research…');
    live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    const progress = make('ol', 'research-progress');
    output.replaceChildren(live, progress);
    let result = null; let failure = null;
    const handle = line => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'event') { progress.append(progressItem(message)); live.textContent = message.message; }
      else if (message.type === 'result') result = message;
      else if (message.type === 'error') failure = message.message;
    };
    try {
      const response = await fetch(url, { method: 'POST', cache: 'no-store', headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(researchErrors[payload.error] || `Research is unavailable (${payload.error || response.status}).`);
      }
      if (response.body?.getReader && typeof TextDecoder === 'function') {
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split('\n'); buffer = lines.pop();
          lines.forEach(handle);
          if (done) { handle(buffer); break; }
        }
      } else (await response.text()).split('\n').forEach(handle);
    } catch (error) { failure = error.message || 'Research failed.'; }
    finally { button.disabled = false; button.textContent = label; }
    if (result) {
      live.textContent = result.stopped ? 'Research stopped before searching.' : 'Research finished. Review the evidence before any correction request.';
      output.append(renderResearchResult(result));
    }
    if (failure) output.append(make('p', 'research-error', failure));
    if (!result && !failure) output.append(make('p', 'research-error', 'Research ended without a result.'));
  }

  function renderResearchResult(result) {
    const box = make('div', 'research-result');
    const flags = make('div', 'research-flags');
    if (result.manualTest) flags.append(make('span', 'research-flag test', 'Pipeline test · not a Streetli case'));
    if (result.placeholderPrompts) flags.append(make('span', 'research-flag', 'Placeholder prompts · pending review'));
    if (flags.childNodes.length) box.append(flags);
    if (result.stopped) { box.append(make('p', 'research-error', result.stopped)); return box; }
    const refs = Array.isArray(result.externalReferences) ? result.externalReferences.slice(0, 20) : [];
    const count = state => refs.filter(ref => ref.state === state).length;
    box.append(make('p', 'research-summary', refs.length
      ? `${refs.length} pages checked · ${count('still_present')} still show it · ${count('possible_match')} possible · ${count('not_present')} not present · ${count('unknown')} unknown`
      : 'No candidate pages were found. An empty search does not prove the identifier is gone from the web.'));
    for (const ref of refs) {
      const [title, tone] = researchStates[ref.state] || ['Unknown', 'unknown'];
      const card = make('div', `evidence evidence-${tone}`);
      const head = make('div', 'evidence-head');
      head.append(make('span', `evidence-state ${tone}`, title), externalAnchor(`${ref.url} ↗`, ref.url, 'evidence-link') || make('span', 'evidence-link', ref.url));
      card.append(head);
      if (ref.quote) card.append(make('blockquote', 'evidence-quote', `“${ref.quote}”`));
      if (result.notes?.[ref.url]) card.append(make('p', 'evidence-note', result.notes[ref.url]));
      card.append(make('p', 'evidence-meta', `Checked ${checkedTime(ref.observedAt)} · report: ${String(ref.reportState || 'not_started').replace(/_/g, ' ')}`));
      const draft = result.drafts?.[ref.url];
      if (draft) {
        const panel = make('div', 'draft');
        panel.append(make('div', 'eyebrow', draft.testOnly ? 'Correction draft · test only, do not send' : 'Correction draft · not sent'), make('p', 'draft-message', draft.message), make('p', 'draft-how', draft.how_to_submit));
        card.append(panel);
      }
      box.append(card);
    }
    box.append(make('p', 'report-status', 'No report or message has been sent by this app. A reviewer decides what to submit.'));
    return box;
  }

  const pipeline = { form: $('pipeline-form'), kind: $('pipeline-kind'), value: $('pipeline-value'), org: $('pipeline-org'), locality: $('pipeline-locality'), submit: $('pipeline-submit'), output: $('pipeline-output') };
  if (pipeline.form) pipeline.form.addEventListener('submit', event => {
    event.preventDefault();
    runResearch('/api/research/test', { kind: pipeline.kind.value, value: pipeline.value.value, organization: pipeline.org.value, locality: pipeline.locality.value }, pipeline.output, pipeline.submit);
  });

  async function loadReportingPlan(item, container) {
    const status = make('p', 'report-lookup-status', item.identifier.kind === 'website' ? 'Looking up the current registrar and reporting routes…' : 'Loading reporting routes…');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    container.prepend(status);
    const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 25000);
    try {
      let plan = reportingPlans.get(item.id);
      if (!plan) {
        const response = await fetch(`/api/reporting?caseId=${encodeURIComponent(item.id)}`, { cache: 'no-store', signal: abort.signal, headers: { Accept: 'application/json' } });
        const payload = await response.json();
        if (!response.ok || payload?.caseId !== item.id || !Array.isArray(payload.routes)) throw new Error('reporting_unavailable');
        plan = payload; reportingPlans.set(item.id, plan);
      }
      const content = make('div', 'reporting-plan');
      if (plan.summary) content.append(make('p', 'report-summary', plan.summary));
      if (item.identifier.kind === 'website') {
        const registration = plan.registration;
        const registrar = make('section', 'registrar-info');
        registrar.append(make('div', 'eyebrow', 'Domain registration'));
        const identified = registration?.status === 'identified' && registration.registrarName;
        registrar.append(make('h4', 'registrar-name', identified ? registration.registrarName : 'Registrar not identified'));
        if (registration?.domain) registrar.append(make('p', 'registrar-domain', registration.domain));
        if (registration?.checkedAt) registrar.append(make('p', 'registrar-checked', `Registration checked ${checkedTime(registration.checkedAt)}`));
        if (registration?.notice) registrar.append(make('p', 'registrar-notice', registration.notice));
        else registrar.append(make('p', 'registrar-notice', 'The registrar and hosting provider can be different companies. Registration information does not prove abuse.'));
        const registrarLinks = make('div', 'registrar-links');
        const source = externalAnchor('View registration source ↗', registration?.sourceUrl);
        if (source) registrarLinks.append(source);
        if (registration?.abuseEmail) {
          const abuse = externalAnchor(`Registrar abuse contact: ${registration.abuseEmail}`, `mailto:${registration.abuseEmail}`);
          if (abuse) registrarLinks.append(abuse);
        }
        if (registrarLinks.childNodes.length) registrar.append(registrarLinks);
        content.append(registrar);
      }
      for (const route of plan.routes.slice(0, 10)) {
        const panel = make('section', 'report-route');
        const heading = externalAnchor(`${route.title || 'Reporting guidance'} ↗`, route.url);
        const title = make('h4', 'route-title'); title.append(heading || make('span', '', route.title || 'Reporting guidance')); panel.append(title);
        if (route.scope) panel.append(make('span', 'route-scope', ({ listing_correction: 'Listing correction', search_report: 'Search report', domain_abuse: 'Abuse report · evidence required' })[route.scope] || route.scope));
        if (Array.isArray(route.requirements) && route.requirements.length) {
          const required = make('ul', 'route-requirements');
          route.requirements.slice(0, 8).forEach(value => required.append(make('li', '', String(value))));
          panel.append(required);
        }
        if (Array.isArray(route.steps) && route.steps.length) {
          const steps = make('ol', 'report-steps'); route.steps.slice(0, 10).forEach(value => steps.append(make('li', '', String(value)))); panel.append(steps);
        }
        content.append(panel);
      }
      content.append(make('p', 'report-status', 'Opening a reporting page does not submit a report. No external report has been sent by this app.'));
      container.replaceChildren(content);
    } catch {
      status.textContent = item.identifier.kind === 'website' ? 'Registrar lookup is unavailable. The general correction steps below still apply.' : 'Specific reporting routes could not be loaded. The general correction steps below still apply.';
      status.classList.add('lookup-unavailable');
      if (item.identifier.kind === 'website') {
        const lookup = externalAnchor('Check registration with ICANN Lookup ↗', 'https://lookup.icann.org/');
        if (lookup) status.append(document.createTextNode(' '), lookup);
      }
    } finally { clearTimeout(timeout); }
  }

  async function loadCases(refresh = false) {
    if (busy) return;
    busy = true; loadFailed = false; elements.refresh.disabled = true;
    elements.refresh.textContent = refresh ? 'Refreshing…' : 'Loading…';
    setBanner(refresh ? 'Refreshing retained records from the configured source…' : 'Loading historical records from the configured source…', 'loading');
    renderList();
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 100000);
    try {
      const response = await fetch(refresh ? '/api/refresh' : '/api/cases', { method: refresh ? 'POST' : 'GET', cache: 'no-store', signal: abort.signal, headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Source returned HTTP ${response.status}`);
      if (!payload || ![1, 2].includes(payload.schemaVersion) || !Array.isArray(payload.cases)) throw new Error('The source returned an unsupported case format.');
      feed = payload;
      items = payload.cases.filter(item => item?.id && item?.organization && item?.identifier && item?.internal);
      if (!stateChosen && payload.schemaVersion === 2 && payload.mode === 'live' && items.some(item => ['removed', 'replaced'].includes(item.internal.state))) activeState = 'removed';
      reportingPlans.clear();
      renderSource();
    } catch (error) {
      loadFailed = true;
      const message = error.name === 'AbortError' ? 'The source took too long to respond. Check the local adapter and refresh.' : 'The record source is unavailable. Check the local Streetli adapter and refresh.';
      setBanner(`${message}${feed ? ' Previously loaded records remain visible with their earlier timestamp.' : ' No fictional data has been substituted.'}`, 'error');
      elements.source.textContent = feed ? `${feed.mode === 'fixture' ? 'Fixture' : 'Streetli'} source unavailable` : 'Source unavailable';
    } finally {
      clearTimeout(timeout); busy = false; elements.refresh.disabled = false;
      elements.refresh.replaceChildren(make('span', '', '↻'), document.createTextNode(' Refresh records'));
      renderList();
    }
  }

  elements.form.addEventListener('submit', event => { event.preventDefault(); query = elements.input.value; visibleCount = 30; renderList(); });
  elements.input.addEventListener('input', () => { query = elements.input.value; visibleCount = 30; renderList(); });
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { elements.input.value = button.dataset.prompt; query = button.dataset.prompt; activeKind = 'all'; visibleCount = 30; renderList(); }));
  document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => { activeKind = button.dataset.kind; visibleCount = 30; renderList(); }));
  document.querySelectorAll('[data-history-state]').forEach(button => button.addEventListener('click', () => { activeState = button.dataset.historyState; stateChosen = true; visibleCount = 30; renderList(); }));
  elements.more.addEventListener('click', () => { visibleCount += 30; renderList(); });
  elements.refresh.addEventListener('click', () => loadCases(true));
  loadCases();
})();
