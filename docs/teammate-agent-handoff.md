# Timothy's coding-agent handoff

Paste the following into the coding agent working on this repository.

---

Continue the public Ghost Links dashboard and research runtime in
`https://github.com/doobneek-org/streetli-ghost-links` on
`codex/dashboard-agent`. Read `AGENTS.md`, `README.md`, and
`docs/collaboration.md`. Fetch and merge `origin/main` before starting; preserve
your existing work and do not reset the branch. The historical-case frontend
already works: extend it rather than building a second app.

## What is delivered

- Buildless frontend and Node dev server at `http://127.0.0.1:4317/`.
- Prompt/text search, website/phone/email filters, Removed/Flagged/All history,
  record details, exact authenticated Streetli links where available, pagination,
  explicit fixture/live/error states, and refresh.
- Server-side private source consumer with a dedicated token; fictional fixtures
  work without credentials. The live private bridge is outside this repository.
- Google/Findhelp reporting guidance and passive registrar RDAP lookup, including
  Name.com/GoDaddy routes when identified. No reports are sent.
- Executable v1/v2 contracts, deterministic discovery planning, and tests.

The shared public endpoint is now the default:
`https://us-central1-streetli.cloudfunctions.net/streetliGhostLinksCases`.
Merge `origin/main` and run `npm run dev`. No Streetli token, Firebase credentials,
or owner's running machine is required. Remove an old explicit localhost
`STREETLI_CASES_URL` override if present; a blank value uses the shared endpoint.
The backend refreshes the precomputed public projection hourly. API reads do not
launch paid research or catalogue scans. Set `STREETLI_CASES_MODE=fixture` for
offline fictional examples.
Imported real cases preserve `review_required` as their finding status. Do not
silently promote flags into confirmed findings.

The owner has authorized automatic public-web discovery from the
baseline. A per-record manual dataset is not required. Use the deterministic
`buildDiscoveryPlan` helper and trusted `researchCaseIds` scope described in
`docs/external-discovery.md`; keep source flags unconfirmed while researching.
`saved_scan` is an additional v2 provenance value for automatically imported,
identity-bound saved website findings. It must remain `flagged`, with no
correction date. It is neither a confirmed correction nor a ledger verdict.
`scan_historical_reference` preserves a former direct website association after
it disappears internally, when the saved and current public provider/branch
identity match. This does not assert that the old URL is still in Streetli.

Precompute discovery independently of the user's prompt: deduplicate shared
identifiers, reuse fresh saved results, invalidate changed source bindings, and
back off failures. A prompt should select relevant cases and display known
findings immediately while the bounded worker refreshes due research. The helper
plans jobs; it does not run providers or persist results by itself.

Ivan owns the private Streetli case exporter, case-selection rules, prompt
engineering, and evaluation examples. You own frontend design, runtime wiring,
provider clients, and genuine progress events. Implement prompt loading from
`prompts/`; coordinate final text with Ivan rather than duplicating domain rules
in UI components or scattering them through tool clients.

The first prompt pack is now available through `prompts/manifest.json`: request
selection, reference verification, correction preparation, structured-output
schemas and eleven offline evaluation cases. Use
`packages/contracts/research-output.mjs` after model generation. These gates are
tested, but no model-quality score has been established and the prompts are not
yet wired into the current search UI. See `prompts/README.md` for how to capture
actual model predictions and score them without committing results or secrets.

## Build in this order

1. Extend the existing prompt-first interface against the fixture/live case API. Suggested
   prompt: "How can I make the social safety net better?" The first result is a
   provider record with its website, phone or email identifier and recorded
   flag/removal provenance. Preserve that distinction: not every case is a
   confirmed correction. The UI must identify fixtures and review-required cases.
2. Use the existing server-only case source adapter. Live mode defaults to the
   shared endpoint without a token. Custom private sources use `STREETLI_CASES_URL`
   with `STREETLI_CASES_TOKEN`. Validate the response
   using `packages/contracts/cases.mjs`. Support v1 fixtures and v2 historical
   cases; keep that contract stable and propose
   changes to Ivan before changing producers or consumers. Do not request
   Firebase/admin credentials or inspect the private Streetli repository.
3. Connect You.com Search and Contents. Research an eligible case's exact former
   identifier, then fetch a few candidate pages. Search results are leads;
   distinguish an archival mention from a current provider contact. Show source
   links and observation timestamps. Do not send fictional fixture cases into
   live searches or reporting tools; use clearly labeled replay evidence for
   fixture mode and an eligible real case for the live demonstration.
4. Use CrewAI for bounded discovery, verification, and report preparation, with
   Parasail supplying model inference. Show actual tool events, errors, and
   unknown outcomes. The product must not claim simulated progress or results
   are live. Use the agreed prompt templates and output schemas.
5. Connect cited live evidence and a correction preview to the existing
   destination-specific reporting panel. Wire
   One to a deliberate reviewer-controlled draft or review ticket in an agreed
   team workspace. External reports or messages are not authorized by this
   handoff. Never treat a draft/submission receipt as a verified correction.

## Provider setup

Use the official event guide rather than guessed SDK methods:
https://youdotcom-oss.github.io/halloween-hack-2026/

- You.com supplies Search and Contents; configure `YDC_API_KEY` server-side.
- Parasail supplies inference; configure `PARASAIL_API_KEY` and choose a model
  returned by its current model list.
- CrewAI is the framework. Local use requires no separate CrewAI service key;
  its model calls use the configured Parasail provider. Document Python setup
  separately if added.
- One supplies the connected-app action. Select a supported CLI/MCP/API path
  from current docs, then document its exact auth variable and scopes. The
  existing `ONE_SECRET` example is a placeholder for the chosen path.

The human account owner completes sign-in, event-credit redemption, key entry,
and connected-app consent. Implement configuration and safe smoke checks around
that setup. Keep keys in ignored server-only local configuration; no secrets in
Git, prompts, browser code, screenshots, or logs. If auth/credits block progress,
ask the organizers promptly and continue fixture-based UI work.

## First milestone

One eligible real Streetli case produces a record card, an actual You.com
search/fetch, a Parasail comparison coordinated by CrewAI, cited evidence, and a
reviewable correction draft. One supports a reviewer-controlled team action.
Keep the starter runnable without credentials in fixture mode. Defer staff
turnover, catalogue-wide scanning, automatic takedowns, and production edits.

Open a pull request into `main` with setup instructions, checks, and an accurate
list of working/pending integrations. Avoid touching `prompts/` or the contract
without coordination; do not publish raw logs or real-data exports.

## Ownership and checkpoints

Your files: `apps/web/`, the public runtime and new provider clients under
`apps/agent/`, and their tests. Coordinate dependency changes in `package.json`.
Ivan's files: `prompts/`, `packages/contracts/`, evaluation criteria, reviewed case
selection, and the private Streetli adapter in its separate repository.

First checkpoint: prove a harmless live You.com Search/Contents request, a
Parasail inference request through CrewAI, and a One connection discovery/read
without sending a message. Record configuration failures accurately and let the
account owner resolve sign-in or credit redemption. Then connect one
eligible real case end to end.

Commit each working increment on `codex/dashboard-agent`, push that branch and
open/update a pull request into `main`. After the other side's PR merges, fetch
and merge `origin/main` into your own branch. Never force-push, reset away local
work, push to the other person's branch, or auto-deploy Streetli production.
