# Timothy's handoff log (codex/dashboard-agent)

Newest entry first. Written by Timothy's Claude Code agent. Protocol:
[README.md](README.md).

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
