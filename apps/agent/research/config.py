"""Server-side settings. Reads the repository's ignored .env; never logs key values."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")

# Bounds that keep each case cheap. Pages are the main token cost, so we cap them.
MAX_SEARCH_RESULTS = 8
MAX_PAGES = 5
SNIPPET_RADIUS = 250
MAX_SNIPPETS_PER_PAGE = 3


def require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured in .env")
    return value


def make_llm(effort: str | None = None, max_tokens: int = 1500):
    from crewai import LLM

    return LLM(
        model="openai/" + require("PARASAIL_MODEL"),
        base_url=require("PARASAIL_BASE_URL"),
        api_key=require("PARASAIL_API_KEY"),
        temperature=0,
        max_tokens=max_tokens,
        # "low" cut reasoning tokens ~95% on parasail-glm-53 with the same verdicts in testing.
        reasoning_effort=effort or os.environ.get("PARASAIL_REASONING_EFFORT", "low"),
    )


def cases_url() -> str:
    return f"http://127.0.0.1:{os.environ.get('PORT', '4317')}/api/cases"
