# Ghost Links demo scripts

Two versions: the recorded walkthrough for the [submission form](https://forms.gle/2z9dKv9gvsP3cEjW7)
(deadline 6:25 PM Pacific), and a script for presenting live to judges.

## Recorded submission walkthrough (3 minutes)

Before recording, open the hosted dashboard or `http://127.0.0.1:4319/`, enter
the team code under **Research access**, and check that Gmail is connected. Never
record the access code, provider credentials, `.env`, or Secret Manager values.
Keep any saved result's timestamp and **Saved result** label visible.

### 0:00–0:30 — The problem

“There's a fire in your apartment building tonight. You're on the sidewalk with
your kids, and you can't go back in. You search for an emergency shelter and call
the first number: disconnected. The next one's website is a casino ad. When services
change their contacts, the old copies keep haunting Google Maps, directories and AI
answers, and nobody owns them. Streetli's live NYC data has 187 of these flagged
right now. Ghost Links starts from those flags and checks where the old contacts
still appear.”

Open **Be a hero** to show the live review queue. Explain that a historical flag
is a starting point for investigation, not proof of current wrongdoing.

### 0:30–1:15 — One real record

Filter for a phone or website, select a record, and open the inline Streetli
record to show the current service context. Show the old identifier's history
and **Open web search**. Explain the exclusions for surfaces we operate.

### 1:15–2:10 — Evidence, not guesses

Run **Research the web** on one selected case. Narrate the real progress:
You.com searches and fetches public pages; CrewAI runs verification through
Parasail; the code checks source identity, exact quotes and freshness.

Show the actual outcome. An uncertain or rejected claim is useful: explain why
the system retained uncertainty rather than making an accusation. Never label a
snippet, old flag, or generic category change as confirmed fraud.

If provider latency requires showing a previous run, say it is saved evidence
and show its timestamp. Do not substitute mocked progress for a live run.

### 2:10–2:45 — Help someone act

Open the reporting guidance. Show the directory correction route and, for a
website, the registrar lookup and its policy conditions. Explain that guidance
does not guarantee removal and the app has not filed a report.

Show Gmail through One. The presenter may deliberately send the progress report
to their own inbox, or show connected status without sending. Do not claim a
send happened if you only showed the button. Sheets needs a target spreadsheet;
Discord requires its own connected account.

### 2:45–3:00 — What we built

“The new open-source work is the dashboard, evidence gates, public case contract,
research pipeline and action integration. Streetli's dataset and prior cleanup
infrastructure predate the hackathon. People review findings and choose actions;
the app keeps uncertainty and evidence visible.”

Upload the recording and put its URL in the [submission form](https://forms.gle/2z9dKv9gvsP3cEjW7)
before the published 6:25 PM Pacific deadline.

## Live presentation script (3 minutes)

Track 3, The Open Haunt. Judged on innovation (25), technical implementation (25), user
experience (20), impact (20), presentation and documentation (10). Each beat below names
the criterion it earns.

### Before you present (5 minutes)

- [ ] Run `npm run dev` and open <http://127.0.0.1:4317/>. Check that `/health` shows
      `"mode":"live"` and `"researchRuntimeAvailable":true`.
- [ ] Enter the team code under **Research access** (never on screen or in a recording).
- [ ] Tick **⚡ Demo mode** so saved results appear instantly. Each one is labeled
      "Saved result … Not a live check"; say so out loud. Use **Run live now** only if time allows.
- [ ] Type the demo phrases exactly as written below. Demo mode matches them ignoring case
      and spacing only.
- [ ] Open a second tab with the Gmail inbox for the address you will email
      (for example timothy2k14@gmail.com).
- [ ] Halloween mode is the default. If the header button reads **🎃 Halloween mode**, click it
      once so it reads **☀️ Normal mode**. Close other tabs and enlarge the browser text.
- [ ] Fallback if Wi-Fi drops: demo mode still works, since saved results are local.

### Script

#### 0:00 · The problem (impact, about 40 seconds)

> "Imagine there's a fire in your apartment building tonight. Everyone gets out, but you're
> standing on the sidewalk with your kids, and you can't go back in. You search 'emergency
> shelter near me' and call the first number. **Disconnected.** You try the next one's
> website. **It's a casino ad.**
>
> That's not a glitch. When a shelter or pantry changes its phone number or lets a website
> lapse, it updates its own listing, but the old copies don't die. They keep living on Google
> Maps, in directories, in old PDFs, even in AI answers. Nobody owns those copies, so nobody
> fixes them.
>
> And some get worse. Expired domains get bought up and turned into spam or scams, still
> sitting on listings that say 'Emergency Shelter.'
>
> Right now, Streetli's live NYC data has **187 flagged contacts**: phones that don't
> connect, emails that bounce, and **17 websites that may have been taken over**. Every one
> is a possible dead end for a family that's already lost everything that night.
>
> Streetli fixes its own records. **Ghost Links goes after the copies**, and helps people
> find help that's still there."

Say "may have been taken over": those 17 are flags, not confirmed findings. The 187 and 17
are the live feed's counts on Oct 28; check the dashboard before presenting.

#### 0:40 · That family, tonight (innovation, UX, technical)

Type **`Impacted by a fire in SoHo`** and press **Ask**, then say: "So let's be that family."

> "One box, no menus. Parasail, coordinated by CrewAI, decides what I meant. This is an
> event, so it works out what someone affected needs: emergency shelter, disaster relief,
> clothing."

Point to: the progress steps, the **Official protectors** cards (official disaster help:
American Red Cross Greater NY, FDNY), and the list sorted **closest first** with miles.

> "You.com searches and reads each service's own pages for closure notices. Official help is
> only shown if the name, quote and phone appear word for word on a page we fetched. No
> hallucinated hotlines."

#### 1:15 · Take it with you (One)

Type an address and click **📧 Send this list to my inbox** ("Email me this list" in normal mode). Switch to the
inbox tab and show the email.

> "One sends it through Gmail, on a click, with the content built on the server from what we
> found. Nothing is ever sent without a person pressing the button."

#### 1:30 · The maintainer side: hunting the ghosts (technical, impact)

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

Optional if time allows: type **`I want to check for record fixes needed by food banks`**
and press **Ask**. "Same box. Now it's a records question: Parasail filters to the food-bank
records that need a second look and picks the top ones to research first."

#### 2:30 · Normal mode, and the close (presentation)

Click **☀️ Normal mode**.

> "It opens haunted because it's Halloween, but one click gives the plain version a pantry
> volunteer would use every day. Ghost Links: find help that's still there, and keep it that way."

> "All three partners are load-bearing. Without You.com there's no evidence, without
> Parasail and CrewAI nothing interprets it, and without One nothing reaches anyone. It runs
> on Streetli's live NYC data, keys stay server-side, and 116 tests run without a single paid
> call."

### Likely questions

| Question | Answer |
| --- | --- |
| Is this live data? | Yes, Streetli's shared live case feed. Demo mode replays saved live results, labeled as such. |
| What if the model makes something up? | Quotes must appear verbatim on a page fetched in that run; failures are discarded (`unbound_quote`). |
| Does it change Streetli? | No. Decisions are reviewer notes; reporting guidance and One actions need a click. |
| What if I don't say where? | It asks "Where should I look?" and offers a city-wide search. |
| Where is it deployed? | Dashboard on Cloudflare at you.doobneek.org; research backend on Google Cloud Run with state in a private Cloud Storage bucket. |

### Don't demo

- Google Sheets log, Discord ticket: built, but not connected for the event.
- Mocked progress. If a live run is too slow, show a saved result with its timestamp and say so.
