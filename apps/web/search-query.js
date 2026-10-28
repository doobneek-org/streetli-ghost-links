// Builds the human "Open web search" query.
//
// A flagged phone is stored in E.164 (+16466016040), which no directory publishes, so
// quoting it on a keyword engine matches nothing. Directories print (646) 601-6040 or
// 646-601-6040, so the same OR-ed variants the discovery planner uses are produced here.
// Kept in sync with packages/contracts/discovery-plan.mjs by a test; this file is a plain
// script because the page's app.js is not a module and cannot import from packages/.
(() => {
  'use strict';

  const UNKNOWN_PROVIDER = 'Historical provider (identity unavailable)';
  const EXCLUDED_DOMAINS = ['gogetta.nyc'];
  const quote = value => `"${String(value).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;

  // Only North American numbers have a known printed layout; anything else stays exact.
  function phoneVariants(value) {
    const parsed = String(value || '').match(/^\+1(\d{3})(\d{3})(\d{4})$/);
    if (!parsed) return null;
    const [, area, exchange, subscriber] = parsed;
    return [`${area}-${exchange}-${subscriber}`, `(${area}) ${exchange}-${subscriber}`, `${area} ${exchange} ${subscriber}`];
  }

  function build(item) {
    const value = item?.identifier?.value || '';
    const variants = item?.identifier?.kind === 'phone' ? phoneVariants(value) : null;
    const core = variants ? `(${variants.map(quote).join(' OR ')})` : quote(value);
    const name = item?.organization?.name;
    const organization = name && name !== UNKNOWN_PROVIDER ? ` ${quote(name)}` : '';
    return `${core}${organization}${EXCLUDED_DOMAINS.map(domain => ` -site:${domain}`).join('')}`;
  }

  window.ghostLinksSearchQuery = { build, phoneVariants };
})();
