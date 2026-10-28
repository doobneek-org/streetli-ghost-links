"""You.com Search and Contents clients (header X-API-Key, per the event guide)."""
import httpx

from .config import require
from .public_urls import public_url, retrieved_pages

SEARCH_URL = "https://ydc-index.io/v1/search"
CONTENTS_URL = "https://ydc-index.io/v1/contents"


class YouComError(RuntimeError):
    pass


def _post(url: str, body: dict, timeout: float) -> object:
    try:
        response = httpx.post(url, json=body, timeout=timeout,
                              headers={"X-API-Key": require("YDC_API_KEY")})
    except httpx.HTTPError as error:
        raise YouComError(f"You.com request failed: {type(error).__name__}") from None
    if response.status_code == 429:
        raise YouComError(f"You.com rate limit; retry after {response.headers.get('Retry-After', '?')}s")
    if response.status_code != 200:
        raise YouComError(f"You.com returned HTTP {response.status_code}")
    return response.json()


def search(query: str, count: int, freshness: str | None = None) -> list[dict]:
    """Web results: [{url, title, description, snippets: [str], page_age}].
    freshness ("day", "week", "month", "year") limits results to recent pages."""
    body = {"query": query, "count": count, **({"freshness": freshness} if freshness else {})}
    data = _post(SEARCH_URL, body, timeout=20)
    results = []
    for item in (data.get("results") or {}).get("web") or []:
        snippets = item.get("snippets") or []
        results.append({
            "url": item.get("url", ""),
            "title": item.get("title", ""),
            "description": item.get("description", ""),
            "snippets": [s for s in snippets if isinstance(s, str)],
            "page_age": item.get("page_age") or "",
        })
    return [r for r in results if public_url(r["url"])]


def _fetchable(url: str) -> bool:
    return public_url(url)


def contents(urls: list[str], fresh: bool = False) -> dict[str, str]:
    """Clean markdown per URL. URLs missing from the result could not be fetched.
    One bad URL can fail a whole batch (HTTP 422), so a failed batch is retried per URL."""
    urls = [u for u in dict.fromkeys(urls) if _fetchable(u)]
    if not urls:
        return {}
    try:
        # fresh=True asks for a current fetch (max_age 0), as current verification requires.
        data = _post(CONTENTS_URL, {"urls": urls, "formats": ["markdown"], **({"max_age": 0} if fresh else {})}, timeout=45)
    except YouComError:
        if len(urls) == 1:
            raise
        pages = {}
        for url in urls:
            try:
                pages.update(contents([url], fresh))
            except YouComError:
                pass
        return pages
    return retrieved_pages(data, urls)
