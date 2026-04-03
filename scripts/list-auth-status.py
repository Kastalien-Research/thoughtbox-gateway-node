"""
Auth status checker for Dedalus marketplace servers.

Usage: DEDALUS_API_KEY=... python scripts/list-auth-status.py [slug ...]
Output: ✓=authorized, !=auth required, ·=open, ?=error
"""

import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Literal, TypedDict

from dedalus_labs import AsyncDedalus, AuthenticationError, DedalusRunner

_URL = "https://www.dedaluslabs.ai/api/marketplace"
_MODEL = "anthropic/claude-haiku-4-5-20251001"

Status = Literal["authorized", "auth_required", "open", "error"]

_INDICATORS: dict[Status, str] = {
    "authorized": "✓",
    "auth_required": "!",
    "open": "·",
    "error": "?",
}


class AuthTags(TypedDict, total=False):
    none: bool


class ServerTags(TypedDict, total=False):
    auth: AuthTags


class MarketplaceServer(TypedDict, total=False):
    slug: str
    title: str
    tags: ServerTags
    tool_count: int


@dataclass
class ServerStatus:
    slug: str
    title: str
    status: Status
    tool_count: int


def fetch_marketplace() -> list[MarketplaceServer]:
    try:
        with urllib.request.urlopen(_URL, timeout=10) as res:
            data = json.loads(res.read().decode("utf-8"))
            return data.get("repositories", [])
    except urllib.error.URLError as e:
        print(f"Error: Failed to fetch marketplace: {e}", file=sys.stderr)
        sys.exit(1)


def _is_open(server: MarketplaceServer) -> bool:
    return server.get("tags", {}).get("auth", {}).get("none") is True


def resolve_test_slugs(
    servers: list[MarketplaceServer],
    cli_filter: set[str],
) -> set[str]:
    """Determine which slugs need auth probing."""
    all_slugs = {s["slug"] for s in servers if s.get("slug")}

    if cli_filter:
        unknown = cli_filter - all_slugs
        if unknown:
            print(
                f"Warning: unknown servers {unknown}",
                file=sys.stderr,
            )
        return cli_filter & all_slugs

    return {
        s["slug"] for s in servers
        if s.get("slug") and not _is_open(s)
    }


async def check_auth_status(
    runner: DedalusRunner,
    slug: str,
) -> Status:
    """Probe a single server. Returns status, never raises."""
    try:
        await runner.run(
            input=f"List available tools on {slug}",
            model=_MODEL,
            mcp_servers=[slug],
            max_tokens=256,
        )
        return "authorized"
    except AuthenticationError:
        return "auth_required"
    except Exception as exc:
        print(
            f"Warning: probe failed for {slug}: {exc}",
            file=sys.stderr,
        )
        return "error"


async def probe_servers(
    runner: DedalusRunner,
    slugs: set[str],
) -> dict[str, Status]:
    """Probe all slugs concurrently. Returns slug -> status."""
    if not slugs:
        return {}

    async def _probe(slug: str) -> tuple[str, Status]:
        status = await check_auth_status(runner, slug)
        return (slug, status)

    results = await asyncio.gather(*[_probe(s) for s in slugs])
    return dict(results)


def render_output(statuses: list[ServerStatus]) -> None:
    """Print status table and summary counts."""
    for s in statuses:
        ind = _INDICATORS[s.status]
        print(f"{ind} {s.slug:20} {s.title:30} ({s.tool_count} tools)")

    counts: dict[Status, int] = {
        key: sum(1 for s in statuses if s.status == key)
        for key in _INDICATORS
    }

    print()
    parts = [
        f"{counts['authorized']} authorized",
        f"{counts['auth_required']} auth required",
        f"{counts['open']} open",
    ]
    if counts["error"]:
        parts.append(f"{counts['error']} errors")
    print(f"Summary: {', '.join(parts)}")


async def main() -> None:
    """List authorization status for marketplace servers."""
    api_key = os.getenv("DEDALUS_API_KEY")
    if not api_key:
        print(
            "Error: DEDALUS_API_KEY environment variable not set",
            file=sys.stderr,
        )
        sys.exit(1)

    servers = fetch_marketplace()
    test_slugs = resolve_test_slugs(servers, set(sys.argv[1:]))

    client = AsyncDedalus()
    runner = DedalusRunner(client)
    auth_results = await probe_servers(runner, test_slugs)

    statuses: list[ServerStatus] = []
    for server in servers:
        slug = server.get("slug", "")
        if not slug:
            continue

        title = server.get("title") or slug
        tool_count = server.get("tool_count", 0)

        if _is_open(server):
            status: Status = "open"
        elif slug in auth_results:
            status = auth_results[slug]
        else:
            status = "auth_required"

        statuses.append(ServerStatus(slug, title, status, tool_count))

    render_output(statuses)


if __name__ == "__main__":
    asyncio.run(main())
