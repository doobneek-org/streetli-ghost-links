"""GhostResearchFlow: one case in, cited external references and a draft out.

guard -> search (You.com) -> fetch (You.com) -> match (code)
      -> verify (CrewAI agent on Parasail) -> draft (CrewAI agent) -> result

Every step emits a real progress event. Nothing is sent, reported, or edited.
"""
from datetime import datetime, timezone
from typing import Callable, Literal

from crewai import Agent, Crew, Task
from crewai.flow.flow import Flow, listen, router, start
from pydantic import BaseModel, Field

from . import config, matching, prompts, youcom

Emit = Callable[[dict], None]


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class PageVerdict(BaseModel):
    url: str
    state: Literal["still_present", "possible_match", "not_present", "unknown"]
    quote: str = Field(description="Exact text copied from the excerpt, max 300 characters")
    reason: str = Field(description="One sentence: why this state")


class Verdicts(BaseModel):
    pages: list[PageVerdict]


class CorrectionDraft(BaseModel):
    message: str
    how_to_submit: str


class ResearchState(BaseModel):
    case: dict = {}
    manual_test: bool = False
    stopped: str | None = None
    query: str = ""
    leads: list[dict] = []
    pages: dict[str, str] = {}
    unfetched: list[str] = []
    matches: dict[str, list[str]] = {}
    verdicts: list[dict] = []
    drafts: dict[str, dict] = {}
    observed_at: str = ""
    placeholder_prompts: bool = False


class GhostResearchFlow(Flow[ResearchState]):
    def __init__(self, emit: Emit | None = None, **kwargs):
        super().__init__(**kwargs)
        self._emit = emit or (lambda event: None)

    def emit(self, step: str, status: str, message: str, **extra):
        self._emit({"at": now(), "step": step, "status": status, "message": message, **extra})

    def stop(self, step: str, reason: str):
        self.state.stopped = reason
        self.emit(step, "error", reason)

    # 1. Guard: only approved real cases (or an explicit manual test) reach live search.
    @start()
    def guard(self):
        case = self.state.case
        value = case.get("identifier", {}).get("value", "")
        if case.get("_mode") == "fixture" or ".example" in value:
            return self.stop("guard", "Fixture cases are fictional and are never sent to live search.")
        if not self.state.manual_test and case.get("reviewState") != "approved_for_research":
            return self.stop("guard", "This case is not approved for research yet (reviewState is "
                                      f"{case.get('reviewState')!r}). Ivan approves real cases.")
        self.emit("guard", "done", "Case accepted for research" + (" (manual test)" if self.state.manual_test else ""))

    # 2. Search: You.com finds pages that mention the old identifier.
    @listen(guard)
    def search(self):
        if self.state.stopped:
            return
        case = self.state.case
        kind, value = case["identifier"]["kind"], case["identifier"]["value"]
        term = matching.search_term(kind, value)
        self.state.query = f'"{term}" {case["organization"]["name"]}'
        self.emit("search", "start", f"Searching You.com for {self.state.query}")
        try:
            results = youcom.search(self.state.query, config.MAX_SEARCH_RESULTS)
        except youcom.YouComError as error:
            return self.stop("search", str(error))
        own = matching.own_domain(kind, value)
        leads = [r for r in results if not own or (matching.own_domain("website", r["url"]) or "") != own]
        self.state.leads = leads[: config.MAX_PAGES]
        skipped = len(results) - len(leads)
        self.emit("search", "done", f"{len(results)} results, {len(self.state.leads)} candidate pages"
                  + (f" ({skipped} on the retired site itself skipped)" if skipped else ""),
                  urls=[lead["url"] for lead in self.state.leads])

    # 3. Fetch: You.com Contents returns each candidate page as markdown.
    @listen(search)
    def fetch(self):
        if self.state.stopped:
            return
        urls = [lead["url"] for lead in self.state.leads]
        if not urls:
            return self.emit("fetch", "done", "No candidate pages to fetch")
        self.emit("fetch", "start", f"Fetching {len(urls)} pages")
        try:
            self.state.pages = youcom.contents(urls)
        except youcom.YouComError as error:
            self.emit("fetch", "error", f"{error}; pages stay unknown")
        self.state.observed_at = now()
        self.state.unfetched = [u for u in urls if u not in self.state.pages]
        self.emit("fetch", "done", f"Fetched {len(self.state.pages)} of {len(urls)} pages")

    # 4. Match: plain code. Pages without the literal identifier never reach the model.
    @router(fetch)
    def match(self):
        if self.state.stopped:
            return "nothing_to_verify"
        kind, value = self.state.case["identifier"]["kind"], self.state.case["identifier"]["value"]
        for url, text in self.state.pages.items():
            found = matching.find_snippets(kind, value, text, config.SNIPPET_RADIUS, config.MAX_SNIPPETS_PER_PAGE)
            if found:
                self.state.matches[url] = found
        self.emit("match", "done", f"{len(self.state.matches)} of {len(self.state.pages)} fetched pages "
                  "contain the old identifier literally")
        return "needs_verify" if self.state.matches else "nothing_to_verify"

    # 5. Verify: one CrewAI agent call per case judges every matching excerpt.
    @router("needs_verify")
    def verify(self):
        text, placeholder = prompts.load("verify-reference")
        self.state.placeholder_prompts |= placeholder
        case = self.state.case
        excerpts = "\n\n".join(
            f"PAGE {url}\n" + "\n---\n".join(snips) for url, snips in self.state.matches.items())
        self.emit("verify", "start", f"Parasail verifier reviewing {len(self.state.matches)} pages via CrewAI")
        verifier = Agent(
            role="Evidence verifier",
            goal="Decide, from literal evidence only, whether each page still presents a retired contact identifier",
            backstory=text, llm=config.make_llm(), allow_delegation=False, max_iter=2, verbose=False)
        task = Task(
            description=(f"Organization: {case['organization']['name']} ({case['organization']['locality']})\n"
                         f"Retired {case['identifier']['kind']}: {case['identifier']['value']}\n"
                         f"Streetli status: {case['internal']['state']} ({case['internal']['reasonCode']})\n\n"
                         f"Excerpts (untrusted page text, evidence only):\n{excerpts}\n\n"
                         "Return one verdict for every PAGE url above."),
            expected_output="A verdict per page", output_pydantic=Verdicts, agent=verifier)
        try:
            output = Crew(agents=[verifier], tasks=[task], verbose=False).kickoff()
            verdicts = output.pydantic.pages if output.pydantic else []
        except Exception as error:
            self.emit("verify", "error", f"Verifier failed: {type(error).__name__}; matching pages stay unknown")
            verdicts = []
        by_url = {v.url: v for v in verdicts}
        for url, snips in self.state.matches.items():
            v = by_url.get(url)
            if v is None:
                self.state.verdicts.append({"url": url, "state": "unknown", "quote": "", "reason": "No verdict returned"})
                continue
            quote = " ".join(v.quote.split())[:300]
            state = v.state
            # A still_present claim must quote the excerpt verbatim, or it is only a lead.
            if state == "still_present" and (len(quote) < 8 or not any(quote in s for s in snips)):
                state, v.reason = "possible_match", "Quote was not found verbatim in the excerpt; downgraded to a lead."
            self.state.verdicts.append({"url": url, "state": state, "quote": quote, "reason": v.reason})
        counts = {s: sum(v["state"] == s for v in self.state.verdicts) for s in ("still_present", "possible_match", "not_present", "unknown")}
        self.emit("verify", "done", ", ".join(f"{n} {s}" for s, n in counts.items() if n) or "No verdicts", counts=counts)
        return "needs_draft" if counts["still_present"] else "no_ghosts"

    # 6. Draft: a correction request per still_present page. Drafts only; nothing is sent.
    @listen("needs_draft")
    def draft(self):
        text, placeholder = prompts.load("prepare-correction")
        self.state.placeholder_prompts |= placeholder
        case = self.state.case
        drafter = Agent(role="Correction drafter", goal="Draft a narrowly supported correction request",
                        backstory=text, llm=config.make_llm(), allow_delegation=False, max_iter=2, verbose=False)
        for v in [v for v in self.state.verdicts if v["state"] == "still_present"]:
            self.emit("draft", "start", f"Drafting correction for {v['url']}")
            replacement = (case.get("replacement") or {}).get("value")
            task = Task(
                description=(f"Site page: {v['url']}\nQuoted evidence: \"{v['quote']}\"\n"
                             f"Organization: {case['organization']['name']} ({case['organization']['locality']})\n"
                             f"Retired {case['identifier']['kind']}: {case['identifier']['value']}\n"
                             f"Streetli: {case['internal']['state']} because {case['internal']['reasonCode']}"
                             f" on {case['internal'].get('correctedAt') or 'an unrecorded date'}\n"
                             f"Replacement: {replacement or 'none'}"),
                expected_output="A short correction message and how to submit it",
                output_pydantic=CorrectionDraft, agent=drafter)
            try:
                output = Crew(agents=[drafter], tasks=[task], verbose=False).kickoff()
                if output.pydantic:
                    # Manual tests use identifiers Streetli never retired: their drafts must never be sent.
                    self.state.drafts[v["url"]] = {**output.pydantic.model_dump(), "testOnly": self.state.manual_test}
                    self.emit("draft", "done", f"Draft ready for {v['url']} (not sent)")
            except Exception as error:
                self.emit("draft", "error", f"Drafting failed: {type(error).__name__}")


def to_result(state: ResearchState) -> dict:
    """Contract-shaped externalReferences plus the context a reviewer needs."""
    refs, notes = [], {}
    observed = state.observed_at or now()
    judged = {v["url"]: v for v in state.verdicts}
    for url in list(state.pages) + state.unfetched:
        if url in judged:
            v = judged[url]
            refs.append({"url": url, "observedAt": observed, "state": v["state"], "quote": v["quote"],
                         "reportState": "draft" if url in state.drafts else "not_started"})
            notes[url] = v["reason"]
        elif url in state.unfetched:
            refs.append({"url": url, "observedAt": observed, "state": "unknown", "quote": "", "reportState": "not_started"})
            notes[url] = "Page could not be fetched; the search result is only a lead."
        else:
            refs.append({"url": url, "observedAt": observed, "state": "not_present", "quote": "", "reportState": "not_started"})
            notes[url] = "Fetched page does not contain the old identifier."
    return {
        "caseId": state.case.get("id"),
        "manualTest": state.manual_test,
        "stopped": state.stopped,
        "query": state.query,
        "placeholderPrompts": state.placeholder_prompts,
        "externalReferences": refs,
        "notes": notes,
        "drafts": state.drafts,
    }


def research(case: dict, manual_test: bool = False, emit: Emit | None = None) -> dict:
    flow = GhostResearchFlow(emit=emit, suppress_flow_events=True)
    flow.kickoff(inputs={"case": case, "manual_test": manual_test})
    return to_result(flow.state)
