# Streetli Ghost Links

**Old phone numbers, emails and websites keep haunting the web after a service changes them.
Someone in need calls a dead number or visits a hijacked site. Ghost Links hunts those ghosts
down, and helps people affected by an emergency find services that can still help.**

Built at *Hack with YOU: Halloween Edition* (Track 3, The Open Haunt) on Streetli's live NYC
community-service data. 3-minute walkthrough: [docs/demo-script.md](docs/demo-script.md).

Hosted dashboard: <https://you.doobneek.org/>. Browse the live case feed freely;
live research and One actions require the team's code under **Research access**.
Provider keys stay on the server. [Cloud Run deployment](docs/deploy-cloud-run.md)
and [submission checklist](docs/submission-checklist.md).

## What it does

One box. Typing filters the records instantly; pressing **Ask** lets a Parasail model,
coordinated by CrewAI, decide what you meant:

| You type | Ghost Links runs |
| --- | --- |
| "food services that may be at risk" | **Records**: a request planner turns words into a filter over Streetli's flagged records; Streetli's `select-case` prompt picks the top three to research |
| "there was a fire in my building in SoHo" | **Event**: works out what an affected person needs (emergency shelter, disaster relief, clothing), finds nearby services, checks each for recent closure notices, sorts **closest first** |
| "food pantry in Harlem" | **Find services**: the same search without an event |

For maintainers: a dashboard groups failed verifications (possible compromise, broken websites,
bad phones/emails, automated scan leads); **Research the web** runs a bounded discovery job
(You.com search and fetch → CrewAI/Parasail with Streetli's `verify-reference` prompt → evidence
gate) and shows where an old contact is *still* listed, with exact quotes. Reviewers record
decisions, and **One** turns findings into action. A 🎃 Halloween mode adds a ghost-buster
leaderboard.

## Why each partner is load-bearing

| Partner | Role | Without it |
| --- | --- | --- |
| **You.com** | Search and Contents: find pages still showing an old contact; find services near an event; read their closure notices | No evidence, no services |
| **Parasail** | Every judgment: routing the request, planning filters, verifying evidence with exact quotes, reading notices, deciding what an affected person needs | Nothing interprets the evidence |
| **CrewAI** | Flows and agents coordinating search → fetch → match → verify → draft, with real progress events and routing on results | No bounded, routed pipeline |
| **One** | On a click: Discord review ticket to the team, Gmail "email me this list" and progress report, Google Sheets events tracker and action list | Findings stay on screen; nothing gets fixed |

Safety by design: findings are cited leads, not accusations; every quote must appear verbatim on
a freshly fetched page; generic scan flags are never shown as compromise; nothing is sent, edited
or reported without a person clicking; keys stay server-side.

## Quick start

```sh
npm start                                   # Node 20.19+; live Streetli data needs no token
cd apps/agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # Python 3.10–3.13
```

Put `YDC_API_KEY`, `PARASAIL_API_KEY`, `PARASAIL_MODEL` (e.g. `parasail-glm-53`) and optionally
`ONE_SECRET` in `.env` (see `.env.example`), open <http://127.0.0.1:4317/>, and run `npm test`
(no test calls a paid provider). One setup: [agent README](apps/agent/README.md#one-actions-discord-gmail-google-sheets).

---

## Background

A collaboration starter for finding outdated community-service contact information that remains online after it was removed or replaced in Streetli.

The dev app loads Streetli's shared live phone, email, and website case feed by default, supports prompt/text search and state/type filters, and shows record details with reporting guidance. No Streetli token or Firebase credentials are needed. Set `STREETLI_CASES_MODE=fixture` for offline fictional examples. Tim's research worker connects You.com Search/Contents and CrewAI/Parasail to bounded discovery jobs; it requires the separate Python setup and sponsor keys described in [agent setup](apps/agent/README.md). Website reporting guidance includes a passive registrar lookup. The app does not submit reports or change Streetli; One actions run only on an explicit click.

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
| `apps/agent/` | Local server, research runtime (You.com, CrewAI, Parasail), discovery worker, One actions |
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
