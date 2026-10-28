"""Run one job from Ivan's discovery planner (packages/contracts/discovery-plan.mjs).

job.queries (at most two, prebuilt by the planner) -> You.com Search (job.maxResults)
-> drop excluded/unsafe URLs -> You.com Contents (job.maxPages, max_age 0)
-> verify-reference stage per case in job.caseIds.

Returns raw stage outputs plus the documents they cite. The Node runtime validates
each output with validateVerification and stores receipts; this module saves nothing.
"""
from urllib.parse import urlparse

from . import stages, youcom
from .flow import Emit, now

MAX_DOCUMENT_CHARS = 12000


def _allowed(url: str, excluded: list[str]) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return bool(host) and not any(host == d or host.endswith("." + d) for d in excluded)


def run_job(job: dict, cases: list[dict], emit: Emit) -> dict:
    excluded = [d.lower() for d in job.get("excludedDomains", [])]
    emit({"at": now(), "step": "search", "status": "start", "message": f"{job['kind']} job: {len(job['queries'])} You.com queries"})
    leads, snippets = [], {}
    for query in job["queries"][:2]:
        try:
            for result in youcom.search(query, int(job.get("maxResults", 5))):
                if result["url"] not in leads and _allowed(result["url"], excluded):
                    leads.append(result["url"])
                    snippets[result["url"]] = " ".join(result["snippets"])[:1000] or result["description"][:1000]
        except youcom.YouComError as error:
            emit({"at": now(), "step": "search", "status": "error", "message": str(error)})
            return {"jobId": job["id"], "binding": job["binding"], "status": "error", "error": "search_failed"}
    pages_to_fetch = leads[: int(job.get("maxPages", 3))]
    emit({"at": now(), "step": "search", "status": "done", "message": f"{len(leads)} candidate pages, fetching {len(pages_to_fetch)}"})

    fetched = {}
    if pages_to_fetch:
        try:
            fetched = youcom.contents(pages_to_fetch, fresh=True)
        except youcom.YouComError as error:
            emit({"at": now(), "step": "fetch", "status": "error", "message": f"{error}; pages stay unavailable"})
    observed = now()
    documents = []
    for index, url in enumerate(leads, 1):
        if url in fetched:
            documents.append({"id": f"doc-{index}", "url": url, "text": fetched[url][:MAX_DOCUMENT_CHARS], "status": "fetched", "observedAt": observed})
        elif url in pages_to_fetch:
            documents.append({"id": f"doc-{index}", "url": url, "text": "", "status": "unavailable", "observedAt": observed})
        else:
            documents.append({"id": f"doc-{index}", "url": url, "text": snippets.get(url, ""), "status": "snippet", "observedAt": observed})
    emit({"at": now(), "step": "fetch", "status": "done", "message": f"Fetched {len(fetched)} of {len(pages_to_fetch)} pages"})

    verifications = []
    by_id = {c["id"]: c for c in cases}
    for case_id in job["caseIds"]:
        case = by_id.get(case_id)
        if not case:
            continue
        emit({"at": now(), "step": "verify", "status": "start", "message": f"Parasail verifying {case['organization']['name']} via CrewAI"})
        try:
            output = stages.run_stage("verify-reference", {"case": case, "documents": documents, "now": observed})
            verifications.append({"caseId": case_id, "output": output})
            emit({"at": now(), "step": "verify", "status": "done", "message": f"{case['organization']['name']}: {output['verdict']}"})
        except Exception as error:
            verifications.append({"caseId": case_id, "error": type(error).__name__})
            emit({"at": now(), "step": "verify", "status": "error", "message": f"Verification failed: {type(error).__name__}"})
    return {"jobId": job["id"], "binding": job["binding"], "status": "completed", "checkedAt": observed,
            "documents": documents, "verifications": verifications}
