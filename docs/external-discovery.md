# Automatic discovery from a live baseline

Streetli's retained identifier ledger and saved website findings form the
baseline. They are imported automatically, not maintained as a hand-edited demo
dataset. A `saved_scan` case is an unconfirmed saved observation with its original
review time. It does not claim when a domain changed, that the provider operates
the replacement site, or that another directory is currently wrong.

Saved direct-website associations can remain in this baseline after internal
replacement or removal when the original collection was bound to the same
public provider and branch. These use `scan_historical_reference`, keep
`state: flagged` and have no correction date: they record a historical flag,
not a claim that the URL is still listed internally or a known removal time.
Fresh external research must determine where the former value remains online.

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
The first baseline import can take several minutes; this warm-up command allows
up to five minutes. Ordinary interactive source requests retain a shorter
timeout, and subsequent bridge reads reuse the preloaded source results.

Research one identifier once even if multiple branches reference it. Preserve
the associated case IDs so verification can check each provider and branch.
Generate at most two quoted queries, five results per query and three fetched
pages per job. Exclude the surfaces we operate, `gogetta.nyc` and `yourpeer.nyc`;
a stale identifier on either is corrected at the source rather than reported as
an external finding, so discovery must not spend a query rediscovering it. Configure
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

The baseline adapter, planning helper, evidence gates and Tim's discovery runtime
are implemented. The dashboard can execute due jobs through You.com and
CrewAI/Parasail after the Python environment and keys are configured. Receipts
and findings persist under ignored `data/`, with source bindings and timestamps.
Tests use offline scripted providers; no live sponsor call was made on Ivan's
machine during integration. One is pending. The shared public baseline endpoint is now the app's default,
refreshed hourly by Streetli. The private localhost bridge remains an optional
owner-only source; a teammate does not need it or Firebase credentials.

AWS is optional in the event guide. No database or public hosting vendor is
prescribed for The Open Haunt. Reuse the existing backend and host the interface
on the owner's site when deployment is configured; keep sponsor credentials on
the server.

## Rejected model outputs

A fetched page is not a completed verification by itself. If a model quote is
not present verbatim in the supplied page, the claim is rejected and the job
uses the planner's error backoff (initially five minutes). It does not enter the
24-hour successful-result cache. No automatic paid retry runs when reading the
dashboard; a reviewer can request research after the backoff.

If the same source binding already has validated evidence under 24 hours old,
a later failed attempt keeps that evidence and its original observation time.
The failed attempt is shown separately. Expired evidence and evidence for a
different source binding are never kept as current findings.
