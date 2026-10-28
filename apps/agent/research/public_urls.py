"""Pure admission checks for public URLs passed to the external contents service.

These checks reject local/private literals and host syntax. DNS resolution and
redirect handling remain the external retrieval service's responsibility.
"""
import ipaddress
import re
from urllib.parse import urlsplit

_LOCAL_SUFFIXES = ("localhost", "local", "localdomain", "internal", "lan", "home",
                   "home.arpa", "corp", "onion", "test", "example", "invalid")
_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z", re.IGNORECASE)
_NUMERIC_LABEL = re.compile(r"(?:[0-9]+|0x[0-9a-f]+)\Z", re.IGNORECASE)


def public_url(url: object) -> bool:
    if not isinstance(url, str) or not url or len(url) > 2048 \
            or re.search(r"[\s\x00-\x1f\x7f\\]", url):
        return False
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        port = parsed.port
        if parsed.scheme not in ("http", "https") or not host \
                or parsed.username is not None or parsed.password is not None \
                or port not in (None, 80, 443):
            return False
        host = host.rstrip(".").lower()
        # A zone-qualified literal can name a local interface.
        if not host or "%" in host:
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            pass
        if any(host == suffix or host.endswith("." + suffix) for suffix in _LOCAL_SUFFIXES):
            return False
        host = host.encode("idna").decode("ascii")
        labels = host.split(".")
        if len(host) > 253 or len(labels) < 2 or not all(_LABEL.fullmatch(label) for label in labels):
            return False
        # Reject legacy browser IP spellings (integer, octal, hex and shortened)
        # instead of allowing them through as apparent DNS names.
        if all(_NUMERIC_LABEL.fullmatch(label) for label in labels):
            return False
        return bool(re.fullmatch(r"[a-z]{2,63}|xn--[a-z0-9-]{2,59}", labels[-1], re.IGNORECASE))
    except (ValueError, UnicodeError):
        return False


def retrieved_pages(data: object, requested_urls: list[str]) -> dict[str, str]:
    """Only requested public URLs with actual text count as fetched evidence."""
    requested = {url for url in requested_urls if public_url(url)}
    pages = {}
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        markdown = item.get("markdown")
        if isinstance(url, str) and url in requested \
                and isinstance(markdown, str) and markdown.strip():
            pages[url] = markdown
    return pages
