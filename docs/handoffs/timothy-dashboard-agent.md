# Timothy's handoff log (codex/dashboard-agent)

Newest entry first. Written by Timothy's Claude Code agent. Protocol:
[README.md](README.md).

## 2026-10-28 ~3:15 PM (PT) · Halloween mode and ghost-buster leaderboard

**Works now (UI only, no contract change):**
- 🎃 toggle in the header (remembered per browser via localStorage). Spooky
  colors and wording through `data-spooky` attributes and a `t(normal, spooky)`
  helper in `apps/web/app.js`. Evidence, quotes, provenance and safety notes keep
  their plain wording.
- Halloween mode only: "Leading Ghost Busters" leaderboard. Reviewers set a hunter
  name (browser-local); decisions now carry `by` in `data/review-actions.json`.
  Points: resolved 10, not an issue 3, follow-up 1. Ranks: Rookie Hunter → Ghost
  Buster (10) → Poltergeist Wrangler (30) → Spectral Superhero (100). The board
  states it counts decisions recorded in the app, not verified corrections. It is
  returned with `GET /api/review-actions`, so fixture mode still makes only two
  local requests.
- `npm test`: 59 pass.

## 2026-10-28 ~2:45 PM (PT) · One box, discovery worker, per-detail verification

**Branch:** `codex/dashboard-agent`, merged `origin/main` @ 062448b; local commits only.

**Works now:**
- **One box** (hero search): typing still filters records locally. Submitting
  calls `POST /api/route`; a `route-request` stage (placeholder prompt, mine)
  picks `records`, `event`, `find_services` or `unsupported`. Live-tested on
  five requests, all routed correctly.
- **records** → `plan-request` (placeholder prompt, mine) turns the request into
  service terms / categories / kinds / locality; code applies it to every record;
  your `select-case` + `validateSelection` picks up to three. Fixture → browse only.
- **Discovery worker** (`apps/agent/discovery-runner.mjs`, `research/discovery.py`):
  runs your planner jobs (your queries, maxResults, maxPages, excluded domains,
  `max_age: 0`), your `verify-reference` prompt on Parasail via CrewAI, then
  `validateVerification`. Receipts go to `data/discovery-results.json` in your
  format (24 h cache, error backoff); findings to `data/discovery-findings.json`.
  Gate failures keep no claim. Live "Research the web" now runs the case's job and
  is enabled for `eligibleCaseIds`. "Run discovery (next 3 due)" and a "Risky links
  still online" card appear in live mode.
- **Find services / event results** show "What we checked" per service: name,
  address and phone (✓ confirmed on the service's own website, ◐ directory only),
  website, open status, and ⚠ when a phone or website matches a live Streetli flag.
- `npm test`: 58 pass; every test injects scripted runtimes (no provider calls).

**For Ivan:**
1. Your planner queries phones as `"+17186806344"`; pages usually write
   `718-680-6344`, so a live test mostly returned unrelated pages. Consider adding
   a formatted national variant for US numbers.
2. Please review/adopt `route-request` and `plan-request` (in
   `apps/agent/research/stages.py`, marked PLACEHOLDER) into `prompts/`.
3. I have not run anything against your live feed. Could you pull this branch and
   try "Run discovery" plus the one box on your machine?

## 2026-10-28 ~2:05 PM (PT) · Maintainer categories, reviewer decisions, event check

**Branch / commit / PR:** `codex/dashboard-agent`, merged `origin/main` @ 1ee63cf (your PRs #3 and #4); local commits only.

**Works now:**
- **Category board** above the queue: open counts for Possible compromise
  (`website_scam_content`, `website_suspected_compromise`, `website_repurposed`,
  `website_domain_parked`, plus any `saved_scan` website), Broken websites, Bad
  phones, Bad emails, Other. Click to filter; the compromise view sorts by
  severity; records get a "Compromise risk" badge. On your live feed this should
  show real counts; on fixtures it shows one compromise case.
- **Reviewer decisions** per case: Mark resolved / Not an issue / Needs follow-up /
  Reopen, with a note. Stored in ignored `data/review-actions.json` via
  `GET/POST /api/review-actions`, keyed by feed mode. They never edit Streetli,
  never touch `externalReferences`, and are labeled as reviewer decisions, not
  verified corrections. "Hide decided records" filters them out.
- **Event check** (`POST /api/event-check`, new section under the hero): "there was
  a flood on the Upper West Side" → Parasail parses event/area → You.com recent
  news → You.com + Parasail find named services in the area (names must appear
  verbatim on the listing page) → per-service recent search + own website →
  code keeps only excerpts where the full name or own site sits next to a
  closure/event word → Parasail statuses with verbatim quotes. Shows "Reported
  disruption" vs "Likely still able to help" ("no closure notice found" is
  explicitly not proof of being open). In live mode, area-matching Streetli
  provider names are added to the search; fixture names never leave the machine.
- `npm test`: 54 pass. I changed one assertion in `test/frontend.test.mjs`: fixture
  mode now makes two local requests (`/api/cases`, `/api/review-actions`); the
  test still proves no research or reporting request is made.

**Pending:** The case research flow still uses its own output shape and
placeholder prompts. Your prompt pack, `validateVerification`, the discovery
planner eligibility, budgets (2 queries / 3 pages) and the 24 h result cache are
my next task.

**Needs from Ivan:**
1. Do the category groupings match how you think about the reason codes?
2. Should "Mark resolved" also require a fresh research run showing `not_present`
   before it can be chosen, or is a reviewer note enough for the demo?

**Next:** wire your prompts, output gate and planner into the research flow.

## 2026-10-28 late afternoon (PT) · Research flow wired into the UI

**Branch / commit / PR:** `codex/dashboard-agent`, local commits only (not pushed yet).

**Works now:**
- `apps/agent/research/`: Python CrewAI flow. You.com Search → You.com Contents →
  literal match in code (no model call for non-matching pages) → CrewAI verifier on
  Parasail → CrewAI drafter on Parasail. Output uses the v1 `externalReferences`
  fields. Setup and CLI in `apps/agent/README.md`.
- `apps/agent/research-route.mjs` plus two routes in `fixture-server.mjs`:
  `POST /api/research?caseId=` (approved live cases only) and
  `POST /api/research/test` (labeled manual test). Progress streams as NDJSON.
- UI: a "Web research" section in the case detail view (disabled for fixtures and
  unapproved cases) and a "Test the research pipeline" form below the queue.
- `npm test`: 33 pass (29 existing + 4 in `test/research-route.test.mjs`, which use
  a fake Python process and run offline).
- Verified live with a manual test on a public pantry phone number: 12 progress
  events, 2 pages still showing it, 2 drafts marked `testOnly`, about 8 s.

**Pending:** One review ticket (no `ONE_SECRET` yet). `/health` still reports
`liveResearchImplemented: false`; left unchanged because your server test asserts it.

**Changed files:** Ivan's `apps/agent/fixture-server.mjs` gained an import, a small
JSON body reader, an optional `research` option, the two routes, and two error
codes in the sanitized list. `apps/web/index.html`, `app.js`, `styles.css` (new
rules appended, existing rules untouched). Python deps in `apps/agent/requirements.txt`.

**Needs from Ivan:**
1. Still: one `approved_for_research` live case, so "Research the web" can run on
   real Streetli data.
2. `prompts/verify-reference.md` and `prompts/prepare-correction.md`. The flow loads
   them automatically when present; until then results carry
   `placeholderPrompts: true`. The placeholder drafter is told never to claim a
   number is disconnected or a site closed unless the reason code says so (the
   first version did, and was fixed).
3. OK to flip `/health.liveResearchImplemented` to true and update your test?

**Next:** One review ticket on a reviewer click.

## 2026-10-28 afternoon (PT) · Adopted Ivan's frontend; Parasail verified

**Branch / commit / PR:** `codex/dashboard-agent`, synced with `origin/main` @ 8bc4579
(includes PR #2). No PR from this branch yet.

**Works now:**
- Ivan's historical case browser runs unchanged at http://127.0.0.1:4317/ with
  `npm start`; `npm test` passes 29 checks.
- Server-only `.env` exists locally (ignored). `PARASAIL_API_KEY` is verified:
  `GET /v1/models` and a `chat/completions` call to `parasail-glm-53` both
  returned 200. That model spends tokens on reasoning before answering, so
  callers need a generous `max_tokens`.

**Pending:**
- `YDC_API_KEY` (You.com) and `ONE_SECRET` (One) are not configured yet.
- No sponsor-powered research runs yet. Nothing in the app calls You.com,
  Parasail, CrewAI, or One today.
- An earlier standalone prototype (separate frontend) was dropped in favour of
  Ivan's app, per `docs/teammate-agent-handoff.md`. It is kept only on a local,
  unpushed branch `backup/timothy-first-dashboard`. Pieces to port into
  `apps/web/` later: a "Find help" seeker mode, an agent-progress / evidence /
  correction-draft panel, sponsor status pills, and a reviewer-only One ticket
  button.

**Changed files:** `docs/handoffs/` (new), `CLAUDE.md` (new, points Claude Code at
`AGENTS.md` and these logs). One line added to `AGENTS.md` pointing to
`docs/handoffs/`; that is a shared file, so please confirm it is fine.

**Needs from Ivan:**
1. Review ticket target: is a reviewer-clicked One post to the event's
   `#loft-incident` Discord channel acceptable as the "agreed team workspace"?
   The event rubric expects a One action there; nothing would be sent without a
   reviewer click.
2. One owner-approved real case (and a feed this machine can reach, or the case
   as a reviewed v2 record) for the live demo. Until then the agent runs only on
   a clearly labeled replay for fixtures.
3. ETA for `prompts/verify-reference.md` and `prompts/prepare-correction.md`.
   Until they land, the agent will load placeholder templates marked as such.
4. Proposal, not started: a small "Find help" mode where a seeker search runs
   through the same research pipeline and flags any result that still shows an
   identifier Streetli retired, as a lead for the review queue. Would that need a
   contract field, or should leads stay outside the case feed?

**Answers to Ivan:** none open.

**Next:** first checkpoint from the standing brief. Add a Python CrewAI service
under `apps/agent/` (Python 3.13, own venv, documented in `apps/agent/README.md`),
then prove a harmless live You.com Search/Contents call, a Parasail call through
CrewAI, and a One connection read without sending anything.
