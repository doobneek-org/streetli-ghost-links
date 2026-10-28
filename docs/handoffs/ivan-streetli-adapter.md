# Ivan's handoff log (codex/streetli-adapter)

Newest entry first. Protocol: [README.md](README.md).

## 2026-10-28 22:40 (EDT) · Research backend integration is yours; here is the contract

Correcting my previous entry: its **Next** line put the hosted research backend
on me. Reassigning it to Timothy's agent, because the Python/CrewAI runtime
under `apps/agent/` is Timothy's per `AGENTS.md:33` and the Worker side is
already finished and deployed. Ivan keeps only the Secret Manager half.

**What is already done (do not rebuild):** the Worker at `you.doobneek.org`
serves the dashboard and the live feed, and it already contains a complete,
tested proxy to a research backend. Nothing in `apps/cloudflare/` needs to
change to turn research on — it is configuration-gated, not unimplemented.

**Your task:** deploy the Node+Python runtime to an HTTPS origin (Cloud Run
needs the fewest changes to the subprocess setup; Firebase Python functions
also work) and make it answer the routes below. Then tell Ivan the origin URL
and he will set the Worker configuration.

**The contract the Worker already enforces** (`apps/cloudflare/worker.mjs`):

- Proxied paths, forwarded as `<backend base path>` + the request path, so a
  base of `https://host/base/` maps `/api/ask` to `https://host/base/api/ask`:
  `/api/review-actions` (GET, POST), `/api/discovery/findings` (GET),
  `/api/discovery/run` (POST), `/api/research` (POST, requires `?caseId=`),
  `/api/research/test` (POST), `/api/ask` (POST), `/api/route` (POST),
  `/api/event-check` (POST).
- Auth: GET is open. POST requires the caller to send
  `Authorization: Bearer <MAINTAINER_TOKEN>`; the Worker checks it, strips all
  caller credentials, and sends your backend `Bearer <RESEARCH_BACKEND_TOKEN>`
  instead. Your backend only ever sees the backend token.
- Your backend must return `application/json` or `application/x-ndjson`;
  any other content type becomes a `502` at the edge. Streaming NDJSON works.
- Limits: request bodies are capped at 4096 bytes and the proxy times out at
  180s. Backend `400/404/409/413/429` pass through; anything else becomes a
  `503`, with `429` reported to the browser as `research_busy`.
- Cross-origin POSTs are rejected with `403` before any proxying.

**Configuration (Ivan's half, not in Git):** `RESEARCH_BACKEND_URL` as a plain
var in `wrangler.jsonc`; `RESEARCH_BACKEND_TOKEN` and `MAINTAINER_TOKEN` via
`wrangler secret put`. The URL must be `https:` with no userinfo, query or
fragment, and both tokens must match `^[A-Za-z0-9_-]{32,256}$` or the Worker
returns `research_backend_configuration_invalid` on every route.

**How you know it worked:** `/health` currently reports
`researchBackendConfigured: false`. Once the backend is configured it reports
`true`, and the dashboard's discovery and reviewer controls stop rendering the
"not connected yet" state on their own — the frontend already reads
`researchBackendAvailable` from `/api/review-actions` and
`/api/discovery/findings`.

**Needs from Timothy (carried over, still open):** the provider env-var names
the runtime expects, by name only — the values go into Secret Manager, never
into Git or this log.

**Not yours, do not wait on it:** You.com and Parasail secrets do not exist in
either Google project yet. Ivan adds them.

**Next (Ivan):** add the provider secrets once the names are known, then set
the three Worker values and verify `/health` flips to configured.

## 2026-10-28 22:05 (EDT) · Cloudflare edge live; fixed the Workers redirect bug

**Branch / commit / PR:** `codex/streetli-adapter` · Worker version
`b68df8d4-148d-4ba2-94d1-30b072522d8a`

**Works now:** `https://you.doobneek.org` serves the dashboard, and
`/api/cases` returns the live feed — verified `200` with `mode: live` and 187
cases, matching the upstream endpoint. `/api/reporting?caseId=…` returns real
registrar/directory routes. `npm test` passes 78/78.

The first deploy returned `503 case_source_unavailable` on every data route
while the upstream endpoint was healthy. Cause: the Workers runtime rejects
`fetch(..., { redirect: 'error' })` — only `follow` and `manual` exist at the
edge — and the Worker's `catch` reported that `TypeError` as an unreachable
source. Both Worker fetches now use `manual` and refuse any `3xx` explicitly,
which keeps the original "never follow a redirect" property. The test suite
had asserted `redirect === 'error'`, so it encoded the bug; those assertions
are corrected and a regression test now rejects any mode the runtime refuses.
Node-side code (`fixture-server.mjs`, `reporting-routes.mjs`) keeps `'error'`,
which is valid under Node.

Also note two false alarms, both documented in
[cloudflare-deployment.md](../cloudflare-deployment.md): the zone challenges
default bot user agents, so bare `curl` gets `403 Cf-Mitigated: challenge` on
every `doobneek.org` hostname including healthy ones; and this machine's
resolver does not answer `you.doobneek.org` though Cloudflare and Google DNS do.

**Pending:** AI research is still not connected. `/health` reports
`researchBackendConfigured: false`, and research/review mutations return an
explicit `research_backend_unavailable` rather than inventing a result. No
You.com or Parasail secret exists in either Google project yet. The hosted
Python backend (Firebase Python functions or Cloud Run) is not deployed.

**Changed files:** `apps/cloudflare/worker.mjs`, `test/cloudflare-worker.test.mjs`,
`docs/cloudflare-deployment.md`, plus the previously uncommitted edge adapter
(`wrangler.jsonc`, `apps/web/.assetsignore`, `.gitignore`, `package.json`,
`apps/web/app.js`, `apps/web/index.html`, `test/frontend.test.mjs`).

**Needs from Timothy:** 1. Which provider keys the research backend needs, by
environment-variable name only — they go into Secret Manager, never into Git.
2. Whether the Python runtime should be Cloud Run or Firebase Python functions;
Cloud Run needs fewer changes to your Node-plus-subprocess setup.

**Answers to Timothy:** nothing open.

**Next:** stand up the hosted research backend and point
`RESEARCH_BACKEND_URL` / `RESEARCH_BACKEND_TOKEN` at it.

## 2026-10-28 · Shared endpoint deployed and Tim's runtime integrated

**Branch / commits:** `codex/streetli-adapter`; integrates Timothy's
`codex/dashboard-agent` through `07e7243` plus the shared-source work `4b42860`.

**Works now:**

- Public read-only endpoint:
  `https://us-central1-streetli.cloudfunctions.net/streetliGhostLinksCases`.
  It returns the v2 live feed without a token. The latest verification returned
  187 cases, including both historical church examples. Source counts change
  as retained findings and current source bindings change.
- The deployed Streetli worker refreshes this precomputed public projection
  hourly. Verified an actual cloud refresh completed. Reads do not run scans,
  call models or depend on Ivan's machine. Unknown/unbound provider identities
  remain outside the public projection. Private code and credentials are not
  in this repository.
- Default `npm run dev` and `npm run precompute` use the shared endpoint.
  Remove an old explicit localhost `STREETLI_CASES_URL` override if present;
  blank uses the shared endpoint. Keep your sponsor settings in your ignored
  `.env`. Use `STREETLI_CASES_MODE=fixture` only for offline examples.
- Merged Tim's one-box routing, category board, reviewer decisions, streamed
  You.com/CrewAI/Parasail discovery and event/service flows. The merge conflict
  was only server imports; both sets were retained.
- Fixed Python executable resolution for Windows and Unix. Generic saved scan
  leads stay in the scan category rather than acquiring a compromise label.
  Selected records beyond the first 100 due identifier groups now run.
  Cached findings carry the source binding and expire after 24 hours; source
  changes hide old claims. Service risk matches preserve website paths/queries
  and phone country/extension identity. Empty content extraction stays unknown.

**Validation:** Node tests, offline Python URL tests and Python compilation pass.
The combined local app returned live data, the two church examples, eligible
discovery IDs and the frontend successfully. No live sponsor call was made on
Ivan's machine: the local Python environment and sponsor keys are not configured.
Tim's reported live provider trials remain his separate validation.

**Answers to Timothy:**

1. Added a second bounded national-format query for US phone numbers (hyphen,
   spaces and parentheses) while preserving the exact original query and
   extension identity. Query-policy version invalidates older cached searches.
2. `route-request` and `plan-request` remain clearly marked placeholders.
   Domain prompt adoption/evaluation is still pending; no claimed evaluation.
3. The live feed is reachable now. Merge `origin/main` into your own branch and
   run locally with your existing provider configuration. No Streetli credentials
   or separate data-token exchange is needed.
4. Reviewer decisions may hide/annotate a record locally. They never establish
   a verified external correction; that still needs fresh checked evidence.
   The historical scan category remains separate from compromise.
5. One remains pending, including the intended destination and human-controlled
   action. This integration does not authorize an external message or report.

**Changed shared files:** server source defaults, case-source configuration,
discovery planner/normalizer, environment example, health response and docs.
Provider/runtime and frontend fixes above were made during the user-requested
integration; preserve them on the next sync.

**Next for Timothy:** merge `origin/main`, restart the local dev server, confirm
the live case count, then run one bounded discovery against the shared feed
using your local sponsor keys. Validate source quotes and record the outcome
in your own log. Never commit keys or real case results.
