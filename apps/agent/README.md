# Research agent workspace

This directory contains the local case server, private-feed consumer, and reporting-route lookup. It serves a working historical-case browser using fixtures or a configured private projection. You.com/CrewAI/Parasail/One agents and automatic external-reference verification remain integration work; loading retained records does not run a new Streetli scan.

**Owner:** TimothyMSSTATE, branch `codex/dashboard-agent`.

## First working flow

1. Read `GET http://127.0.0.1:4317/api/cases` from the local fixture server.
2. Select a case with `reviewState: "approved_for_research"`.
3. Search its exact old identifier using You.com, with organization and locality context where needed.
4. Fetch or inspect candidate public sources and verify the exact provider/branch association. An identifier match alone does not establish ownership, wrongdoing, or a current error.
5. Return attributed evidence and a proposed correction with inline reporting instructions. Keep the original case provenance and uncertainty visible.

The entry prompt may be “How can I make the social safety net better?” Route it to eligible cases and a bounded research task. It must not initiate an unrestricted scan or send reports automatically.

## Intended integration roles

- **CrewAI:** coordinate bounded search, verification, and report-drafting tasks.
- **You.com:** discover public references to the old identifier and supporting official sources.
- **Parasail:** provide the configured inference step for extraction or explanation.
- **One:** create a reviewer-approved draft or review ticket in a connected workspace; provide a concrete action rather than a UI-only passthrough.

These roles are planned. Add setup details and exact SDK/API usage as integrations become functional. Verify provider capabilities and the event requirements before presenting an integration as complete.

## Research flow (Python, working from the command line)

`research/` holds a CrewAI flow that researches one case. The web app runs it
through `research-route.mjs`, which spawns the venv's Python and streams NDJSON
progress to the browser:

- `POST /api/research?caseId=<id>`: live cases with `reviewState:
  "approved_for_research"` only. Fixtures return 409 `fixture_research_disabled`;
  unapproved cases return 409 `research_requires_approval`.
- `POST /api/research/test` with `{kind, value, organization, locality}`: the
  labeled pipeline test behind the "Test the research pipeline" form.
- One run at a time (429 `research_busy`), 180 s timeout, and 503
  `research_runtime_missing` if `apps/agent/.venv` is not installed.

| Step | Runs on | What it does |
| --- | --- | --- |
| guard | code | Refuses fixtures (never sent to live search) and cases not `approved_for_research`. `--manual-test` runs on an identifier you supply and labels everything as a test. |
| search | You.com Search | Searches the old identifier as pages write it (`718-680-6344`, `example.org/path`) plus the organization name; skips the retired website itself; keeps up to 5 pages. |
| fetch | You.com Contents | Fetches those pages as markdown. Pages that fail stay `unknown`. |
| match | code | Literal match of the old identifier. Pages without it become `not_present` with no model call; matches keep ~500 characters of context. |
| verify | CrewAI agent → Parasail | One call per case judges every matching excerpt: `still_present`, `possible_match`, `not_present`, or `unknown`, with an exact quote. A `still_present` quote not found verbatim is downgraded to `possible_match`. |
| draft | CrewAI agent → Parasail | A correction request per `still_present` page. Drafts only; nothing is sent. Manual-test drafts carry `testOnly: true`. |

Output: contract-shaped `externalReferences` (`url`, `observedAt`, `state`,
`quote`, `reportState`), plus `notes`, `drafts`, and `placeholderPrompts`.
Until Ivan adds `prompts/verify-reference.md` and `prompts/prepare-correction.md`,
the flow uses clearly marked placeholders from `research/prompts.py` and reports
`placeholderPrompts: true`.

Setup (Python 3.10–3.13), once:

```sh
cd apps/agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Needs `YDC_API_KEY`, `PARASAIL_API_KEY`, `PARASAIL_BASE_URL`, `PARASAIL_MODEL` in
the root `.env`. `PARASAIL_REASONING_EFFORT=low` (default) cuts reasoning tokens
sharply on `parasail-glm-53`.

Run from `apps/agent/`:

```sh
# A case from the running app's feed (start the app with `npm start` first)
.venv/bin/python -m research.run --case-id <id>

# A manual pipeline test on a public identifier (not a Streetli case)
.venv/bin/python -m research.run --manual-test --kind phone \
  --value "+17185550100" --org "Organization name" --locality "Brooklyn, NY"

# Machine-readable events and result, one JSON object per line
.venv/bin/python -m research.run --case-id <id> --jsonl
```

## Evidence and output

The v1 `externalReferences` fields are `url`, `observedAt`, `state`, `quote`, and `reportState`; see `packages/contracts/cases.mjs`. Coordinate additions with the contract owner. Useful evidence includes a public source URL, observation time, quoted passage containing the old identifier, provider/branch association, and the supported finding. Distinguish `still_present`, `unknown`, and a separately verified correction. A request failure, empty search, removed webpage, or submission receipt does not alone prove that a listing was fixed.

Preserve `internal.source`: `retained_ledger` is less conclusive than `confirmed_correction`. A provider's expired or repurposed domain does not establish that the provider itself operates the replacement content. Research findings need review before any reporting or changes.

## Runtime and secrets

The root app uses Node.js 20.19+ with no install step: run `npm run dev` and `npm test`. It loads the ignored server-only `.env`; with `STREETLI_CASES_URL` configured it uses that private source, otherwise fixtures. See [local dev setup](../../docs/local-dev.md). If agent dependencies or another runtime are added, document their exact setup here; current Node tests do not verify an unimplemented research agent.

All API keys live server-side in a local `.env`; commit names and instructions only in `.env.example`. A future Streetli token may access only an approved read projection. Never request or use Firebase/admin credentials, raw logs, private notes, email histories, private source modules, or unreviewed production exports. Do not log authorization headers or pass secrets to prompts.

Keep fixture mode usable without credentials or network calls. The fixtures are synthetic and CC0; they must never be reported to real platforms as actual errors.
