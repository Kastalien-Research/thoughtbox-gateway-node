"""
OAuth authorization script for Dedalus marketplace servers.

Allows a gateway operator to complete OAuth authorization for a DAuth-protected
marketplace server. Requires DEDALUS_API_KEY environment variable.

Usage:
    DEDALUS_API_KEY=<api-key> python scripts/authorize.py <slug>

Example:
    DEDALUS_API_KEY=dauth_... python scripts/authorize.py gmail-mcp
"""

import asyncio
import sys
import webbrowser
from dedalus_labs import AsyncDedalus, AuthenticationError, DedalusRunner


async def main() -> None:
    """Authorize a marketplace server via OAuth."""
    if len(sys.argv) < 2:
        print("Usage: python scripts/authorize.py <slug>", file=sys.stderr)
        print(
            "Example: python scripts/authorize.py gmail-mcp",
            file=sys.stderr,
        )
        sys.exit(1)

    slug = sys.argv[1]

    client = AsyncDedalus()
    runner = DedalusRunner(client)

    try:
        await runner.run(
            input=f"List available tools on {slug}",
            model="anthropic/claude-haiku-4-5-20251001",
            mcp_servers=[slug],
        )
        print(f"Already authorized for {slug}")
    except AuthenticationError as e:
        # Extract connect_url from error body
        body = e.body if isinstance(e.body, dict) else {}
        url = body.get("connect_url") or (
            body.get("detail", {}).get("connect_url")
            if isinstance(body.get("detail"), dict)
            else None
        )

        if url:
            print(f"Opening browser for OAuth: {url}")
            webbrowser.open(url)
            input("Press Enter after completing OAuth...")

            # Retry to confirm authorization succeeded
            await runner.run(
                input=f"List available tools on {slug}",
                model="anthropic/claude-haiku-4-5-20251001",
                mcp_servers=[slug],
            )
            print(f"Authorized for {slug}")
        else:
            print(f"Error: No OAuth URL found in error response", file=sys.stderr)
            raise


if __name__ == "__main__":
    asyncio.run(main())
