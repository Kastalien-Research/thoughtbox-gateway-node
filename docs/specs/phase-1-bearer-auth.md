# Phase 1: Bearer Auth Credential Passthrough

## Problem

The gateway currently only accesses open (no-auth) marketplace servers. Services that require API keys (X/Twitter, GitHub, Slack) are inaccessible. The gateway needs to forward encrypted credentials to Dedalus without seeing plaintext.

## Scope

Single-user, single API key. No OAuth, no multi-tenant. The gateway operator configures credentials at startup via environment variables.

## Changes

### `src/gateway/dedalus-marketplace.ts` — `callToolViaDedalus()`

The chat completions request body currently sends:

```typescript
const body = {
  model: TOOL_EXEC_MODEL,
  mcp_servers: [slug],
  messages: [{ role: "user", content: prompt }],
  max_tokens: 4096,
};
```

Add a `credentials` field when configured:

```typescript
const body = {
  model: TOOL_EXEC_MODEL,
  mcp_servers: [slug],
  messages: [{ role: "user", content: prompt }],
  max_tokens: 4096,
  ...(credentials ? { credentials } : {}),
};
```

### `src/gateway/dedalus-marketplace.ts` — `DedalusMarketplaceRuntime`

Accept an optional credentials config in the constructor. Credentials are pre-encrypted blobs (the Dedalus SDK handles encryption). For Phase 1, the operator provides pre-encrypted credential blobs via env vars or config.

### `src/config.ts`

Add optional `credentials` field to Config. Source from `DEDALUS_CREDENTIALS` env var (JSON-encoded array of credential objects).

## Verification

- Confirm the Dedalus chat completions API accepts a `credentials` field by testing with the Python SDK first
- Test with a Bearer-auth marketplace server (e.g., X API)
- Verify credentials never appear in logs or error messages

## Open Questions

- What is the exact JSON shape of the credentials field in the raw API? Need to inspect the SDK's wire format.
- Does the API accept pre-encrypted blobs from a different client, or must encryption happen with the same DPoP key?

## References

- Memory: `project_dauth_gateway_architecture.md` Phase 1
- Knowledge graph: `gateway-auth-architecture`, `rpc-security-boundary`
- Dedalus docs: Bearer Auth (docs/dedalus-llms-full.md:2242)
