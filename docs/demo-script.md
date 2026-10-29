# Ghost Links: 3-minute demo script

Track 3, The Open Haunt. Judged on innovation (25), technical implementation (25), user
experience (20), impact (20), presentation and documentation (10). Each beat below names
the criterion it earns.

## Before you present (5 minutes)

- [ ] Run `npm run dev` and open <http://127.0.0.1:4317/>. Check that `/health` shows
      `"mode":"live"` and `"researchRuntimeAvailable":true`.
- [ ] Tick **⚡ Demo mode** so saved results appear instantly. Each one is labeled
      "Saved result … Not a live check"; say so out loud. Use **Run live now** only if time allows.
- [ ] Type the demo phrases exactly as written below. Demo mode matches them ignoring case
      and spacing only.
- [ ] Open a second tab with the Gmail inbox for the address you will email
      (for example timothy2k14@gmail.com).
- [ ] Halloween mode is the default. If the header button reads **🎃 Halloween mode**, click it
      once so it reads **☀️ Normal mode**. Close other tabs and enlarge the browser text.
- [ ] Fallback if Wi-Fi drops: demo mode still works, since saved results are local.

## Script

### 0:00 · The problem (impact)

> "When a food pantry changes its phone number, the old one doesn't die. It keeps haunting
> Google listings, directories and old flyers. Someone in crisis calls a dead number, or
> worse, visits a website that's been taken over by a scammer. Streetli maintains NYC's
> community-service data, and it already knows which contacts failed. Ghost Links finds
> where those ghosts still live online, and helps people find help that's actually there."

### 0:20 · Someone needs help after an event (innovation, UX, technical)

Type **`There was a flood on the Upper West Side`** and press **Ask**.

> "One box, no menus. Parasail, coordinated by CrewAI, decides what I meant. This is an
> event, so it works out what someone affected needs: emergency shelter, disaster relief,
> clothing."

Point to: the progress steps, the **Official protectors** cards (official disaster help) (Red Cross Greater NY,
NYC Emergency Management), and the list sorted **closest first** with miles.

> "You.com searches and reads each service's own pages for closure notices. Official help is
> only shown if the name, quote and phone appear word for word on a page we fetched. No
> hallucinated hotlines."

### 1:00 · Take it with you (One)

Type an address and click **📧 Send this list to my inbox** ("Email me this list" in normal mode). Switch to the
inbox tab and show the email.

> "One sends it through Gmail, on a click, with the content built on the server from what we
> found. Nothing is ever sent without a person pressing the button."

### 1:20 · The maintainer side: hunting the ghosts (technical, impact)

Click **👻 Become a ghost buster** ("Be a hero: fix outdated listings" in normal mode). Point to the categories: possible compromise,
broken websites, bad phones, bad emails.

Open a record, then click **Open Streetli record** to show the live record inline. Then show
its **Research the web** finding (or run it live if time allows).

> "For each flagged contact, a bounded CrewAI flow plans searches, You.com fetches the pages,
> and Parasail checks them with Streetli's own verify-reference prompt. Every quote must
> appear verbatim on a freshly fetched page, or it's thrown out. That's our evidence gate.
> A finding is a cited lead, not an accusation."

Click **Busted 👻 (resolved)**.

> "Reviewers record what they found. It never edits Streetli on its own."

### 2:15 · Ask in plain English (UX)

Type **`I want to check for record fixes needed by food banks`** and press **Ask**.

> "Same box. Now it's a records question, so Parasail turns it into a filter: 13 food-bank
> records that need a second look, with the top ones picked to research first."

### 2:35 · Normal mode, and the close (presentation)

Click **☀️ Normal mode**.

> "It opens haunted because it's Halloween, but one click gives the plain version a pantry
> volunteer would use every day. Ghost Links: find help that's still there, and keep it that way."

> "All three partners are load-bearing. Without You.com there's no evidence, without
> Parasail and CrewAI nothing interprets it, and without One nothing reaches anyone. It runs
> on Streetli's live NYC data, keys stay server-side, and 98 tests run without a single paid
> call."

## Likely questions

| Question | Answer |
| --- | --- |
| Is this live data? | Yes, Streetli's shared live case feed. Demo mode replays saved live results, labeled as such. |
| What if the model makes something up? | Quotes must appear verbatim on a page fetched in that run; failures are discarded (`unbound_quote`). |
| Does it change Streetli? | No. Decisions are reviewer notes; reporting guidance and One actions need a click. |
| What if I don't say where? | It asks "Where should I look?" and offers a city-wide search. |
| Where is it deployed? | Dashboard on Cloudflare at you.doobneek.org; the research backend is packaged for Cloud Run (`docs/deploy-cloud-run.md`). |

## Don't demo

- Text me this list, Google Sheets log, Discord ticket: built, but not connected for the event.
- Ask or Research on `you.doobneek.org`: the research backend isn't deployed there yet.
  Present from your laptop.
