// Inline Streetli location detail, read-only and unauthenticated.
// The data arrives same-origin from /api/location, which the Worker reads from the public
// Streetli projection, so this file needs no token and the page CSP stays connect-src 'self'.
// Everything renders through textContent; upstream markup is already stripped server-side.
(() => {
  'use strict';

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };

  // Only a plain https destination built from a bare host or absolute URL is ever linked.
  const safeWebsite = value => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
      const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
    } catch { return null; }
  };

  const when = value => {
    const date = new Date(String(value || ''));
    return Number.isNaN(date.valueOf()) ? null : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const digits = value => String(value || '').replace(/\D+/g, '');
  const lower = value => String(value || '').trim().toLowerCase();

  // The point of the app: show whether the identifier we flagged is still on the live record.
  function stillListed(item, detail) {
    const flagged = item?.identifier?.value;
    if (!flagged) return false;
    if (item.identifier.kind === 'phone') {
      const target = digits(flagged).slice(-10);
      return target.length === 10 && detail.phones.some(phone => digits(phone.number).slice(-10) === target);
    }
    if (item.identifier.kind === 'email') return lower(detail.email) === lower(flagged);
    const host = safeWebsite(flagged) && new URL(safeWebsite(flagged)).hostname.replace(/^www\./, '');
    const listed = safeWebsite(detail.website) && new URL(safeWebsite(detail.website)).hostname.replace(/^www\./, '');
    return Boolean(host && listed && host === listed);
  }

  let dialog = null, headingElement = null, bodyElement = null, controller = null;

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = make('dialog', 'location-dialog');
    dialog.setAttribute('aria-labelledby', 'location-dialog-heading');
    const header = make('div', 'location-dialog-header');
    headingElement = make('h2', 'location-dialog-heading', 'Streetli record');
    headingElement.id = 'location-dialog-heading';
    const close = make('button', 'location-dialog-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close Streetli record');
    close.addEventListener('click', () => dialog.close());
    header.append(headingElement, close);
    bodyElement = make('div', 'location-dialog-body');
    dialog.append(header, bodyElement);
    // Clicking the backdrop closes; clicks inside the panel must not.
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { controller?.abort(); controller = null; });
    document.body.append(dialog);
    return dialog;
  }

  function definition(list, term, value) {
    if (!value) return;
    list.append(make('dt', '', term), make('dd', '', value));
  }

  function render(item, detail) {
    bodyElement.replaceChildren();
    // Lead with the organization: it is what the queue listed and what the reviewer clicked.
    // A Streetli location name is often a site or neighbourhood label, e.g. "Harlem".
    headingElement.textContent = detail.organization || detail.name || 'Streetli record';

    if (detail.closed) {
      const closed = make('p', 'location-flag location-flag-closed',
        detail.closureMessage || 'This location is marked closed in Streetli.');
      bodyElement.append(closed);
    }
    if (stillListed(item, detail)) {
      bodyElement.append(make('p', 'location-flag location-flag-stale',
        `The ${item.identifier.kind} you flagged is still on this Streetli record.`));
    }

    const facts = make('dl', 'location-facts');
    // Skip the location name when it only repeats the heading or the neighbourhood below.
    if (detail.name && detail.name !== headingElement.textContent && detail.name !== detail.neighborhood) {
      definition(facts, 'Location', detail.name);
    }
    const address = [detail.address.line1, detail.address.city, detail.address.state, detail.address.postalCode].filter(Boolean).join(', ');
    definition(facts, 'Address', address);
    definition(facts, 'Neighborhood', detail.neighborhood);
    for (const phone of detail.phones) {
      definition(facts, phone.type || 'Phone', [phone.number, phone.extension && `ext. ${phone.extension}`].filter(Boolean).join(' '));
    }
    definition(facts, 'Email', detail.email);
    definition(facts, 'Last validated', when(detail.lastValidatedAt));
    if (facts.childElementCount) bodyElement.append(facts);

    const website = safeWebsite(detail.website);
    if (website) {
      const link = make('a', 'location-website', detail.website);
      link.href = website; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      bodyElement.append(link);
    }

    if (detail.services.length) {
      bodyElement.append(make('h3', 'location-services-heading', `Services (${detail.services.length})`));
      const services = make('ul', 'location-services');
      for (const service of detail.services) {
        const entry = make('li', 'location-service');
        entry.append(make('span', 'location-service-name', service.name || 'Unnamed service'));
        if (service.description) entry.append(make('p', 'location-service-text', service.description));
        if (service.additionalInfo) entry.append(make('p', 'location-service-text', service.additionalInfo));
        services.append(entry);
      }
      bodyElement.append(services);
    }
  }

  async function open(item) {
    ensureDialog();
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    headingElement.textContent = item?.organization?.name || 'Streetli record';
    bodyElement.replaceChildren(make('p', 'location-status', 'Loading the Streetli record…'));
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch(`/api/location?caseId=${encodeURIComponent(item.id)}`,
        { cache: 'no-store', headers: { Accept: 'application/json' }, signal });
      const payload = await response.json();
      if (signal.aborted) return;
      if (!response.ok || !payload?.detail) {
        bodyElement.replaceChildren(make('p', 'location-status location-status-error',
          payload?.error === 'location_unavailable'
            ? 'This record has no linked Streetli location.'
            : 'The Streetli record could not be loaded right now.'));
        return;
      }
      render(item, payload.detail);
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      bodyElement.replaceChildren(make('p', 'location-status location-status-error',
        'The Streetli record could not be loaded right now.'));
    }
  }

  window.ghostLinksLocationDetail = { open };
})();
