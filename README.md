# Streetli Ghost Links

A collaboration starter for finding outdated community-service contact information that remains online after it was removed or replaced in Streetli.

The dev app loads Streetli's shared live phone, email, and website case feed by default, supports prompt/text search and state/type filters, and shows record details with reporting guidance. No Streetli token or Firebase credentials are needed. Set `STREETLI_CASES_MODE=fixture` for offline fictional examples. Tim's research worker connects You.com Search/Contents and CrewAI/Parasail to bounded discovery jobs; it requires the separate Python setup and sponsor keys described in [agent setup](apps/agent/README.md). Website reporting guidance includes a passive registrar lookup. The app does not submit reports or change Streetli; the One action remains pending.

## Run locally

Use Node.js **20.19 or newer**. No package installation is required for the current dependency-free starter.

```sh
git clone https://github.com/doobneek-org/streetli-ghost-links.git
cd streetli-ghost-links
npm test
npm start
```

Open the dev app at <http://127.0.0.1:4317/>. The case API is <http://127.0.0.1:4317/api/cases>. Use `npm run dev` for the Node watch process; refresh the page after frontend edits. No install or build is needed. `npm test` checks the case contract, local server, and reporting-route behavior.

The server loads ignored local `.env` settings without overriding existing process variables. See [local data setup](docs/local-dev.md). A configured live source failure stays an error; the app never silently substitutes fictional results.

`npm run precompute` automatically prepares a
bounded, deduplicated external-discovery job plan under ignored `data/`.
`npm run precompute -- --watch` refreshes the plan every five minutes. It makes
no sponsor requests itself. With the Python runtime and keys configured, the
dashboard's discovery button executes due jobs and persists real results.
See [automatic discovery](docs/external-discovery.md).

## Project layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Runnable prompt-first historical case browser |
| `apps/agent/` | Local server, private-feed consumer, reporting routes, future sponsor integrations |
| `packages/contracts/` | Versioned case contract and validation |
| `fixtures/` | Synthetic demo cases |
| `docs/collaboration.md` | Ownership, integration boundary, and delivery checklist |

## Work together

- **doobneek-org / Ivan:** `codex/streetli-adapter` owns the private Streetli adapter in its original private repository, case selection, the public contract, domain prompts, and evaluation examples.
- **TimothyMSSTATE:** `codex/dashboard-agent` owns the dashboard, server runtime, and CrewAI, Parasail, You.com, and One integration wiring.

Both branches target the same shared repository and case contract. Merge `origin/main`, then run `npm run dev`; the shared endpoint supplies live data automatically. Coordinate contract changes before changing producers or consumers. See [collaboration details](docs/collaboration.md), [Timothy's coding-agent handoff](docs/teammate-agent-handoff.md), and [agent integration notes](apps/agent/README.md). The human account owner handles provider sign-in, credits, and app consent.

## Data boundary

The public repository contains fresh code and synthetic examples. Fixtures use fictional names and reserved example domains; they are not reports about real providers. Do not commit Streetli source modules, raw logs, private notes, contact histories, source snapshots, credentials, or production exports.

Live integration uses a narrow public read-only projection at [the shared endpoint](https://us-central1-streetli.cloudfunctions.net/streetliGhostLinksCases). It serves a precomputed snapshot refreshed hourly; reads do not launch scans or AI calls. A custom private source still requires a server-only token. Sponsor API keys also stay in a server-only `.env`; never put them in browser bundles, shared screenshots, commits, or public issue text. `.env.example` documents variable names without values. Real case data and private source records are not committed to this repository.

Keep evidence states explicit: an old identifier retained in a ledger is not automatically a confirmed correction, a public search result is not proof of current external use, and a submitted correction is not proof that a platform accepted it. The MVP should prepare evidence and correction instructions; it must not automatically send messages or submit reports.

## What is new for the hackathon

The new work is this standalone contract, fixture API, dashboard, and planned public-web research integrations. Streetli's dataset, internal verification systems, and past correction history predate this project and remain outside the public repository. Describe implemented integrations accurately in the demo; planned components must not be presented as working features.

Original code in this repository is licensed under [MIT](LICENSE). Synthetic fixtures are dedicated under CC0 as documented with the fixtures. Neither license grants rights to private Streetli code or any future real-data feed.
