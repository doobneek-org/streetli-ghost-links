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

  // ---- Halloween mode: spooky colors and wording. Evidence, quotes and safety notes stay plain. ----
  let spooky = false;
  try { spooky = localStorage.getItem('ghost-links-halloween') === 'on'; } catch { spooky = false; }
  const t = (normal, haunted) => spooky ? haunted : normal;
  let hunterName = '';
  try { hunterName = localStorage.getItem('ghost-links-hunter') || ''; } catch { hunterName = ''; }
  let board = [];
  const rankTitle = points => points >= 100 ? '⭐ Spectral Superhero' : points >= 30 ? '🦸 Poltergeist Wrangler' : points >= 10 ? '👻 Ghost Buster' : '🕯 Rookie Hunter';

  // Leaderboard: Halloween mode only. Counts reviewer decisions recorded in this app.
  function renderLeaderboard() {
    const section = $('leaderboard');
    if (!section) return;
    section.hidden = !spooky;
    if (!spooky) return;
    const title = make('h3', 'leaderboard-title', '🏆 Leading Ghost Busters');
    title.id = 'leaderboard-title';
    const nameRow = make('form', 'hunter-form');
    const name = make('input', 'decision-note');
    name.type = 'text'; name.maxLength = 40; name.value = hunterName; name.placeholder = 'Your ghost-hunter name';
    name.setAttribute('aria-label', 'Your ghost-hunter name');
    const save = make('button', 'secondary-button', hunterName ? 'Rename' : 'Join the hunt'); save.type = 'submit';
    nameRow.append(name, save);
    nameRow.addEventListener('submit', event => {
      event.preventDefault();
      const value = String(name.value || '').trim().slice(0, 40);
      if (value && !/^[\p{L}\p{N} ._'-]+$/u.test(value)) { name.value = hunterName; return; }
      hunterName = value;
      try { localStorage.setItem('ghost-links-hunter', hunterName); } catch { /* optional */ }
      renderLeaderboard();
    });
    const list = make('ol', 'leaderboard-list');
    if (!board.length) list.append(make('li', 'leaderboard-empty', 'No ghosts busted yet. Pick a record below and make the first bust.'));
    board.slice(0, 10).forEach((entry, index) => {
      const row = make('li', `leaderboard-row${entry.name === hunterName ? ' is-you' : ''}`);
      row.append(make('span', 'leader-rank', ['🥇', '🥈', '🥉'][index] || `#${index + 1}`),
        make('span', 'leader-name', entry.name === hunterName ? `${entry.name} (you)` : entry.name),
        make('span', 'leader-title', rankTitle(entry.points)),
        make('span', 'leader-stats', `${entry.resolved} busted · ${entry.notAnIssue} false alarms · ${entry.followUp} watching`),
        make('span', 'leader-points', `${entry.points} pts`));
      list.append(row);
    });
    section.replaceChildren(title, make('p', 'research-note', hunterName ? `Hunting as ${hunterName}. Every decision you record counts toward your rank.` : 'Set a hunter name so your busts count toward the board.'), nameRow, list,
      make('p', 'evidence-meta', 'Points: busted 10 · false alarm 3 · keep watching 1. Ranks: Rookie Hunter → Ghost Buster (10) → Poltergeist Wrangler (30) → Spectral Superhero (100). Counts reviewer decisions recorded in this app, not verified external corrections.'));
  }
  const spookyCategories = {
    all: ['All haunted records', 'Every restless record'], 'still-online': ['Ghosts still haunting the web', 'Old contacts other sites still show, with quotes'],
    compromise: ['Possessed links', 'Scam content, hijacked, repurposed or parked domains'], website: ['Dead links', 'Pages that no longer load'],
    phone: ['Phantom numbers', 'Numbers flagged disconnected'], email: ['Lost souls (emails)', 'Addresses that bounce into the void'],
    scan: ['Restless spirits', 'Former links a past scan saw'], other: ['Things that go bump', 'Other flagged contacts']
  };
  const spookyVerdicts = { stale_reference: 'Still haunting', historical_mention: 'Faded echo', different_entity: 'Wrong spirit',
    not_present: 'Not seen on checked pages', uncertain: 'Murky', error: 'Séance failed' };
  const verdictText = verdict => t(verdictLabels[verdict]?.[0] || 'Unknown', spookyVerdicts[verdict] || 'Unknown');
  const originalText = new Map();
  function applySpooky() {
    const root = document.documentElement;
    if (root?.setAttribute) root.setAttribute('data-halloween', spooky ? 'on' : 'off');
    document.querySelectorAll('[data-spooky]').forEach(node => {
      if (!originalText.has(node)) originalText.set(node, [...node.childNodes]);
      if (spooky) node.textContent = node.getAttribute('data-spooky'); else node.replaceChildren(...originalText.get(node));
    });
    document.querySelectorAll('[data-spooky-placeholder]').forEach(node => {
      if (!originalText.has(node)) originalText.set(node, node.getAttribute('placeholder'));
      node.setAttribute('placeholder', spooky ? node.getAttribute('data-spooky-placeholder') : originalText.get(node));
    });
    const submit = $('search-submit');
    if (submit) { const arrow = make('span', '', '↗'); arrow.setAttribute('aria-hidden', 'true'); submit.replaceChildren(document.createTextNode(t('Ask ', 'Summon ')), arrow); }
    const toggle = $('halloween-toggle');
    if (toggle) { toggle.setAttribute('aria-pressed', String(spooky)); toggle.textContent = spooky ? '☀️ Normal mode' : '🎃 Halloween mode'; }
    renderLeaderboard();
  }
  const halloweenToggle = $('halloween-toggle');
  if (halloweenToggle) halloweenToggle.addEventListener('click', () => {
    spooky = !spooky;
    try { localStorage.setItem('ghost-links-halloween', spooky ? 'on' : 'off'); } catch { /* preference is optional */ }
    applySpooky();
    if (feed) renderList();
  });

  // ---- Maintainer dashboard: failed verifications grouped by category ----
  const categories = [
    { id: 'compromise', title: 'Possible compromise', tone: 'found', detail: 'Scam content, suspected takeover, repurposed or parked domains',
      codes: ['website_scam_content', 'website_suspected_compromise', 'website_repurposed', 'website_domain_parked'] },
    { id: 'website', title: 'Broken websites', tone: 'maybe', detail: 'Pages that no longer load', codes: ['website_not_found'] },
    { id: 'phone', title: 'Bad phone numbers', tone: 'maybe', detail: 'Numbers flagged disconnected', codes: ['phone_disconnected'] },
    { id: 'email', title: 'Bad emails', tone: 'maybe', detail: 'Addresses or domains that fail delivery checks', codes: ['email_invalid', 'email_domain_no_mx'] },
    { id: 'scan', title: 'Historical scan leads', tone: 'unknown', detail: 'Former website links a past scan saw; may still be listed elsewhere', codes: ['scan_historical_reference'] },
    { id: 'other', title: 'Other flags', tone: 'unknown', detail: 'Invalid, risky or manually flagged contacts', codes: [] }
  ];
  const compromiseRank = ['website_scam_content', 'website_suspected_compromise', 'website_repurposed', 'website_domain_parked'];
  const categoryOf = item => {
    const known = categories.find(category => category.codes.includes(item.internal.reasonCode))?.id;
    if (known) return known;
    // Other saved automated website findings are treated as possible compromise until reviewed.
    return item.internal.source === 'saved_scan' && item.identifier.kind === 'website' ? 'compromise' : 'other';
  };
  const normalDecisionLabels = { resolved: 'Resolved by reviewer', not_an_issue: 'Not an issue', follow_up: 'Needs follow-up' };
  const spookyDecisionLabels = { resolved: 'Busted 👻', not_an_issue: 'False alarm', follow_up: 'Keep watching 👁' };
  const decisionLabels = new Proxy({}, { get: (_, key) => (spooky ? spookyDecisionLabels : normalDecisionLabels)[key] });
  let activeCategory = 'all';
  let hideDecided = false;
  let decisions = {};
  let findings = {};
  let eligibleIds = new Set();
  let askFilter = null;
  const verdictLabels = { stale_reference: ['Still listed online', 'found'], historical_mention: ['Old mention only', 'clear'], different_entity: ['Different organization', 'clear'], not_present: ['Not found on checked pages', 'clear'], uncertain: ['Inconclusive', 'unknown'], error: ['Check failed', 'unknown'] };

  function renderBoard() {
    const board = $('category-board');
    if (!board) return;
    const open = list => list.filter(item => !decisions[item.id] || decisions[item.id].decision === 'follow_up').length;
    const card = (id, title, detail, tone, list) => {
      const button = make('button', `category-card tone-${tone}`);
      button.type = 'button'; button.setAttribute('data-category', id);
      button.setAttribute('aria-pressed', String(activeCategory === id));
      const [spookyTitle, spookyDetail] = spookyCategories[id] || [title, detail];
      button.append(make('span', 'category-title', t(title, spookyTitle)), make('span', 'category-count', number(open(list))),
        make('span', 'category-detail', `${t(detail, spookyDetail)} · ${number(list.length - open(list))} ${t('decided', 'laid to rest')}`));
      button.addEventListener('click', () => { activeCategory = activeCategory === id ? 'all' : id; visibleCount = 30; renderList(); });
      return button;
    };
    const cards = [card('all', 'All open flags', 'Everything loaded', 'all', items)];
    for (const category of categories) {
      const list = items.filter(item => categoryOf(item) === category.id);
      if (list.length || category.id === 'compromise') cards.push(card(category.id, category.title, category.detail, category.tone, list));
    }
    if (feed?.mode === 'live') cards.splice(1, 0, card('still-online', 'Risky links still online', 'Old contacts other sites still show, with quotes', 'found', items.filter(item => findings[item.id]?.verdict === 'stale_reference')));
    const toggle = make('button', 'secondary-button hide-decided', hideDecided ? t('Show decided records', 'Show the laid-to-rest') : t('Hide decided records', 'Hide the laid-to-rest'));
    toggle.type = 'button'; toggle.setAttribute('aria-pressed', String(hideDecided));
    toggle.addEventListener('click', () => { hideDecided = !hideDecided; visibleCount = 30; renderList(); });
    const discover = make('button', 'secondary-button', feed?.mode === 'live' ? t('Run discovery (next 3 due)', 'Send out the ghost hunters (next 3)') : t('Discovery needs live data', 'Ghost hunters need live data'));
    discover.type = 'button'; discover.disabled = feed?.mode !== 'live';
    discover.addEventListener('click', () => runResearch('/api/discovery/run', { maxJobs: 3 }, $('discovery-output'), discover, renderDiscoveryResult));
    board.replaceChildren(...cards, toggle, discover);
  }

  async function loadDecisions() {
    try {
      const response = await fetch('/api/review-actions', { cache: 'no-store', headers: { Accept: 'application/json' } });
      const payload = await response.json();
      decisions = response.ok && payload?.mode === feed?.mode && payload.actions && typeof payload.actions === 'object' ? payload.actions : {};
      board = response.ok && Array.isArray(payload?.leaderboard) ? payload.leaderboard : [];
      renderLeaderboard();
    } catch { decisions = {}; }
    await loadFindings(false);
    renderList();
  }

  async function loadFindings(render = true) {
    if (feed?.mode !== 'live') { findings = {}; eligibleIds = new Set(); return; }
    try {
      const response = await fetch('/api/discovery/findings', { cache: 'no-store', headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (response.ok && payload?.mode === 'live') { findings = payload.findings || {}; eligibleIds = new Set(payload.eligibleCaseIds || []); }
    } catch { /* keep previous findings */ }
    if (render) renderList();
  }

  function reviewSection(item) {
    const section = make('section', 'review-decision');
    const current = decisions[item.id];
    section.append(make('div', 'eyebrow', 'Reviewer decision'));
    section.append(make('p', 'research-note', current
      ? `${decisionLabels[current.decision] || current.decision} · ${checkedTime(current.at)}${current.note ? ` · “${current.note}”` : ''}`
      : 'Open. Record what you found; this does not edit Streetli or mark a correction verified.'));
    const note = make('input', 'decision-note');
    note.type = 'text'; note.maxLength = 300; note.placeholder = 'Optional note, e.g. “Directory fixed after edit request”';
    note.setAttribute('aria-label', 'Decision note');
    const buttons = make('div', 'decision-buttons');
    const status = make('p', 'research-note');
    const choose = async decision => {
      buttons.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try {
        const response = await fetch('/api/review-actions', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ caseId: item.id, decision, note: note.value || '', by: hunterName }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'save_failed');
        if (payload.action) decisions[item.id] = payload.action; else delete decisions[item.id];
        if (Array.isArray(payload.leaderboard)) { board = payload.leaderboard; renderLeaderboard(); }
        renderList();
        if (spooky && decision === 'resolved') setBanner(`👻 Ghost busted${hunterName ? ` by ${hunterName}` : ''}! +10 points.`, 'ready');
      } catch { status.textContent = 'The decision could not be saved. Try again.'; buttons.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
    };
    const options = current ? [['open', 'Reopen']] : [['resolved', t('Mark resolved', 'Busted 👻 (resolved)')], ['not_an_issue', t('Not an issue', 'False alarm')], ['follow_up', t('Needs follow-up', 'Keep watching')]];
    for (const [decision, label] of options) {
      const button = make('button', decision === 'resolved' ? 'primary-button' : 'secondary-button', label);
      button.type = 'button';
      button.addEventListener('click', () => choose(decision));
      buttons.append(button);
    }
    if (!current) section.append(note);
    section.append(buttons, status);
    return section;
  }

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
      if (askFilter && !askFilter.has(item.id)) return false;
      if (activeCategory === 'still-online' ? findings[item.id]?.verdict !== 'stale_reference' : activeCategory !== 'all' && categoryOf(item) !== activeCategory) return false;
      if (hideDecided && decisions[item.id] && decisions[item.id].decision !== 'follow_up') return false;
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
    renderBoard();
    const queryMatches = filteredByQuery();
    const matchesState = (item, target) => target === 'all' || (target === 'removed' ? ['removed', 'replaced'].includes(item.internal.state) : item.internal.state === 'flagged');
    const stateMatches = queryMatches.filter(item => matchesState(item, activeState));
    const matches = activeKind === 'all' ? stateMatches : stateMatches.filter(item => item.identifier.kind === activeKind);
    // In the compromise view, the most severe signals come first.
    if (activeCategory === 'compromise') matches.sort((a, b) => (compromiseRank.indexOf(a.internal.reasonCode) + 1 || 9) - (compromiseRank.indexOf(b.internal.reasonCode) + 1 || 9));
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
      const flags = make('span', 'record-flags');
      if (categoryOf(item) === 'compromise') flags.append(make('span', 'record-flag risk', 'Compromise risk'));
      const finding = findings[item.id];
      if (finding && verdictLabels[finding.verdict]) flags.append(make('span', `record-flag verdict-${verdictLabels[finding.verdict][1]}`, verdictText(finding.verdict)));
      if (decisions[item.id]) flags.append(make('span', `record-flag decided-${decisions[item.id].decision}`, decisionLabels[decisions[item.id].decision] || 'Decided'));
      if (flags.childNodes.length) button.append(flags);
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
    elements.detail.append(kicker, make('h3', 'detail-title', item.organization.name), make('p', 'detail-locality', item.organization.locality), identifier, facts, context, links, make('p', 'detail-footnote', feed?.mode === 'fixture' ? 'Fictional example · do not report this case to a real platform.' : 'Opening web search sends this identifier and organization name to Google.'), findingSection(item), reviewSection(item), researchSection(item), toggle, stepsBox);
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
    invalid_manual_test: 'Enter a type, an identifier, and an organization name.',
    invalid_request_text: 'Type a request of 3–300 characters.',
    invalid_event_text: 'Describe the event and the place in a sentence (8–300 characters).'
  };

  function researchSection(item) {
    const section = make('section', 'research');
    const fixture = feed?.mode === 'fixture';
    const approved = item.reviewState === 'approved_for_research' || eligibleIds.has(item.id);
    const button = make('button', 'primary-button research-button', findings[item.id] ? t('Research again', 'Hunt again') : t('Research the web', 'Hunt this ghost'));
    button.type = 'button';
    button.disabled = fixture || !approved;
    const note = make('p', 'research-note', fixture
      ? 'Live research is off for fictional fixtures. Use the pipeline test below the queue to watch a real run.'
      : !approved ? 'This record is outside the automatic discovery scope (for example, the provider identity is unknown).'
      : 'Runs this record\'s discovery job: You.com search and fetch, then a CrewAI agent on Parasail with the verify-reference prompt. Results within 24 hours come from cache. Nothing is sent.');
    const output = make('div', 'research-output');
    button.addEventListener('click', () => runResearch(`/api/research?caseId=${encodeURIComponent(item.id)}`, {}, output, button, renderDiscoveryResult));
    section.append(make('div', 'eyebrow', 'Web research'), button, note, output);
    return section;
  }

  function progressItem(event) {
    const row = make('li', `research-step step-${event.status}`);
    row.append(make('span', 'step-icon', ({ done: '✓', start: '…', error: '✗' })[event.status] || '·'), make('span', 'step-name', event.step), make('span', 'step-message', event.message));
    return row;
  }

  async function runResearch(url, body, output, button, render = renderResearchResult) {
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
      live.textContent = result.kind === 'event' || result.kind === 'find'
        ? (result.stopped ? 'Service search stopped.' : 'Done. Call ahead before sending anyone.')
        : result.kind === 'ask' ? 'Done. Matching records are shown in the queue below.'
        : result.kind === 'unsupported' ? 'That request is outside what Ghost Links can do.'
        : result.stopped ? 'Research stopped before searching.' : 'Research finished. Review the evidence before any correction request.';
      output.append(render(result));
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

  // ---- Discovery findings (Ivan's planner jobs, validated with validateVerification) ----
  function findingCard(finding) {
    const tone = verdictLabels[finding.verdict]?.[1] || 'unknown';
    const title = verdictText(finding.verdict);
    const card = make('div', `evidence evidence-${tone}`);
    const head = make('div', 'evidence-head');
    head.append(make('span', `evidence-state ${tone}`, title), make('span', 'evidence-meta', `Checked ${checkedTime(finding.checkedAt)} · ${finding.pages ?? 0} pages fetched`));
    card.append(head);
    if (finding.summary) card.append(make('p', 'draft-message', finding.summary));
    for (const evidence of (finding.evidence || []).slice(0, 6)) {
      card.append(make('blockquote', 'evidence-quote', `“${evidence.quote}”`));
      const link = externalAnchor(`${String(evidence.role).replace(/_/g, ' ')} · ${evidence.url} ↗`, evidence.url, 'evidence-link');
      if (link) card.append(link);
    }
    if (finding.missingEvidence?.length) {
      const missing = make('ul', 'route-requirements');
      finding.missingEvidence.slice(0, 6).forEach(text => missing.append(make('li', '', text)));
      card.append(make('div', 'eyebrow', 'Still needed'), missing);
    }
    if (finding.gate && finding.gate !== 'passed') card.append(make('p', 'research-error', `Model output rejected by the evidence gate (${finding.gate.replace('rejected:', '')}); no claim was kept.`));
    return card;
  }

  function findingSection(item) {
    const finding = findings[item.id];
    if (!finding) return make('span');
    const section = make('section', 'research');
    section.append(make('div', 'eyebrow', 'Latest discovery result'), findingCard(finding));
    return section;
  }

  function renderDiscoveryResult(result) {
    const box = make('div', 'research-result');
    const list = Array.isArray(result.findings) ? result.findings : [];
    box.append(make('p', 'research-summary', result.plan
      ? `${result.plan.ran} job(s) ran · ${result.plan.due} were due · ${result.plan.skipped?.freshCache || 0} fresh in cache · ${result.plan.eligible} eligible records`
      : 'Discovery finished.'));
    if (!list.length) box.append(make('p', 'research-note', result.plan?.ran === 0 ? 'Nothing was due: results under 24 hours old are reused from cache.' : 'No findings were produced.'));
    list.slice(0, 10).forEach(finding => box.append(findingCard(finding)));
    box.append(make('p', 'report-status', 'Findings are cited research leads, not confirmed errors. No report or message has been sent.'));
    loadFindings();
    return box;
  }

  // ---- Ask: "find me food services that may be at risk" ----
  function renderAskResult(result) {
    const box = make('div', 'research-result');
    const flags = make('div', 'research-flags');
    flags.append(make('span', 'research-flag', 'Request planner prompt · pending review'));
    box.append(flags);
    if (result.plan?.explanation) box.append(make('p', 'research-summary', result.plan.explanation));
    if (result.plan?.serviceTerms?.length) box.append(make('p', 'research-note', `Matched names containing: ${result.plan.serviceTerms.join(', ')}`));
    askFilter = new Set(result.matchedIds || []);
    activeCategory = 'all'; visibleCount = 30;
    box.append(make('p', 'event-title', `${number(result.matched || 0)} matching records shown in the queue below`));
    if (result.selection?.caseIds?.length) {
      box.append(make('div', 'eyebrow', t('Research these first', 'Hunt these first')));
      if (result.selection.explanation) box.append(make('p', 'research-note', result.selection.explanation));
      for (const id of result.selection.caseIds) {
        const item = items.find(candidate => candidate.id === id);
        if (!item) continue;
        const open = make('button', 'secondary-button', `${item.organization.name} · ${item.identifier.value}`);
        open.type = 'button';
        open.addEventListener('click', () => { selectedId = id; renderList(); elements.detail.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        box.append(open);
      }
    } else if (result.selectionGate) box.append(make('p', 'research-note', 'The research shortlist was rejected by the output gate; review the filtered records directly.'));
    const clear = make('button', 'secondary-button', t('Clear this request', 'Banish this request'));
    clear.type = 'button';
    clear.addEventListener('click', () => { askFilter = null; $('route-output').replaceChildren(); renderList(); });
    box.append(clear);
    renderList();
    return box;
  }
  const ask = { form: $('ask-form'), input: $('ask-input'), submit: $('ask-submit'), output: $('ask-output') };
  if (ask.form) ask.form.addEventListener('submit', event => {
    event.preventDefault();
    runResearch('/api/ask', { request: ask.input.value }, ask.output, ask.submit, renderAskResult);
  });

  // ---- Event check: which nearby services can still help after an event ----
  const eventStatus = {
    reported_closed: ['Reported closed', 'found'], reported_relocated: ['Reported moved', 'found'],
    reported_changed_hours: ['Reported changed hours', 'maybe'], unclear: ['Notice found · unclear', 'maybe'],
    reported_operating: ['Reported open', 'clear'], no_notice_found: ['No closure notice found', 'unknown']
  };
  const listedDate = value => { const parsed = value ? new Date(value) : null; return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''; };
  const hostOf = value => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return 'source'; } };

  function serviceCard(service) {
    const [title, tone] = eventStatus[service.status] || ['Unknown', 'unknown'];
    const card = make('div', `evidence evidence-${tone}`);
    const head = make('div', 'evidence-head');
    head.append(make('span', `evidence-state ${tone}`, title), make('strong', 'service-name', service.name));
    card.append(head);
    const contact = [service.address, service.phone].filter(Boolean).join(' · ');
    if (contact) card.append(make('p', 'service-address', contact));
    if (Array.isArray(service.checks) && service.checks.length) {
      const risky = service.checks.filter(check => check.state === 'at_risk').length;
      const confirmed = service.checks.filter(check => check.state === 'confirmed').length;
      card.append(make('div', 'eyebrow', risky ? `${t('What we checked', 'What the spirits revealed')} · ${risky} may be at risk` : `${t('What we checked', 'What the spirits revealed')} · ${confirmed} confirmed`));
      const list = make('ul', 'checks');
      for (const check of service.checks.slice(0, 8)) {
        const row = make('li', `check check-${check.state}`);
        row.append(make('span', 'check-icon', ({ confirmed: '✓', listed: '◐', at_risk: '⚠', missing: '—' })[check.state] || '·'),
          make('span', 'check-field', check.field), make('span', 'check-detail', check.detail));
        if (check.listedOn && check.state !== 'missing') {
          const source = externalAnchor(`${hostOf(check.listedOn)}${check.listedOnAge ? ` · ${listedDate(check.listedOnAge)}` : ''}`, check.listedOn, 'check-source');
          if (source) row.append(source);
        }
        list.append(row);
      }
      card.append(list);
      card.append(make('p', 'evidence-meta', '✓ confirmed on the service’s own website · ◐ listed by a directory only · ⚠ may be at risk · — not available'));
    }
    if (service.quote) {
      card.append(make('blockquote', 'evidence-quote', `“${service.quote}”`));
      const source = externalAnchor(`${hostOf(service.url)} ↗`, service.url, 'evidence-link');
      if (source) card.append(source);
    }
    const listed = make('p', 'evidence-meta');
    const listing = externalAnchor(`${hostOf(service.listedOn)}${service.listedOnAge ? ` (${listedDate(service.listedOnAge)})` : ''} ↗`, service.listedOn, 'evidence-link');
    listed.append(document.createTextNode('Listed on '), listing || make('span', '', hostOf(service.listedOn)));
    if (service.website) { const site = externalAnchor('website ↗', service.website, 'evidence-link'); if (site) listed.append(document.createTextNode(' · '), site); }
    card.append(listed);
    return card;
  }

  function renderEventResult(result) {
    const box = make('div', 'research-result');
    if (result.stopped) { box.append(make('p', 'research-error', result.stopped)); return box; }
    const finding = result.kind === 'find';
    if (result.event) box.append(make('p', 'event-title', finding ? `${result.event.service_types?.join(' & ') || 'Services'} · ${result.event.area}` : `${result.event.event_type} · ${result.event.area}`));
    const services = Array.isArray(result.services) ? result.services.slice(0, 20) : [];
    const disrupted = services.filter(s => ['reported_closed', 'reported_relocated', 'reported_changed_hours'].includes(s.status));
    const available = services.filter(s => !disrupted.includes(s));
    box.append(make('p', 'research-summary', `${services.length} services found nearby · ${disrupted.length} report a disruption · checked ${checkedTime(result.observedAt)}`));
    if (disrupted.length) {
      box.append(make('div', 'eyebrow', finding ? t('Recent closure or change notices', 'Ominous notices (closed or changed)') : t('Reported disruption', 'Cursed (reported closed or changed)')));
      disrupted.forEach(s => box.append(serviceCard(s)));
    }
    if (available.length) {
      box.append(make('div', 'eyebrow', finding ? t('Services found', 'Safe havens found') : t('Likely still able to help', 'Safe havens (no closure notice found)')));
      box.append(make('p', 'research-note', 'No closure notice was found online for these. That is not proof they are open: call ahead.'));
      available.forEach(s => box.append(serviceCard(s)));
    }
    if (Array.isArray(result.news) && result.news.length) {
      const news = make('details', 'event-news');
      news.append(make('summary', '', `Recent reports (${result.news.length})`));
      const list = make('ul', 'route-requirements');
      result.news.slice(0, 6).forEach(item => {
        const row = make('li');
        row.append(externalAnchor(`${item.title} ↗`, item.url, 'evidence-link') || make('span', '', item.title));
        if (item.pageAge) row.append(document.createTextNode(` · ${listedDate(item.pageAge)}`));
        list.append(row);
      });
      news.append(list); box.append(news);
    }
    if (Array.isArray(result.areaRecords) && result.areaRecords.length) box.append(make('p', 'research-note', `${result.areaRecords.length} Streetli records are in this area and were included in the search.`));
    box.append(make('p', 'report-status', 'Statuses are what public sources report. Nothing was edited or sent.'));
    return box;
  }

  function renderRouted(result) {
    if (result.kind === 'ask') return renderAskResult(result);
    if (result.kind === 'event' || result.kind === 'find') return renderEventResult(result);
    const box = make('div', 'research-result');
    box.append(make('p', 'research-note', `${result.reason ? `${result.reason} ` : ''}Try: “food services that may be at risk”, “there was a flood on the Upper West Side”, or “food pantry in Harlem”.`));
    return box;
  }

  const eventCheck = { form: $('event-form'), input: $('event-input'), submit: $('event-submit'), output: $('event-output') };
  if (eventCheck.form) eventCheck.form.addEventListener('submit', event => {
    event.preventDefault();
    runResearch('/api/event-check', { text: eventCheck.input.value }, eventCheck.output, eventCheck.submit, renderEventResult);
  });

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
      loadDecisions();
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

  // One box: typing filters locally (above); submitting asks the router which flow should handle it.
  elements.form.addEventListener('submit', event => {
    event.preventDefault();
    const text = elements.input.value.trim();
    if (text.length < 3) { query = elements.input.value; visibleCount = 30; renderList(); return; }
    query = ''; askFilter = null; visibleCount = 30; renderList();
    runResearch('/api/route', { request: text }, $('route-output'), $('search-submit'), renderRouted);
  });
  document.querySelectorAll('[data-ask]').forEach(button => button.addEventListener('click', () => {
    elements.input.value = button.dataset.ask;
    elements.form.requestSubmit();
  }));
  elements.input.addEventListener('input', () => { query = elements.input.value; visibleCount = 30; renderList(); });
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { elements.input.value = button.dataset.prompt; query = button.dataset.prompt; activeKind = 'all'; visibleCount = 30; renderList(); }));
  document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => { activeKind = button.dataset.kind; visibleCount = 30; renderList(); }));
  document.querySelectorAll('[data-history-state]').forEach(button => button.addEventListener('click', () => { activeState = button.dataset.historyState; stateChosen = true; visibleCount = 30; renderList(); }));
  elements.more.addEventListener('click', () => { visibleCount += 30; renderList(); });
  elements.refresh.addEventListener('click', () => loadCases(true));
  applySpooky();
  loadCases();
})();
