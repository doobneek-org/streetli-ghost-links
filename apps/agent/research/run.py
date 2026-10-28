"""Command line entry point.

  # A case from the running app's feed (npm start must be running):
  .venv/bin/python -m research.run --case-id <id>

  # A manual test on a public identifier you choose (not a Streetli case):
  .venv/bin/python -m research.run --manual-test --kind website \\
      --value https://old-site.org --org "Org name" --locality "Brooklyn, NY"

Add --jsonl to print machine-readable events (for the Node server later).
"""
import argparse
import json
import sys

import httpx

from . import config
from .flow import research

ICONS = {"start": "…", "done": "✓", "error": "✗", "info": "·"}


def load_case(case_id: str) -> dict:
    try:
        feed = httpx.get(config.cases_url(), timeout=120).json()
    except httpx.HTTPError:
        sys.exit(f"Could not reach {config.cases_url()}. Start the app with `npm start` first.")
    for case in feed.get("cases", []):
        if case.get("id") == case_id:
            return {**case, "_mode": feed.get("mode")}
    sys.exit(f"No case with id {case_id!r} in the {feed.get('mode')} feed.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Research where a retired contact identifier still appears online.")
    parser.add_argument("--case-id")
    parser.add_argument("--manual-test", action="store_true", help="Research an identifier you supply; labeled as a test")
    parser.add_argument("--kind", choices=["website", "phone", "email"], default="website")
    parser.add_argument("--value")
    parser.add_argument("--org")
    parser.add_argument("--locality", default="")
    parser.add_argument("--jsonl", action="store_true")
    parser.add_argument("--stdin", action="store_true",
                        help='Read {"case": {...}, "manualTest": bool} from stdin (used by the Node server)')
    args = parser.parse_args()

    def emit(event: dict) -> None:
        if args.jsonl:
            print(json.dumps({"type": "event", **event}), flush=True)
        else:
            print(f"{ICONS.get(event['status'], '·')} [{event['step']:8}] {event['message']}", flush=True)

    if args.stdin:
        payload = json.load(sys.stdin)
        if payload.get("eventText"):
            from .event_flow import check_event
            result = check_event(payload["eventText"], payload.get("cases"), emit=emit)
            print(json.dumps({"type": "result", **result}) if args.jsonl else json.dumps(result, indent=2), flush=True)
            return
        case, manual = payload["case"], bool(payload.get("manualTest"))
    elif args.case_id:
        case, manual = load_case(args.case_id), False
    elif args.manual_test and args.value and args.org:
        manual = True
        case = {"id": "manual-test", "organization": {"name": args.org, "locality": args.locality},
                "identifier": {"kind": args.kind, "value": args.value},
                "internal": {"state": "removed", "reasonCode": "manual_test", "correctedAt": None},
                "replacement": None, "reviewState": "manual_test"}
    else:
        parser.error("use --case-id, or --manual-test with --value and --org")

    result = research(case, manual_test=manual, emit=emit)
    if args.jsonl:
        print(json.dumps({"type": "result", **result}), flush=True)
    else:
        print("\nRESULT")
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
