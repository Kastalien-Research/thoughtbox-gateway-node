# Phase 3: Multi-User DAuth Middleware

## Problem

The gateway currently uses a single API key for all requests. Multi-user deployments need per-user credential isolation — User A's OAuth grants must not be accessible to User B. The gateway needs to become a DAuth-protected MCP server that validates per-user tokens and threads them through to upstream calls.

## Scope

Multi-user HTTP deployment. Each connecting client provides their own DAuth token. The gateway validates tokens, extracts claims, and forwards per-user identity to Dedalus API calls.

## Design

### MCP SDK Auth Stack

The MCP SDK 1.25 provides the infrastructure:

- `mcpAuthMetadataRouter` — serves `/.well-known/oauth-protected-resource` pointing at DAuth (`as.dedaluslabs.ai`)
- `ProxyOAuthServerProvider` — proxies OAuth authorization/token flows to DAuth
- `bearerAuth` middleware — validates bearer tokens on `/mcp` requests
- `AuthInfo` — carries clientId, scopes, token, expiry per request

### Gateway Changes

#### `src/transport/http.ts`

Wire the auth middleware into the Express app:

```typescript
import { mcpAuthMetadataRouter, ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth";

// Serve RFC 9728 metadata
app.use(mcpAuthMetadataRouter({
  oauthMetadata: { /* from DAuth discovery */ },
  resourceServerUrl: new URL("https://gateway.example.com"),
  scopesSupported: ["marketplace:search", "marketplace:execute"],
}));
```

#### `src/gateway/dedalus-marketplace.ts`

Thread the user's DAuth token through callToolViaDedalus:

```typescript
// Instead of using the gateway's static API key:
headers: { Authorization: `Bearer ${apiKey}` }

// Use the per-request user token:
headers: { Authorization: `Bearer ${userToken}` }
```

#### `src/code-mode/execute-tool.ts`

Pass user token through ExecuteToolDeps into the RPC handler. The token never enters the worker sandbox — it stays in the host process.

```typescript
export interface ExecuteToolDeps {
  gateway: GatewayRuntime;
  userToken?: string;  // Per-session DAuth token
}
```

### Scope Model

Two scopes:
- `marketplace:search` — access to thoughtbox_search (read-only catalog)
- `marketplace:execute` — access to thoughtbox_execute (can call upstream tools)

Per-upstream auth is handled by DAuth, not by gateway scopes. The gateway checks gateway-level scopes; DAuth checks upstream-level grants.

### Capability Narrowing

The RPC handler (`handleWorkerRpc`) can optionally check the user's DAuth claims before forwarding `gateway:callTool` to an upstream. If the user hasn't authorized a specific upstream, the handler returns an error with the connect_url for that upstream's OAuth flow.

## Verification

- Connect to gateway with a valid DAuth token — tool calls succeed
- Connect without a token — 401 with `/.well-known/oauth-protected-resource` discovery
- Connect with a token lacking `marketplace:execute` scope — search works, execute fails
- Two users with different OAuth grants see different catalog entries

## Dependencies

- `jose` (transitive dep, already available) for JWT/JWKS verification
- DAuth JWKS endpoint: `https://as.dedaluslabs.ai/.well-known/jwks.json`

## References

- Memory: `reference_mcp_sdk_auth.md` — full SDK auth API surface
- Memory: `project_dauth_gateway_architecture.md` Phase 3
- Knowledge graph: `mcp-sdk-oauth-server`, `six-layer-defense`, `rpc-security-boundary`
- SDK types: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/`
