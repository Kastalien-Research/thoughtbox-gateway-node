# Thoughtbox Gateway

A code-mode MCP gateway that proxies the entire Dedalus Marketplace through two tools: `thoughtbox_search` and `thoughtbox_execute`.

Instead of exposing hundreds of individual tools, the gateway gives the LLM a JavaScript sandbox with programmatic access to discover upstreams, filter tools, and call them — all in a single turn.

## Tools

- **thoughtbox_search** — Write JavaScript against a frozen `catalog` object to discover upstreams and tools. Runs in a `node:vm` sandbox. Read-only.
- **thoughtbox_execute** — Write JavaScript using the `tb` SDK to call proxied MCP tools. Runs in an isolated worker thread with RPC back to the gateway.

## Setup

Get a Dedalus API key from the [dashboard](https://dedaluslabs.ai).

### Claude Code / Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "thoughtbox-gateway": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/thoughtbox-node-gateway",
      "env": {
        "DEDALUS_API_KEY": "your-key-here"
      }
    }
  }
}
```

### HTTP transport

```bash
DEDALUS_API_KEY=your-key-here npm start
```

Server starts on `http://localhost:8080`. Connect any StreamableHTTP MCP client to `http://localhost:8080/mcp`.

### Dedalus SDK (Python)

```python
from dedalus_labs import AsyncDedalus, DedalusRunner

client = AsyncDedalus()
runner = DedalusRunner(client)

result = await runner.run(
    input="Use your tools to find the weather in San Francisco",
    model="anthropic/claude-sonnet-4-6",
    mcp_servers=["glassbead-tc/thoughtbox-gateway-node"],
)
```

### Dedalus SDK (TypeScript)

```typescript
import Dedalus from "dedalus-labs";
import { DedalusRunner } from "dedalus-labs";

const client = new Dedalus();
const runner = new DedalusRunner(client);

const result = await runner.run({
  input: "Use your tools to find the weather in San Francisco",
  model: "anthropic/claude-sonnet-4-6",
  mcpServers: ["glassbead-tc/thoughtbox-gateway-node"],
});
```

## How it works

The gateway connects to the Dedalus Marketplace API, fetches all open (no-auth) servers, and presents them as virtual upstreams. It also reads a local `thoughtbox.gateway.json` manifest for any additional upstream MCP servers you host yourself.

Tool execution routes through the Dedalus chat completions API — the gateway sends `mcp_servers: ["slug"]` and Dedalus resolves the server and runs the tool server-side.

## Configuration

| Environment variable | Required | Description |
|---|---|---|
| `DEDALUS_API_KEY` | Yes | Enables marketplace tool proxy |
| `PORT` | No | HTTP port (default: 8080) |
| `NODE_ENV` | No | Set to `production` for 0.0.0.0 binding |
| `THOUGHTBOX_GATEWAY_MANIFEST` | No | Path to local gateway manifest JSON |

## Development

```bash
bun install
bun run dev:stdio    # stdio transport
bun run dev:shttp    # HTTP transport on :8080
bun run build        # compile to dist/
```

## License

MIT
