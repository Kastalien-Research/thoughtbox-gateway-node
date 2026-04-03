# Phase 2: OAuth Setup CLI

## Problem

DAuth-protected marketplace servers requiring OAuth (Gmail, Google Calendar) need a browser consent flow before the gateway can call them. The gateway is headless — it can't open a browser. Users need a way to complete OAuth flows and have tokens stored by DAuth for the gateway to use.

## Scope

Single-user. The gateway operator runs a setup script to pre-authorize OAuth connections. Tokens are stored by DAuth, associated with the operator's API key. The gateway itself doesn't change — DAuth handles token lifecycle (refresh, expiry).

## Design

### `scripts/authorize.py`

A Python script using the Dedalus SDK:

```python
# Usage: DEDALUS_API_KEY=... python scripts/authorize.py gmail-mcp

import asyncio, sys, webbrowser
from dedalus_labs import AsyncDedalus, AuthenticationError, DedalusRunner

async def main():
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
        body = e.body if isinstance(e.body, dict) else {}
        url = body.get("connect_url") or body.get("detail", {}).get("connect_url")
        if url:
            print(f"Opening browser for OAuth: {url}")
            webbrowser.open(url)
            input("Press Enter after completing OAuth...")
            # Retry to confirm
            await runner.run(
                input=f"List available tools on {slug}",
                model="anthropic/claude-haiku-4-5-20251001",
                mcp_servers=[slug],
            )
            print(f"Authorized for {slug}")
        else:
            raise

asyncio.run(main())
```

### `scripts/list-auth-status.py`

Shows which marketplace servers the user has authorized:

```python
# Lists all marketplace servers and their auth status
# Green = authorized, Yellow = auth required, White = open
```

## Verification

- Run `authorize.py gmail-mcp`, complete OAuth in browser
- Start gateway, verify gmail-mcp tools appear in catalog
- Call a gmail-mcp tool through thoughtbox_execute

## Dependencies

- `uv pip install dedalus-labs` (Python 3.10+)
- `DEDALUS_API_KEY` env var

## Open Questions

- Are OAuth tokens bound to the API key or the DPoP key pair from the setup script? If DPoP-bound, the gateway can't use tokens from a different client's flow.
- Does the gateway's chat completions call inherit the stored tokens automatically, or does it need to pass a session identifier?

## References

- Memory: `project_dauth_gateway_architecture.md` Phase 2
- Dedalus docs: OAuth flow (docs/dedalus-llms-full.md:2724)
- Dedalus docs: with_oauth_retry pattern (docs/dedalus-llms-full.md:2798)
