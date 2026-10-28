# Collaboration

Shared repository: <https://github.com/doobneek-org/streetli-ghost-links>.

This is a separate hackathon project. The canonical private Streetli checkout remains separate; do not copy or publish its code, logs, credentials, or raw data into this repository.

## Two-person ownership

| Contributor | Branch | Deliverable |
| --- | --- | --- |
| Ivan / doobneek-org | `codex/streetli-adapter` | Private adapter in the original Streetli repository; case selection, reviewed projection, prompt templates, and evaluation examples |
| TimothyMSSTATE | `codex/dashboard-agent` | Dashboard, server runtime, provider authentication/configuration wiring, CrewAI orchestration, and You.com / Parasail / One clients |

The human provider-account owner handles sign-ins, event-credit redemption, key
entry, and connected-app consent. Coding agents implement and test the wiring.
Local CrewAI is the framework, not a fourth API-key service. Timothy's agent can
start from the [ready-to-paste handoff](teammate-agent-handoff.md). Domain prompt
ownership is documented in [prompts/README.md](../prompts/README.md).

Work on these branches and open pull requests into the default branch. Keep changes small enough for the other person to review. Contract changes affect both workstreams: agree on the shape first, update validation and fixtures, and then update consumers. No contributor needs Streetli Firebase credentials or raw logs to build the dashboard against fixtures.

## Current working surface

With Node.js 20.19+, run `npm test` and `npm start` from the repository root. No install is needed for this starter. The local API is `http://127.0.0.1:4317/api/cases` and returns fixture mode only. A live private adapter and completed research agents are not included.

The v1 envelope is `{ schemaVersion: 1, mode: "fixture" | "live", generatedAt, cases }`. Each case carries:

- `id`, plus public organization `name` and `locality`.
- `identifier`: `kind` (`website`, `phone`, or `email`) and old `value`.
- `internal`: `state` (`removed` or `replaced`), `reasonCode`, `correctedAt`, `source` (`confirmed_correction` or `retained_ledger`), and `coverage: "retained_records_only"`.
- `replacement`: `null` or `{ value }`.
- `externalReferences`: initially empty. The v1 fields are `url`, `observedAt`, `state`, `quote`, and `reportState`; validate them with `packages/contracts/cases.mjs`. Coordinate changes before adding fields.
- `reviewState`: `review_required` or `approved_for_research`.

Use the executable contract in `packages/contracts/` as the validation authority. A case with `source: "retained_ledger"` must retain that uncertainty: removal/retirement does not by itself establish a verified mistake or its cause. Coverage means recoverable retained records, not every correction ever made.

## Integration sequence

1. Timothy builds a case list, detail view, prompt entry, and reporting-instructions panel against the synthetic API.
2. The agent selects only cases approved for research, searches the exact old identifier, and verifies whether a result actually refers to the same provider and branch.
3. Research results show their source URL, observation time, relevant evidence, and uncertainty. Search snippets alone are leads. Missing search results do not establish that an external listing was corrected.
4. Ivan implements the private projection separately, with explicit field allowlisting and provenance. Live wiring follows review of that projection; browser code receives no token.
5. Both contributors test the complete fixture demo and label which integrations are implemented, simulated, or pending.

Draft correction messages and inline platform instructions are sufficient for the first demo. Sending messages, changing provider records, or submitting external reports requires a separately authorized action.

## Sponsor integrations

The intended roles are You.com for public-web discovery, CrewAI for research-task coordination, Parasail for configured model inference, and One for a reviewer-controlled draft or review ticket in a team workspace. These are implementation assignments, not claims that any SDK is already installed or connected. Timothy should verify each integration against the event's official brief and current provider documentation, then document what the working demo actually uses.

Store sponsor keys and any approved adapter token in a local, server-only `.env`. Share required variable names through `.env.example`; exchange secret values through an appropriate private channel. Never send Firebase/admin credentials, private Streetli endpoint responses, raw logs, or private data to sponsor APIs. Only the approved case projection and selected public evidence may enter research requests.

## Demo attribution and release boundary

Describe the dashboard, contract, fixture server, and research integrations as the new hackathon work. Attribute the pre-existing dataset and internal correction systems to Streetli. Do not present inherited records or infrastructure as newly created during the event.

This repository's original code is MIT; its synthetic fixtures are CC0. A future live endpoint has its own access and data terms. Open-source code does not make the connected dataset public or authorize redistributing it.
