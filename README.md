# Streetli Ghost Links

A collaboration starter for finding outdated community-service contact information that remains online after it was removed or replaced in Streetli.

The intended flow is: ask how to improve the social safety net, choose an eligible correction case, research public references to the old identifier, and show evidence with instructions for requesting a correction. This repository currently provides a synthetic case contract and fixture API. It is not a finished agent, live scanner, or reporting service. The private Streetli adapter is not implemented here.

## Run locally

Use Node.js **20.19 or newer**. No package installation is required for the current dependency-free starter.

```sh
git clone https://github.com/doobneek-org/streetli-ghost-links.git
cd streetli-ghost-links
npm test
npm start
```

The fixture API is available at <http://127.0.0.1:4317/api/cases>. `npm start` starts the local fixture server; it does not start a completed dashboard or query Streetli production. `npm test` checks case validation and server behavior.

The starter reads `PORT` from the process environment; it does not load `.env` automatically. `.env.example` documents planned integration settings. Add explicit server-side environment loading when implementing the integrations.

## Project layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Dashboard implementation area |
| `apps/agent/` | Public-web research and sponsor integration implementation area |
| `packages/contracts/` | Versioned case contract and validation |
| `fixtures/` | Synthetic demo cases |
| `docs/collaboration.md` | Ownership, integration boundary, and delivery checklist |

## Work together

- **doobneek-org / Ivan:** `codex/streetli-adapter` owns the private Streetli adapter in its original private repository, case selection, the public contract, domain prompts, and evaluation examples.
- **TimothyMSSTATE:** `codex/dashboard-agent` owns the dashboard, server runtime, and CrewAI, Parasail, You.com, and One integration wiring.

Both branches target the same shared repository and case contract. Start against fixtures so the dashboard and agent can progress before a live adapter exists. Coordinate contract changes before changing producers or consumers. See [collaboration details](docs/collaboration.md), [Timothy's coding-agent handoff](docs/teammate-agent-handoff.md), and [agent integration notes](apps/agent/README.md). The human account owner handles provider sign-in, credits, and app consent.

## Data boundary

The public repository contains fresh code and synthetic examples. Fixtures use fictional names and reserved example domains; they are not reports about real providers. Do not commit Streetli source modules, raw logs, private notes, contact histories, source snapshots, credentials, or production exports.

Future live integration must use a narrow, approved, read-only projection. Its endpoint token belongs only in server configuration and must not grant Firebase, database, or admin access. Sponsor API keys also stay in a server-only `.env`; never put them in browser bundles, shared screenshots, commits, or public issue text. `.env.example` documents variable names without values.

Keep evidence states explicit: an old identifier retained in a ledger is not automatically a confirmed correction, a public search result is not proof of current external use, and a submitted correction is not proof that a platform accepted it. The MVP should prepare evidence and correction instructions; it must not automatically send messages or submit reports.

## What is new for the hackathon

The new work is this standalone contract, fixture API, dashboard, and planned public-web research integrations. Streetli's dataset, internal verification systems, and past correction history predate this project and remain outside the public repository. Describe implemented integrations accurately in the demo; planned components must not be presented as working features.

Original code in this repository is licensed under [MIT](LICENSE). Synthetic fixtures are dedicated under CC0 as documented with the fixtures. Neither license grants rights to private Streetli code or any future real-data feed.
