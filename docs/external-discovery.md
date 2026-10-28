# Automatic discovery from a live baseline

Streetli's retained identifier ledger and saved website findings form the
baseline. They are imported automatically, not maintained as a hand-edited demo
dataset. A `saved_scan` case is an unconfirmed saved observation with its original
review time. It does not claim when a domain changed, that the provider operates
the replacement site, or that another directory is currently wrong.

External discovery is a separate stage. A public-web search may investigate an
unconfirmed flag without first certifying it as an error. Reporting still needs
current evidence, a supported reporting route and deliberate human action.

## Planning and precomputation

Use `buildDiscoveryPlan` from `packages/contracts/discovery-plan.mjs` on a live
case feed. The helper is pure: it plans work without making network requests,
spending credits, persisting results, scheduling a worker or sending reports.
Fixture input creates no live jobs. Malformed contacts and missing provider
identity are excluded rather than guessed.

Run `npm run precompute` with the live source configured to save the current job
plan into ignored `data/discovery-plan.json`. `npm run precompute -- --watch`
refreshes that plan every five minutes. No sponsor calls are made by this
command. It automatically reads optional worker receipts from ignored
`data/discovery-results.json` to apply cache/backoff policy. The worker must
store actual completed/error receipts there or use the same helper with its
own durable results store. A failed source load leaves the last saved plan
unchanged, with its original generation time.

Research one identifier once even if multiple branches reference it. Preserve
the associated case IDs so verification can check each provider and branch.
Generate at most two quoted queries, five results per query and three fetched
pages per job. Exclude Streetli's verified own domain, `gogetta.nyc`; configure
additional owned domains only after checking them.

Persist bounded results separately from the source cases, keyed by the planner's
binding. That binding includes the identifier, provider identities and source
provenance, not the time the feed happened to refresh. Reuse successful discovery
for 24 hours, invalidate it when the source binding changes, and back off errors.
The runtime must enforce these budgets and keep a global spend/concurrency cap;
repeated prompts must not start duplicate paid jobs.

The trusted runtime can pass `researchCaseIds` derived from the plan's
`eligibleCaseIds` into `validateSelection`. Only intersect IDs with the bounded
case list supplied to the model. This permits automatic public-web research of
`review_required` flags while preserving their uncertainty. The model cannot
grant itself eligibility, and this scope does not authorize a report or edit.

## Provider runtime owned by Timothy

1. You.com Search discovers candidate references to the exact old identifier.
   Use server-only `YDC_API_KEY`, POST `https://ydc-index.io/v1/search`, bounded
   `count`, and exact quoted queries. Search hits remain leads.
2. Deduplicate candidate URLs and reject non-public/local/private destinations,
   credentials, unsupported ports and authenticated Streetli links. Fetch up to
   three public pages using POST `https://ydc-index.io/v1/contents`, formats
   `markdown`, `html`, `metadata`, and `max_age: 0` for current verification.
   Missing extraction is unavailable, never proof of absence. Cached search
   observations and a newly fetched page have different timestamps.
3. CrewAI coordinates discovery and verification; Parasail supplies inference.
   Load the supplied prompts, then validate the generated evidence with
   `validateVerification`. Exact identifier matches, archives and search snippets
   alone cannot establish a stale current listing. Metadata-only references need
   explicit channel/context and must not be treated as visible contact details.
4. Save actual search/fetch/error events and evidence separately. Render cached
   findings immediately when a user searches; refresh due jobs in bounded work.
   Do not represent cached results as a fresh scan or zero search hits as cleanup.
5. One supports a deliberate reviewer-controlled draft or team review action.
   No report or message is automatically sent by this plan.

Official references: [Search](https://you.com/docs/api-reference/search/v1-search)
and [Contents](https://you.com/docs/api-reference/contents).

## Current delivery boundary

The baseline adapter, planning helper and evidence gates are implemented. The
current app server still reports `liveResearchImplemented: false`: it does not
execute sponsor searches or run a background discovery worker. Runtime storage,
provider keys, budget enforcement and genuine tool progress remain Timothy's
integration work. The private localhost bridge is not a shared hosted endpoint.

AWS is optional in the event guide. No database or public hosting vendor is
prescribed for The Open Haunt. Reuse the existing backend and host the interface
on the owner's site when deployment is configured; keep sponsor credentials on
the server.
