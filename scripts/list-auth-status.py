"""
Auth status checker for Dedalus marketplace servers.

Usage: DEDALUS_API_KEY=... python scripts/list-auth-status.py [slug ...]
Output: ✓=authorized, !=auth required, ·=open
"""

import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass

from dedalus_labs import AsyncDedalus, AuthenticationError, DedalusRunner

_URL = "https://www.dedaluslabs.ai/api/marketplace"
_MODEL = "anthropic/claude-haiku-4-5-20251001"


@dataclass
class ServerStatus:
    slug: str
    title: str
    status: str
    tool_count: int


def fetch_marketplace() -> list[dict]:
    try:
        with urllib.request.urlopen(_URL, timeout=10) as res:
            return json.loads(res.read().decode("utf-8")).get("repositories", [])
    except urllib.error.URLError as e:
        print(f"Error: Failed to fetch marketplace: {e}", file=sys.stderr)
        sys.exit(1)


async def check_auth_status(runner: DedalusRunner, slug: str) -> bool:
    try:
        await runner.run(
            input=f"List available tools on {slug}",
            model=_MODEL,
            mcp_servers=[slug],
            max_tokens=256,
        )
        return True
    except AuthenticationError:
        return False


async def main() -> None:
    """List authorization status for marketplace servers."""
    api_key = os.getenv("DEDALUS_API_KEY")
    if not api_key:
        print(
            "Error: DEDALUS_API_KEY environment variable not set",
            file=sys.stderr,
        )
        sys.exit(1)

    cli_filter = set(sys.argv[1:])
    servers = fetch_marketplace()
    all_slugs = {s.get("slug") for s in servers if s.get("slug")}

    if cli_filter:
        unknown = cli_filter - all_slugs
        if unknown:
            print(f"Warning: unknown servers {unknown}", file=sys.stderr)
        test_slugs = cli_filter & all_slugs
    else:
        # No filter: probe every non-open server
        test_slugs = {
            s.get("slug") for s in servers
            if s.get("slug")
            and s.get("tags", {}).get("auth", {}).get("none") is not True
        }

    client = AsyncDedalus()
    runner = DedalusRunner(client)
    statuses: list[ServerStatus] = []

    for server in servers:
        slug = server.get("slug", "")
        if not slug:
            continue

        title = server.get("title") or slug
        tool_count = server.get("tool_count", 0)
        is_open = server.get("tags", {}).get("auth", {}).get("none") is True

        if is_open:
            status = "open"
        elif slug in test_slugs:
            status = (
                "authorized" if await check_auth_status(runner, slug)
                else "auth_required"
            )
        else:
            status = "auth_required"

        statuses.append(ServerStatus(slug, title, status, tool_count))

    counts = {
        "authorized": sum(1 for s in statuses if s.status == "authorized"),
        "auth_required": sum(1 for s in statuses if s.status == "auth_required"),
        "open": sum(1 for s in statuses if s.status == "open"),
    }

    indicators = {"authorized": "✓", "auth_required": "!", "open": "·"}
    for s in statuses:
        ind = indicators[s.status]
        print(f"{ind} {s.slug:20} {s.title:30} ({s.tool_count} tools)")

    print()
    print(
        f"Summary: {counts['authorized']} authorized, "
        f"{counts['auth_required']} auth required, {counts['open']} open"
    )


if __name__ == "__main__":
    asyncio.run(main())
