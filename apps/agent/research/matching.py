"""Literal identifier matching. Runs before any model call: a page that does not
contain the old identifier never reaches Parasail."""
import re
from urllib.parse import urlparse


def search_term(kind: str, value: str) -> str:
    if kind == "website":
        parsed = urlparse(value if "://" in value else f"https://{value}")
        host = (parsed.hostname or value).removeprefix("www.")
        path = parsed.path.rstrip("/")
        return host + path
    if kind == "phone":
        # Pages write US numbers as 718-680-6344, not +17186806344; search the way they are written.
        digits = _us_digits(value)
        if digits:
            return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return value.strip()


def _us_digits(value: str) -> str | None:
    digits = re.sub(r"\D", "", value)
    digits = digits[1:] if len(digits) == 11 and digits.startswith("1") else digits
    return digits if len(digits) == 10 else None


def own_domain(kind: str, value: str) -> str | None:
    """The retired website's own host. We never fetch it: we want third-party listings."""
    if kind != "website":
        return None
    parsed = urlparse(value if "://" in value else f"https://{value}")
    return (parsed.hostname or "").removeprefix("www.") or None


def _pattern(kind: str, value: str) -> re.Pattern:
    if kind == "phone":
        digits = _us_digits(value)
        if digits:
            a, b, c = digits[:3], digits[3:6], digits[6:]
            return re.compile(rf"\(?{a}\)?[\s.\-]*{b}[\s.\-]*{c}")
    return re.compile(re.escape(search_term(kind, value)), re.IGNORECASE)


def find_snippets(kind: str, value: str, text: str, radius: int, limit: int) -> list[str]:
    snippets = []
    for match in _pattern(kind, value).finditer(text):
        start, end = max(0, match.start() - radius), min(len(text), match.end() + radius)
        snippets.append(" ".join(text[start:end].split()))
        if len(snippets) >= limit:
            break
    return snippets
