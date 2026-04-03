# Phase 4: Universal MCP Endpoint (Dedalus First-Party)

## Problem

The Dedalus Marketplace is only accessible via the Dedalus SDK. This limits adoption to developers who learn the SDK. Any MCP client (Claude Desktop, Cursor, VS Code) should be able to connect to one URL and access the entire marketplace.

## Vision

The Thoughtbox Gateway becomes a Dedalus platform feature: a single MCP endpoint that aggregates every marketplace server. One connection, all servers. Code Mode collapses hundreds of tools into 2 (search + execute), solving the context window problem.

## What Changes from Phase 3

### Direct MCP Connections (replace chat completions proxy)

Phase 1-3 route tool calls through the Dedalus chat completions API — an LLM-mediated proxy. For first-party deployment, replace `DedalusMarketplaceRuntime` with `DedalusDirectRuntime` that connects directly to upstream MCP servers using Dedalus's internal service mesh.

```typescript
// New GatewayRuntime implementation
class DedalusDirectRuntime implements GatewayRuntime {
  // Connects directly to upstream MCP servers
  // Uses DAuth dispatch for credential-bearing calls
  // No LLM intermediary — direct MCP callTool
}
```

### Dispatch-Based Credential Forwarding

Instead of passing credentials in API calls, use DAuth's sealed enclave dispatch pattern. The gateway tells the enclave "call tool X on upstream Y with the user's credentials" and the enclave handles decryption, API call, and memory scrub.

### Personalized Catalogs

On connection, the gateway inspects the user's DAuth claims to determine which upstreams they've authorized. The catalog returned by `thoughtbox_search` is personalized:

- `status: "available"` — open server or user has authorized
- `status: "auth_required"` — DAuth-protected, user hasn't completed OAuth
- Upstreams with `auth_required` include a `connectUrl` field in their description

### Agent-Native Auth Management

Add `tb.gateway.authorize({ upstreamId })` to the SDK. Returns the connect_url for upstreams needing OAuth. The LLM can guide users through authorization within the conversation:

1. LLM searches catalog, finds gmail-mcp needs auth
2. LLM calls `tb.gateway.authorize({ upstreamId: "dedalus:gmail-mcp" })`
3. Gateway returns `{ connectUrl: "https://as.dedaluslabs.ai/..." }`
4. LLM shows URL to user, user authorizes in browser
5. LLM calls `tb.gateway.refresh()` to update catalog
6. LLM calls `tb.call()` to use gmail tools

### Information Flow Control (optional)

For enterprise deployments, the RPC handler enforces data flow policies between upstream groups:

- Personal group (email, calendar, contacts) — can share data freely
- Public group (search, weather, docs) — can share data freely
- Cross-group flow requires explicit user consent

## Security Properties (Six Layers)

1. Client → Gateway: DAuth JWT+DPoP, user identity
2. Gateway → Worker: process isolation, no credentials
3. Worker → RPC: capability boundary, allowed methods only
4. RPC → Dedalus: user token forwarded, per-upstream auth
5. Dedalus → Upstream: scoped token, per-service credentials
6. Upstream → Enclave: sealed execution, credential isolation

## What Dedalus Needs to Build

1. TypeScript DAuth validation middleware (or use MCP SDK's ProxyOAuthServerProvider)
2. MCP-aware dispatch in the sealed enclave (forward MCP protocol messages, not just HTTP)
3. Upstream catalog enrichment with auth status per user
4. `authorize` RPC method on the gateway

## Business Value

- Distribution: any MCP client, not just SDK users
- Scale: Code Mode collapses N tools to 2
- Security: emergent from architecture, not bolted on
- Revenue: per-call or subscription pricing through the gateway

## References

- Knowledge graph: `universal-mcp-endpoint`, `agent-native-auth-management`, `six-layer-defense`
- Memory: `project_dauth_gateway_architecture.md` Phase 4
- Dedalus docs: Dispatch/Connections (docs/dedalus-llms-full.md:3494)
- Dedalus docs: DAuth Architecture (docs/dedalus-llms-full.md:3549)
