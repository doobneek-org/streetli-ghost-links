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

## Evidence and output

The v1 `externalReferences` fields are `url`, `observedAt`, `state`, `quote`, and `reportState`; see `packages/contracts/cases.mjs`. Coordinate additions with the contract owner. Useful evidence includes a public source URL, observation time, quoted passage containing the old identifier, provider/branch association, and the supported finding. Distinguish `still_present`, `unknown`, and a separately verified correction. A request failure, empty search, removed webpage, or submission receipt does not alone prove that a listing was fixed.

Preserve `internal.source`: `retained_ledger` is less conclusive than `confirmed_correction`. A provider's expired or repurposed domain does not establish that the provider itself operates the replacement content. Research findings need review before any reporting or changes.

## Runtime and secrets

The root app uses Node.js 20.19+ with no install step: run `npm run dev` and `npm test`. It loads the ignored server-only `.env`; with `STREETLI_CASES_URL` configured it uses that private source, otherwise fixtures. See [local dev setup](../../docs/local-dev.md). If agent dependencies or another runtime are added, document their exact setup here; current Node tests do not verify an unimplemented research agent.

All API keys live server-side in a local `.env`; commit names and instructions only in `.env.example`. A future Streetli token may access only an approved read projection. Never request or use Firebase/admin credentials, raw logs, private notes, email histories, private source modules, or unreviewed production exports. Do not log authorization headers or pass secrets to prompts.

Keep fixture mode usable without credentials or network calls. The fixtures are synthetic and CC0; they must never be reported to real platforms as actual errors.
