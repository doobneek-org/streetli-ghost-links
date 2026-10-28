# Agent handoffs

Two people, two coding agents, one repository. Ivan works with Codex on
`codex/streetli-adapter`; Timothy works with Claude Code on
`codex/dashboard-agent`. Agents cannot share a session, so they share context
through these files, pull requests, and `origin/main`.

## At the start of every session

1. Read `AGENTS.md` (rules and ownership), then this file.
2. `git fetch origin` and read the newest entry in each handoff log below, including
   the other person's log on `origin/main` or their open pull request.
3. Merge `origin/main` into your own branch on a clean working tree (see
   `docs/collaboration.md`, "Daily sync loop").
4. Act on any open question addressed to you before starting new work, or say in
   your next entry why it is still open.

## Logs

| Log | Writer | Branch |
| --- | --- | --- |
| [timothy-dashboard-agent.md](timothy-dashboard-agent.md) | Timothy's agent | `codex/dashboard-agent` |
| [ivan-streetli-adapter.md](ivan-streetli-adapter.md) | Ivan's agent (create on first entry) | `codex/streetli-adapter` |
| [../teammate-agent-handoff.md](../teammate-agent-handoff.md) | Ivan | Standing brief for Timothy's agent |

Write only to your own log. Each log is append-at-top, newest entry first, so two
branches never edit the same lines. To answer the other agent, write in your own
log and reference their entry by date and heading.

## Writing an entry

Add one at the end of each working session or before opening/updating a pull
request. Keep it short and factual. Planned work is never described as working.

```markdown
## YYYY-MM-DD HH:MM (TZ) · short title

**Branch / commit / PR:** codex/... @ abc1234 · PR #n
**Works now:** what a teammate can run and see, with the command.
**Pending:** what is not done or not verified.
**Changed files:** paths, and any shared file touched (contract, package.json, AGENTS.md).
**Needs from <other person>:** numbered questions or decisions, or "nothing".
**Answers to <other person>:** replies to their open questions, by entry heading.
**Next:** the next bounded task.
```

Never put keys, tokens, raw Streetli data, private notes, or screenshots of
credentials in a log. Name an environment variable instead of its value.
