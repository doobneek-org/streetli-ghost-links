"""You.com Search and Contents clients (header X-API-Key, per the event guide)."""
import httpx

from .config import require

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


def search(query: str, count: int) -> list[dict]:
    """Web results: [{url, title, description, snippets: [str]}]."""
    data = _post(SEARCH_URL, {"query": query, "count": count}, timeout=20)
    results = []
    for item in (data.get("results") or {}).get("web") or []:
        snippets = item.get("snippets") or []
        results.append({
            "url": item.get("url", ""),
            "title": item.get("title", ""),
            "description": item.get("description", ""),
            "snippets": [s for s in snippets if isinstance(s, str)],
        })
    return [r for r in results if r["url"].startswith(("http://", "https://"))]


def contents(urls: list[str]) -> dict[str, str]:
    """Clean markdown per URL. URLs missing from the result could not be fetched."""
    if not urls:
        return {}
    data = _post(CONTENTS_URL, {"urls": urls, "formats": ["markdown"]}, timeout=45)
    pages = {}
    for item in data if isinstance(data, list) else []:
        if isinstance(item, dict) and isinstance(item.get("markdown"), str):
            pages[item.get("url", "")] = item["markdown"]
    return pages
