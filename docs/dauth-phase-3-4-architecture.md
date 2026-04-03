# DAuth Phases 3 & 4 — Architecture

Phase 3 adds multi-user DAuth token validation to the existing single-tenant gateway, threading
per-user credentials through the worker/RPC boundary into Dedalus API calls. Phase 4 replaces
the chat-completions proxy with direct MCP connections over Dedalus's service mesh and introduces
sealed-enclave dispatch, personalized catalogs, and agent-native authorization management.

## Key Files

| File | Current Role | Phase 3 Changes |
|------|-------------|-----------------|
| `src/transport/http.ts` | Express app, session map, `/mcp` POST | Add `mcpAuthMetadataRouter`, `bearerAuth` middleware |
| `src/server.ts` | `ThoughtboxServer` init, gateway wiring | Receive `AuthInfo` per request, pass `userToken` down |
| `src/gateway/types.ts` | `GatewayRuntime` interface | No change to interface; impls receive `userToken` |
| `src/code-mode/execute-tool.ts` | Worker spawn, RPC dispatch | Add `userToken?: string` to `ExecuteToolDeps` |
| `src/gateway/dedalus-marketplace.ts` | Calls Dedalus chat completions API | Replace static API key with per-request user token |

---

## Diagram 1 — Phase 3: Multi-User Auth Flow

The complete path from an unauthenticated MCP client connecting for the first time through DAuth
OAuth, to validated tool calls with per-user token forwarding. The MCP SDK's auth stack handles
RFC 9728 discovery and token validation so the gateway does not implement OAuth itself.

```mermaid
sequenceDiagram
    participant C as MCP Client<br/>(Claude Desktop / Cursor)
    participant GW as Gateway<br/>(Express + MCP SDK)
    participant DA as DAuth<br/>(as.dedaluslabs.ai)
    participant D as Dedalus API

    note over C,D: First Connection — No Token

    C->>GW: POST /mcp (no bearer token)
    GW-->>C: 401 + WWW-Authenticate<br/>resource_metadata=/.well-known/oauth-protected-resource

    C->>GW: GET /.well-known/oauth-protected-resource
    GW-->>C: { authorization_server: "https://as.dedaluslabs.ai",<br/>  scopes_supported: ["marketplace:search", "marketplace:execute"] }
    note right of GW: Served by mcpAuthMetadataRouter

    C->>DA: GET /.well-known/oauth-authorization-server
    DA-->>C: OAuth server metadata

    C->>DA: POST /authorize (PKCE)
    DA-->>C: auth code

    C->>DA: POST /token (code exchange)
    DA-->>C: { access_token, scope, expires_in }

    note over C,D: Authenticated Tool Call

    C->>GW: POST /mcp<br/>Authorization: Bearer <jwt>
    note right of GW: bearerAuth middleware:<br/>1. Fetch JWKS from DAuth<br/>2. Verify JWT signature<br/>3. Check scopes<br/>4. Attach AuthInfo to req

    GW->>GW: Extract AuthInfo<br/>{ clientId, scopes, token }

    GW->>GW: MCP handler dispatches<br/>thoughtbox_execute

    GW->>GW: ExecuteTool spawns worker<br/>Worker sends RPC: gateway:callTool

    note over GW: handleWorkerRpc checks scopes:<br/>marketplace:execute required for callTool

    GW->>D: POST /v1/tools/call<br/>Authorization: Bearer <user-jwt>
    note right of GW: Per-user token, not gateway API key

    D-->>GW: tool result
    GW-->>C: MCP CallToolResult
```

### Invariants

- The user token never enters the worker sandbox. It travels: `bearerAuth → AuthInfo → ExecuteToolDeps.userToken → handleWorkerRpc → gateway.callTool()`. The worker only sees RPC method names and arguments.
- If `marketplace:execute` scope is absent, `handleWorkerRpc` returns an error before calling `gateway.callTool()`. The worker never learns why.
- JWKS verification uses `jose` (already a transitive dep). The gateway caches the key set; it does not make a JWKS request on every tool call.

---

## Diagram 2 — Phase 3: Component Architecture

How the auth middleware layers onto the existing Express app and how the user token threads through
each processing stage without entering the sandboxed worker.

```mermaid
flowchart TD
    subgraph Express["Express App (transport/http.ts)"]
        A[POST /mcp] --> B[bearerAuth middleware]
        B -->|401| ERR[Error Response]
        B -->|AuthInfo attached| C[Session lookup / create]
        C --> D[StreamableHTTPServerTransport]
        D --> E[McpServer handler]
    end

    subgraph MCP["MCP Tool Dispatch (server.ts)"]
        E -->|thoughtbox_search| FS[thoughtbox_search handler]
        E -->|thoughtbox_execute| FE[thoughtbox_execute handler]
    end

    subgraph CodeMode["Code Mode (execute-tool.ts)"]
        FE --> ET[ExecuteTool.handle]
        ET --> W["Worker (isolated thread)"]
        W -->|RPC: gateway:callTool| RPC[handleWorkerRpc]
        RPC -->|scope check| SC{Has<br/>marketplace:execute?}
        SC -->|no| SCERR[Error → Worker]
        SC -->|yes| GRT[gateway.callTool<br/>+ userToken]
    end

    subgraph Gateway["Gateway Runtime (gateway/)"]
        GRT --> DMR[DedalusMarketplaceRuntime]
        DMR -->|Bearer: user-jwt| DAPI[(Dedalus API)]
    end

    subgraph Auth["MCP SDK Auth (injected at startup)"]
        META["mcpAuthMetadataRouter<br/>/.well-known/oauth-protected-resource"]
        BA["bearerAuth<br/>(JWKS verify, scope check)"]
        PROXY["ProxyOAuthServerProvider<br/>/authorize, /token proxy → DAuth"]
    end

    B -.->|implemented by| BA
    A -.->|also serves| META
    A -.->|OAuth endpoints| PROXY

    style W fill:#fef3c7,stroke:#d97706
    style Auth fill:#eff6ff,stroke:#3b82f6
    style SC fill:#fef2f2,stroke:#ef4444
```

### Design notes

The worker is intentionally isolated (yellow). It executes untrusted LLM-generated JavaScript and
communicates only via structured RPC messages — it cannot read `ExecuteToolDeps.userToken` directly.
The RPC handler in the host process performs all scope checks and all credential-bearing calls.

---

## Diagram 3 — Phase 3: Scope Model

Two gateway-level scopes gate the two Code Mode tools. Per-upstream authorization (e.g., user
granting Gmail access) is handled by DAuth, not by these gateway scopes.

```mermaid
flowchart LR
    subgraph Token["DAuth JWT (scopes claim)"]
        S1["marketplace:search"]
        S2["marketplace:execute"]
    end

    subgraph Tools["Gateway Tools"]
        T1["thoughtbox_search\n(read-only catalog)"]
        T2["thoughtbox_execute\n(calls upstream tools)"]
    end

    subgraph Upstreams["Upstream Authorization (DAuth)"]
        U1["dedalus:gmail-mcp"]
        U2["dedalus:github-mcp"]
        U3["dedalus:calendar-mcp"]
        U4["(any other upstream)"]
    end

    S1 -->|gates| T1
    S2 -->|gates| T2
    T2 -->|per-upstream check| U1
    T2 -->|per-upstream check| U2
    T2 -->|per-upstream check| U3
    T2 -->|per-upstream check| U4

    note1["Gateway checks scopes.\nDAuth checks per-upstream grants.\nTwo separate authorization layers."]

    style note1 fill:#f0fdf4,stroke:#16a34a
```

---

## Diagram 4 — Phase 4: System Context

The Universal MCP Endpoint vision: any standards-compliant MCP client connects to one URL and
reaches the entire Dedalus marketplace through two Code Mode tools, without learning the Dedalus SDK.

```mermaid
flowchart LR
    subgraph Clients["Any MCP Client"]
        CD[Claude Desktop]
        CU[Cursor]
        VS[VS Code]
        OT[Any future client]
    end

    subgraph GW4["Thoughtbox Gateway (Phase 4)"]
        EP["Single endpoint\nhttps://gateway.dedaluslabs.ai/mcp"]

        subgraph CM["Code Mode (2 tools)"]
            TS["thoughtbox_search\n— catalog + auth status"]
            TE["thoughtbox_execute\n— run tb.gateway.call()"]
        end

        subgraph Auth4["Auth Layer"]
            BA4["bearerAuth\n(DAuth JWT + DPoP)"]
            AUTH["tb.gateway.authorize()\nreturns connectUrl"]
        end
    end

    subgraph Mesh["Dedalus Service Mesh"]
        DDR["DedalusDirectRuntime\n(replaces MarketplaceRuntime)"]
        ENC["Sealed Enclave\n(dispatch + credential isolation)"]
    end

    subgraph Market["Dedalus Marketplace (N servers)"]
        GM["dedalus:gmail-mcp"]
        GH["dedalus:github-mcp"]
        SL["dedalus:slack-mcp"]
        NN["... N more servers"]
    end

    CD & CU & VS & OT --> EP
    EP --> BA4
    BA4 --> CM
    TS --> DDR
    TE --> DDR
    DDR --> ENC
    ENC --> GM & GH & SL & NN
    CM --> AUTH

    style ENC fill:#fef3c7,stroke:#d97706
    style CM fill:#eff6ff,stroke:#3b82f6
```

### What this replaces

Phases 1-3 route every tool call through the Dedalus chat completions API — an LLM intermediary.
Phase 4 introduces `DedalusDirectRuntime`, which sends MCP `callTool` messages directly over the
service mesh. The LLM is no longer in the execution path; it only generates the JavaScript that
the worker runs.

---

## Diagram 5 — Phase 4: Six-Layer Security Model

Each layer establishes a distinct trust boundary. Compromise of any single layer does not yield
credentials from deeper layers because credentials are not present — they are forwarded through
opaque dispatch or held in the sealed enclave.

```mermaid
flowchart TD
    L1["Layer 1: Client → Gateway\nDAuth JWT + DPoP binding\nIdentity: verified user\nWhat it prevents: token replay, impersonation"]

    L2["Layer 2: Gateway → Worker\nProcess isolation (worker_threads)\nNo credentials passed into worker\nWhat it prevents: code injection reaching credentials"]

    L3["Layer 3: Worker → RPC\nCapability boundary (allowed methods only)\nScope check before any callTool\nWhat it prevents: worker escaping sandbox via RPC"]

    L4["Layer 4: RPC → Dedalus\nUser token forwarded per-call\nPer-upstream grant check\nWhat it prevents: cross-user data access"]

    L5["Layer 5: Dedalus → Upstream\nScoped token (not user's master token)\nPer-service credentials\nWhat it prevents: upstream breach exposing all grants"]

    L6["Layer 6: Upstream → Enclave\nSealed execution\nCredential decryption inside enclave only\nMemory scrubbed after call\nWhat it prevents: credential exfiltration by gateway operator"]

    L1 --> L2 --> L3 --> L4 --> L5 --> L6

    style L1 fill:#eff6ff,stroke:#3b82f6
    style L2 fill:#fef3c7,stroke:#d97706
    style L3 fill:#fef3c7,stroke:#d97706
    style L4 fill:#f0fdf4,stroke:#16a34a
    style L5 fill:#f0fdf4,stroke:#16a34a
    style L6 fill:#fdf4ff,stroke:#9333ea
```

### What Dedalus must build for Layer 6

The sealed enclave dispatch requires three new platform capabilities:
1. MCP-aware dispatch (forward MCP protocol messages, not raw HTTP)
2. Per-user credential storage keyed to DAuth identity (encrypted at rest)
3. Memory scrub after each tool call returns

Layers 1-5 are built in the gateway; Layer 6 is a Dedalus platform responsibility.

---

## Diagram 6 — Phase 4: Agent-Native Auth Flow

When an LLM discovers that an upstream requires authorization, it can manage the entire OAuth flow
within the conversation without human intervention beyond visiting the authorization URL. This is the
`tb.gateway.authorize()` flow added in Phase 4.

```mermaid
sequenceDiagram
    participant U as User
    participant LLM as LLM (in conversation)
    participant GW as Gateway
    participant DA as DAuth

    LLM->>GW: thoughtbox_search({ query: "gmail" })
    GW-->>LLM: [{ id: "dedalus:gmail-mcp",<br/>  status: "auth_required",<br/>  connectUrl: "https://as.dedaluslabs.ai/..." }]

    note over LLM: Sees auth_required — invokes authorize()

    LLM->>GW: thoughtbox_execute<br/>tb.gateway.authorize({ upstreamId: "dedalus:gmail-mcp" })
    GW-->>LLM: { connectUrl: "https://as.dedaluslabs.ai/connect/gmail?state=..." }

    LLM->>U: "To use Gmail tools, please authorize here:\nhttps://as.dedaluslabs.ai/connect/gmail?state=..."

    U->>DA: Opens URL, completes OAuth grant
    DA-->>GW: Stores user→gmail credential association

    U->>LLM: "Done"

    LLM->>GW: thoughtbox_execute<br/>tb.gateway.refresh()
    GW-->>LLM: { upstreams: [{ id: "dedalus:gmail-mcp", status: "available" }] }

    LLM->>GW: thoughtbox_execute<br/>tb.gateway.call({ upstreamId: "dedalus:gmail-mcp",<br/>  toolName: "gmail_list_messages", ... })
    GW->>DA: Dispatch via sealed enclave<br/>(user gmail credential, never exposed to gateway)
    DA-->>GW: tool result
    GW-->>LLM: { result: [...messages] }
    LLM->>U: Shows email results
```

### Notes

- `tb.gateway.authorize()` is a new RPC method added to `handleWorkerRpc` in Phase 4. It exists
  so the LLM can request a connect URL without leaving the execute flow.
- `tb.gateway.refresh()` re-fetches the catalog so `status: "auth_required"` entries update to
  `status: "available"` after the user completes OAuth.
- The gateway never sees the upstream credential — it tells the enclave to dispatch on the user's
  behalf. The enclave decrypts, calls, and scrubs.

---

## Diagram 7 — Phase 3 to Phase 4 Evolution

A side-by-side comparison of the architectural changes. Green nodes are shared between phases;
yellow nodes are removed in Phase 4; blue nodes are introduced in Phase 4.

```mermaid
flowchart TD
    subgraph P3["Phase 3 (current target)"]
        P3C[MCP Client] --> P3GW[Gateway\nbearerAuth + mcpAuthMetadataRouter]
        P3GW --> P3ET[ExecuteTool\nworker sandbox]
        P3ET --> P3RPC[handleWorkerRpc\nscope check]
        P3RPC --> P3DMR["DedalusMarketplaceRuntime\n(chat completions proxy)"]
        P3DMR -->|Bearer: user-jwt| P3LLM["Dedalus LLM\n(chat completions API)"]
        P3LLM --> P3UP[Upstream MCP Server]

        style P3DMR fill:#fef3c7,stroke:#d97706
        style P3LLM fill:#fef3c7,stroke:#d97706
    end

    subgraph P4["Phase 4 (universal endpoint)"]
        P4C[Any MCP Client] --> P4GW[Gateway\nbearerAuth + DPoP]
        P4GW --> P4ET[ExecuteTool\nworker sandbox]
        P4ET --> P4RPC["handleWorkerRpc\nscope check + authorize()"]
        P4RPC --> P4DDR["DedalusDirectRuntime\n(service mesh, direct MCP)"]
        P4DDR --> P4ENC["Sealed Enclave\n(credential isolation)"]
        P4ENC --> P4UP[Upstream MCP Server]
        P4GW --> P4CAT["Personalized Catalog\n(auth_required / available)"]

        style P4DDR fill:#dbeafe,stroke:#3b82f6
        style P4ENC fill:#dbeafe,stroke:#3b82f6
        style P4CAT fill:#dbeafe,stroke:#3b82f6
    end

    subgraph Changes["What Changes"]
        direction LR
        RM["Removed:\nDedalusMarketplaceRuntime\nDedalus chat completions call\nLLM in execution path"]
        ADD["Added:\nDedalusDirectRuntime\nSealed enclave dispatch\nPersonalized catalog\ntb.gateway.authorize()\nDPoP binding"]
        KEEP["Unchanged:\nbearerAuth middleware\nworker sandbox\nRPC capability boundary\nscope model\nMCP SDK auth stack"]

        style RM fill:#fef2f2,stroke:#ef4444
        style ADD fill:#f0fdf4,stroke:#16a34a
        style KEEP fill:#f8fafc,stroke:#94a3b8
    end
```

### Migration path

Phase 3 is a self-contained deliverable. The `GatewayRuntime` interface (`src/gateway/types.ts`)
does not change — `DedalusDirectRuntime` implements the same interface as `DedalusMarketplaceRuntime`.
Phase 4 swaps the runtime implementation and adds the enclave dispatch plumbing on the Dedalus
platform side. The gateway's auth stack, worker sandbox, and RPC boundary carry forward unchanged.
