# Ivan's handoff log (codex/streetli-adapter)

Newest entry first. Protocol: [README.md](README.md).

## 2026-10-28 17:43 (PDT) · Exact Maps listing from existing precomputation

**Branch:** `codex/streetli-adapter`, following `740f82a`.
**Works now:** reporting reads the saved Google Maps match through a narrow
public projection. A bound match replaces the generic Google help link with the
exact place ID URL and shows its saved contact value, observation date and
fresh/stale recheck notice. Opening a case via `?caseId=...` selects it and opens
the review queue without running research, fetching reporting or sending.
**Private boundary:** the existing Streetli case function accepts `mapsCaseId`
for a known public case only. It reads existing Maps caches and the current
branch context, rechecks identity and exact contact, then strips private fields.
It does not call Places, submit reports, change source records or hand over
private extension code. Historical removals remain usable as dated evidence.
**Changed shared files:** `apps/agent/reporting-routes.mjs`,
`apps/cloudflare/worker.mjs`, `apps/web/app.js`; new public match validator and
targeted tests. Case feed schema remains unchanged. See
[Maps integration](../google-maps-matches.md).
**Validation:** 122 public tests and 14 private reader/HTTP tests pass. A real
saved Google observation passes the new reader. A bounded live research run also
saved current directory citations; its verdict stays uncertain because a
verified current replacement was not supplied. No external reports were sent.
**Pending:** Timothy's broader Ask-shortlist/Halloween backend integration stays
separate from this reporting enhancement. Generic guidance remains when the
existing Maps cache has no eligible match; this is not full Maps coverage.

## 2026-10-28 17:29 (PDT) · Independent scrolling for long record details

**Branch:** `codex/streetli-adapter`, following `0716e57`.
**Fixed:** the desktop sticky detail panel could exceed the viewport, making its
Research/reporting actions unreachable until the long record list ended. At
widths above 690px it now has a viewport height limit and its own vertical scroll
area. The existing mobile stacked layout stays unchanged. The labeled panel is
keyboard-focusable; choosing a different record resets it to the top, while
updates to the same record preserve its scroll position.
**Shared files:** `apps/web/styles.css`, `apps/web/index.html`, `apps/web/app.js`.
This is a small frontend bug fix in Timothy's area; no contract/backend changes.
**Validation:** all 14 existing frontend interaction tests pass; diff check is
clean. Work browser automation remains disabled, so no visual check is claimed.
**Deployment:** release through the existing Cloudflare Worker/static asset path.
**Answer to Timothy's latest handoff:** the Ask-shortlist/Halloween changes on
`origin/codex/dashboard-agent` are pending separate integration; this urgent
scrolling fix does not mix in a new backend runtime release.

## 2026-10-28 17:19 (PDT) · Frontend release from merged main

**Branch / source:** `codex/streetli-adapter` @ `05db5e8`, matching `origin/main`.
**Works now:** redeployed the Worker and static frontend to `you.doobneek.org`.
Wrangler confirms 100% traffic on version `525fe5f1-3259-464a-87c7-8170ead312d2`,
created `2026-10-29T00:18:54Z`. The latest assets were already uploaded; this
release uses them with the configured Cloud Run backend. No source code changed.
**Verification:** deployment listing confirms the active version. Six browser
assets contain the latest headline, inline Streetli panel and Research access;
no secret files are in the asset directory. Public automated requests still get
Cloudflare's `403` challenge, so this release does not claim a fresh visual check.
**Needs from Timothy:** nothing for this release; pull merged `main` normally.

## 2026-10-28 17:07 (PDT) · Hosted research, One routes and browser access

**Branch:** `codex/streetli-adapter`, including Timothy's latest `ceffd4b` and
our runtime/access changes. This continues Ivan's Claude `hackaton` session.

**Works now:** Cloudflare at `you.doobneek.org` points to the deployed Node/Python
service `projects/streetli/locations/us-east1/services/ghost-links-research`,
origin `https://ghost-links-research-6konvjemca-ue.a.run.app`. The live feed has 187
cases. You.com Search/Contents → CrewAI/Parasail completed a real one-case run:
two searches, three freshly fetched pages, then verification. Its claim failed
the evidence gate, so the saved verdict is **uncertain**, not a confirmed finding.
No messages or reports were sent during this deployment.

**Access:** the dashboard has **Research access**. Enter the separate team code;
the browser keeps it only in memory, clears it on reload, and sends it only to
same-origin API POSTs. Ivan's ignored `.env` holds its owner copy as
`GHOST_LINKS_MAINTAINER_TOKEN`. It is distinct from provider/backend credentials.
No code or key values belong in Git or this log.

**One:** all six real paths are proxied, including `/api/one/team-ticket`, and
the saved demo route `/api/route/cached` is now proxied. GET status is open;
mutations require the team code. Live status: Gmail true; Sheets false until a
target `GHOST_LINKS_SHEET_ID` is set; Discord/Twilio false. One CLI resolved Gmail
and Sheets without executing actions. Connection metadata is a Secret Manager
file mounted at `/app/one/one-actions.json`, selected by `ONE_ACTIONS_FILE`.
The setup CLI now works on Windows too.

**Secrets / project answer:** use **streetli**. The dedicated runtime is
`ghost-links-research@streetli.iam.gserviceaccount.com`, with per-secret access.
You.com, Parasail, One, backend credentials and the owner code are in Secret
Manager under `ghost-links-*`; Cloudflare has separate Wrangler secrets.
Only public Git-tracked source was uploaded for the image build.

**Provider failures:** one live planner call failed while Parasail returned
`429 Endpoint Busy`; an isolated repeat succeeded in 26 seconds. Rate limits and
timeouts now show clear retry messages. Structured operator diagnostics contain
only fixed categories/timing/exception classes, never prompts, responses or keys.
The Python runner also handles a final JSON line without a newline and timeout
exit races. There are no new automatic retries.

**Persistence:** the hosted service uses a private hierarchical Cloud Storage
bucket mounted at `/app/data`; findings/receipts/reviewer state/cache can survive
restarts. Keep max instances at one: the JSON stores remain a single-writer
design. The independent Firebase baseline continues its hourly refresh.

**Validation:** 114 tests pass. Direct Cloud Run health/runtime, authenticated
cases/One status and unauthenticated 401s pass. Local Wrangler serves the same
frontend with the hosted backend at `http://127.0.0.1:4319/`, requiring the team
code for mutations. Automated browser use is disabled by Work settings, and
Cloudflare challenges command-line probes even with a browser user agent; do
not claim a fresh browser visual check or weaken zone security for probes.

**Final deployed versions:** Cloud Run revision `ghost-links-research-00002-lhq`
from runtime commit `37a0722`, image digest
`sha256:ae5efc8551384dea10d980a976a2ced6da9b27190642e8e6ef14210f85d1805e`.
Cloudflare version `b50ff51b-778e-4d68-b455-a93db8e6c2ea`. A fresh request through
the actual Worker runtime locally completed routing → planning → selection with
two matches, then `/api/route/cached` returned the clearly marked saved result.
Private storage retained the earlier finding across revisions. A temporary
follow-up decision was saved, reread and cleared to verify mounted writes/renames.
Four Python URL tests and Python compilation pass as well.

**Submission:** [checklist](../submission-checklist.md) records the official
6:25 PM Pacific deadline today and required 1–3 minute demo video, public repo,
description, integration explanation and team details. AWS is optional. No form
was submitted. The team still needs to record/link the video and submit.

**Answers to Timothy:** your requested One paths and backend project are now
handled, and your place-less search/headline update is included. Your source
runtime stays the same code we deploy; `ONE_ACTIONS_FILE` and structured failure
handling are the additional runtime changes.

**Next:** the team can pull `main`, demo with the access code, record the video and
finish the submission. [Submission draft](../submission-draft.md) and
[walkthrough](../demo-script.md) are ready to adapt; no form has been submitted.

## 2026-10-29 01:50 (EDT) · Merged Timothy's branch; one test needed a machine it did not declare

**Branch / commit:** `codex/streetli-adapter`, merging
`origin/codex/dashboard-agent` @ `90104ce`, also pushed to `main`.
Worker version `b5320fd5-20ee-49d1-935c-fb008a68be94`.

**Works now:** the merge was clean, no conflicts. Verified on
`you.doobneek.org` that the two sides coexist: Halloween mode toggles the
spooky copy, and with it on, a record still opens the inline Streetli panel
with live address, phones and services. The search button now carries both
exclusions and the printed phone variants, e.g.
`("718-215-0214" OR "(718) 215-0214" OR "718 215 0214") "RiseBoro" -site:gogetta.nyc -site:yourpeer.nyc`.
Suite is 97/97.

**Timothy, one thing to know about your test.** `demo mode returns saved
results labeled as saved` failed here, and it fails on your branch too, before
my merge — so it is not merge damage, and it is not something you would see on
your machine. `/api/route` gates on `discovery.available()`, which checks
whether `apps/agent/.venv/…/python` exists on disk. The test stubs `python`
but not that gate, so it silently requires a provisioned venv and fails on a
clean checkout or in CI. I added `discovery: { available: () => true, busy:
false }` to that one call; nothing else changed, and it now passes with or
without an interpreter present. Worth copying the pattern if other tests
depend on the same gate.

Separately, `npm test` does not read `.env`, so `GHOST_LINKS_PYTHON` there does
not help the suite; it has to be exported or a venv has to exist.

**Answers to Timothy, entry "Text me this list" via One:**

1. Your variable names are recorded. Nothing is in Secret Manager yet, because
   the runtime that reads them is not deployed; they are in my local ignored
   `.env` only.
2. Yes, the Worker can proxy `/api/one/*`. Those paths are not in its route
   map yet, which is why the One buttons are local-only. Adding them is a small
   change on my side: the map already supports GET-open/POST-maintainer, strips
   caller credentials and forwards the backend token, so `GET /api/one/status`
   would be open and the sending actions would sit behind `MAINTAINER_TOKEN` —
   which is what you want anyway, since each of those spends or sends something
   in your name. Say the word and I will add the five paths.
3. Still waiting on the backend origin URL from your question 3.

**Open:** `excludedDomains` now covers `gogetta.nyc` and `yourpeer.nyc`. If
yourpeer syncs from Streetli, a source fix propagates and excluding it is free;
if it lags, nothing will now report it as stale, so it needs a sync check
instead. Worth confirming which.

## 2026-10-29 01:05 (EDT) · Web search button searched a format nobody publishes

**Branch / commit:** `codex/streetli-adapter`, also on `main`.

**Works now:** "Open web search" searched the stored E.164 value, so a flagged
phone produced `"+16466016040"` — a form no directory prints, which is why the
button returned nothing useful. It now searches the printed variants the
discovery planner already used:
`("646-601-6040" OR "(646) 601-6040" OR "646 601 6040") "<provider>" -site:gogetta.nyc`.
Verified on `you.doobneek.org` across phone and website records. Websites and
emails keep the exact quoted form, since those are published verbatim.

Measured against You.com before the change: the E.164 query returned ten
results of which nine were a different congregation in another state, while the
variant query returned the single genuinely stale listing. That gap is the
argument for the model verification stage rather than query tuning alone.

**Timothy:** `apps/web/app.js` gains three lines to call the helper, with a
fallback to the old query if the script is absent. The logic lives in the new
`apps/web/search-query.js`; `apps/web/styles.css` is still untouched. A test
asserts the browser variants stay identical to the planner's, so the human
fallback and the paid pipeline cannot drift apart.

**Open question for Ivan, not Timothy:** `excludedDomains` is still only
`gogetta.nyc`. If `yourpeer.nyc` is also ours, it likely belongs there too, so
scans stop surfacing our own surface as an external finding. Not changed yet.

## 2026-10-29 00:20 (EDT) · Streetli records open inline; provider keys received

**Branch / commit:** `codex/streetli-adapter` @ `336b416`, also on `main`.
Worker version `f8817994-b756-4e41-9816-573ba51d7df7`.

**Works now:** selecting a flagged record and pressing "Open Streetli record"
opens the location in a read-only panel over the dashboard, unauthenticated.
Verified on `you.doobneek.org` against live records: address, neighbourhood,
phones, services and validation date render, and Escape closes the panel. The
external editor link remains as "Open Streetli editor ↗". Suite is 84/84.

The data is the same source the Sheets modal uses: upstream marks
`location-modal-details` as `publicRead` and forwards no Authorization header.
The Worker reads it server-side at `GET /api/location?caseId=…` and the page
fetches that same-origin, so the page CSP stays `connect-src 'self'` and no
CORS entry, token or cookie is involved. The upstream id is always taken from
the case feed, never from the caller, so the route cannot be aimed elsewhere.
`projectLocationDetail` in `packages/contracts/location-detail.mjs` resolves
upstream's timestamp-versioned fields to their newest value and trims ~232KB
to ~2KB, and strips markup — upstream free text contains anchors.

**Timothy, two things in your territory, both additive:**

1. `apps/agent/fixture-server.mjs` gains the same `/api/location` route, so
   `npm run dev` behaves like the deployed site instead of failing on a button
   that works in production. 20 lines, mirroring the `/api/reporting` block.
2. `apps/web/app.js` (+13) and `apps/web/index.html` (+2) wire the button and
   load the new files. `apps/web/styles.css` is deliberately untouched, so
   in-progress theme work cannot conflict. The panel's styles live in the new
   `apps/web/location-detail.css`.

**Provider keys:** received your `.env` values for `YDC_API_KEY`,
`PARASAIL_API_KEY`, `PARASAIL_BASE_URL`, `PARASAIL_MODEL`,
`PARASAIL_REASONING_EFFORT` and `CREWAI_DISABLE_TELEMETRY`. They are in the
local ignored `.env` only; they are not in Git and must not be pasted into any
tracked file, log entry or pull request. `ONE_SECRET` is still blank. These
read as hackathon-issued day-pass credentials, so treat them as short-lived
and plan to rotate or discard after the event.

**Pending:** the research backend itself is still not deployed, so `/health`
reports `researchBackendConfigured: false` and research routes return
`research_backend_unavailable`. The keys above are not yet in Google Secret
Manager, because the runtime that consumes them does not exist yet.

**Needs from Timothy:** 1. The origin URL once your backend is reachable over
HTTPS. 2. Confirmation of which of those variable names the runtime actually
reads, so the deployed secret names match rather than being guessed.

**Next (Ivan):** load the provider keys into Secret Manager and set
`RESEARCH_BACKEND_URL`, `RESEARCH_BACKEND_TOKEN` and `MAINTAINER_TOKEN` on the
Worker once the backend origin exists.

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
