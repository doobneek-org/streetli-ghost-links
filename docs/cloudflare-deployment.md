# Cloudflare deployment at you.doobneek.org

The Cloudflare Worker serves the existing static dashboard and a same-origin
API. Its configuration attaches the exact custom hostname `you.doobneek.org`.
Cloudflare handles that hostname's DNS and certificate when the Worker is deployed
into the account owning the active `doobneek.org` zone.

With Wrangler authenticated in that account:

```sh
npm test
wrangler deploy --dry-run
npm run cloudflare:deploy
```

The static assets are limited to `apps/web/`; no `.env`, private Streetli source,
Python environment or data export is uploaded as a browser asset. The Worker
reads the pinned public Streetli baseline and validates the v2 response. API reads
do not start Streetli scans, model calls or catalogue writes. The independent
Streetli job refreshes the baseline hourly.

## Runtime boundary

Tim's complete local app starts Python CrewAI processes from Node and stores
research/reviewer state in local JSON files. Standard Workers cannot run that
subprocess arrangement unchanged. The edge deployment provides live baseline
browsing, local text filters and registrar/directory reporting guidance. Until a
research backend is configured, research and review mutations return an explicit
unavailable error, and no success or saved decision is invented.

A full deployment can run the Node/Python runtime in Cloudflare Containers or
another container service behind the Worker. A container needs an explicit
production listener/origin configuration, durable external state for findings,
receipts and reviewer decisions, and server-side sponsor secrets. Its local
filesystem must not be treated as durable data. Cloudflare Containers require a
Workers Paid subscription; the edge/static deployment does not enable one.

The adapter supports an optional HTTPS research backend configured server-side
with `RESEARCH_BACKEND_URL`, `RESEARCH_BACKEND_TOKEN` and `MAINTAINER_TOKEN`.
It only proxies allowlisted routes, strips incoming credentials and uses the
dedicated backend token. Paid research and review mutations require the
maintainer token rather than exposing an anonymous spend endpoint. Neither
token belongs in frontend source, Git, screenshots or query strings. No backend
or secrets are configured by the static deployment alone.

## Verification

Check `/health`, `/api/cases`, the dashboard and one reporting route. `/health`
must state whether a research backend is configured; a live baseline does not
mean AI research is available. A missing backend should fail clearly when the
research control is used. Keep the existing local `npm run dev` flow for Tim's
provider work; the Cloudflare deployment does not replace his local `.env`.

Two things that look like outages but are not:

- The `doobneek.org` zone challenges default bot user agents, so `curl` without
  a browser `User-Agent` returns `403` with `Cf-Mitigated: challenge` on every
  hostname in the zone, including healthy ones. Pass a browser UA when probing.
- This machine's resolver does not answer `you.doobneek.org` even though
  Cloudflare and Google DNS do. Add
  `--resolve you.doobneek.org:443:104.20.39.56` when curling from here.

The Workers runtime rejects `redirect: 'error'` on `fetch` (only `follow` and
`manual` exist at the edge). The Worker uses `manual` and refuses any `3xx`
itself; Node-side code may keep `'error'`. Passing `'error'` in the Worker
throws a `TypeError` that surfaces as `case_source_unavailable`, which reads
like a dead upstream rather than a bad option.

References: [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
[static asset bindings](https://developers.cloudflare.com/workers/static-assets/binding/),
and [Containers](https://developers.cloudflare.com/containers/).
