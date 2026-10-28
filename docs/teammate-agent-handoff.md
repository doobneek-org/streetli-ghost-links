# Timothy's coding-agent handoff

Paste the following into the coding agent working on this repository.

---

Build the public Ghost Links dashboard and research runtime in
`https://github.com/doobneek-org/streetli-ghost-links` on
`codex/dashboard-agent`. Read `AGENTS.md`, `README.md`, and
`docs/collaboration.md`. Fetch and merge `origin/main` before starting; preserve
your existing work and do not reset the branch.

Ivan owns the private Streetli case exporter, case-selection rules, prompt
engineering, and evaluation examples. You own frontend design, runtime wiring,
provider clients, and genuine progress events. Implement prompt loading from
`prompts/`; coordinate final text with Ivan rather than duplicating domain rules
in UI components or scattering them through tool clients.

## Build in this order

1. Build a prompt-first interface against the existing fixture API. Suggested
   prompt: "How can I make the social safety net better?" The first result is a
   provider record with its former website, internal correction, reason, and
   provenance. The UI must identify fixtures and review-required cases.
2. Add a server-only case source adapter. Default to fixtures; future live mode
   reads `STREETLI_CASES_URL` with `STREETLI_CASES_TOKEN`. Validate the response
   using `packages/contracts/cases.mjs`. Keep the v1 contract stable; propose
   changes to Ivan before changing producers or consumers. Do not request
   Firebase/admin credentials or inspect the private Streetli repository.
3. Connect You.com Search and Contents. Research an approved case's exact former
   identifier, then fetch a few candidate pages. Search results are leads;
   distinguish an archival mention from a current provider contact. Show source
   links and observation timestamps. Do not send fictional fixture cases into
   live searches or reporting tools; use clearly labeled replay evidence for
   fixture mode and an approved real case for the live demonstration.
4. Use CrewAI for bounded discovery, verification, and report preparation, with
   Parasail supplying model inference. Show actual tool events, errors, and
   unknown outcomes. The product must not claim simulated progress or results
   are live. Use the agreed prompt templates and output schemas.
5. Add a cited correction preview and destination-specific instructions. Wire
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

One approved real Streetli case produces a record card, an actual You.com
search/fetch, a Parasail comparison coordinated by CrewAI, cited evidence, and a
reviewable correction draft. One supports a reviewer-controlled team action.
Keep the starter runnable without credentials in fixture mode. Defer staff
turnover, catalogue-wide scanning, automatic takedowns, and production edits.

Open a pull request into `main` with setup instructions, checks, and an accurate
list of working/pending integrations. Avoid touching `prompts/` or the contract
without coordination; do not publish raw logs or real-data exports.
