/**
 * Dedalus Marketplace integration.
 *
 * Fetches the public marketplace catalog, filters to open (no-auth)
 * servers, and presents them as virtual upstreams through GatewayRuntime.
 *
 * Tool execution routes through the Dedalus chat completions API
 * with `mcp_servers=["slug"]`, letting Dedalus resolve the server
 * and execute tools server-side.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildSearchCatalog } from "../code-mode/search-index.js";
import type { SearchCatalog } from "../code-mode/search-index.js";
import type { Logger } from "../types.js";
import type {
  GatewayRuntime,
  GatewayToolCall,
  GatewayToolSummary,
  GatewayUpstreamStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Marketplace API types
// ---------------------------------------------------------------------------

interface MarketplaceAuthTags {
  none?: boolean;
  oauth?: boolean;
  api_key?: boolean;
}

interface MarketplaceRepo {
  repo_id: string;
  slug: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  visibility: string;
  tool_count: number;
  has_dauth: boolean;
  mcp_url: string | null;
  tags: {
    auth: MarketplaceAuthTags;
    language?: string;
    use_cases?: Record<string, boolean>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface MarketplaceResponse {
  repositories: MarketplaceRepo[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARKETPLACE_URL = "https://www.dedaluslabs.ai/api/marketplace";
const DEDALUS_API_URL = "https://api.dedaluslabs.ai/v1/chat/completions";
const UPSTREAM_PREFIX = "dedalus:";
const TOOL_EXEC_MODEL = "anthropic/claude-haiku-4-5-20251001";

// ---------------------------------------------------------------------------
// Marketplace fetch
// ---------------------------------------------------------------------------

async function fetchOpenServers(
  logger: Logger,
): Promise<MarketplaceRepo[]> {
  const res = await fetch(MARKETPLACE_URL);
  if (!res.ok) {
    throw new Error(
      `Marketplace fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as MarketplaceResponse;
  const all = data.repositories ?? [];
  const open = all.filter((r) => r.tags?.auth?.none === true);
  logger.info(
    `[Dedalus] Fetched ${all.length} marketplace servers, ${open.length} open (no auth)`,
  );
  return open;
}

// ---------------------------------------------------------------------------
// Tool execution via Dedalus chat completions
// ---------------------------------------------------------------------------

async function callToolViaDedalus(
  apiKey: string,
  slug: string,
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
  logger: Logger,
  credentials: unknown[] | undefined,
): Promise<CallToolResult> {
  const prompt = toolArgs && Object.keys(toolArgs).length > 0
    ? `Call the tool "${toolName}" with arguments: ${JSON.stringify(toolArgs)}. Return only the tool result.`
    : `Call the tool "${toolName}" with no arguments. Return only the tool result.`;

  const body = {
    model: TOOL_EXEC_MODEL,
    mcp_servers: [slug],
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4096,
    ...(credentials ? { credentials } : {}),
  };

  const res = await fetch(DEDALUS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const rawText = await res.text().catch(() => "");
    const safeText = rawText.slice(0, 200);
    logger.error(
      `[Dedalus] Tool call failed for ${slug}/${toolName}: ${res.status} ${safeText}`,
    );
    return {
      content: [
        {
          type: "text",
          text: `Dedalus tool call failed: ${res.status} ${res.statusText}`,
        },
      ],
      isError: true,
    };
  }

  const completion = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string; tool_calls?: unknown[] };
    }>;
  };

  const message = completion.choices?.[0]?.message;
  const text = message?.content ?? "";

  return {
    content: [{ type: "text", text }],
    isError: false,
  };
}

// ---------------------------------------------------------------------------
// MarketplaceRuntime
// ---------------------------------------------------------------------------

function toUpstreamId(slug: string): string {
  return `${UPSTREAM_PREFIX}${slug}`;
}

function toSlug(upstreamId: string): string {
  return upstreamId.slice(UPSTREAM_PREFIX.length);
}

export function isMarketplaceUpstream(upstreamId: string): boolean {
  return upstreamId.startsWith(UPSTREAM_PREFIX);
}

function repoToUpstreamStatus(repo: MarketplaceRepo): GatewayUpstreamStatus {
  const useCases = repo.tags?.use_cases;
  const activeCategories = useCases
    ? Object.entries(useCases)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
    : [];

  return {
    id: toUpstreamId(repo.slug),
    name: repo.title ?? repo.slug,
    description: [
      repo.description ?? repo.subtitle ?? "",
      activeCategories.length > 0
        ? `Categories: ${activeCategories.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
    url: `dedalus-marketplace://${repo.slug}`,
    enabled: true,
    status: "available",
    toolCount: repo.tool_count,
  };
}

export class DedalusMarketplaceRuntime implements GatewayRuntime {
  private repos: MarketplaceRepo[] = [];
  private initialized = false;

  constructor(
    private readonly apiKey: string,
    private readonly logger: Logger,
    private readonly credentials: unknown[] | undefined = undefined,
  ) {}

  async refresh(): Promise<void> {
    this.repos = await fetchOpenServers(this.logger);
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.refresh();
    }
  }

  async getCatalog(): Promise<SearchCatalog> {
    await this.ensureInitialized();
    return buildSearchCatalog({
      upstreams: this.repos.map(repoToUpstreamStatus),
      tools: [],
    });
  }

  async listUpstreams(): Promise<GatewayUpstreamStatus[]> {
    await this.ensureInitialized();
    return this.repos.map(repoToUpstreamStatus);
  }

  async listTools(
    _args?: { upstreamId?: string },
  ): Promise<GatewayToolSummary[]> {
    // Marketplace API does not expose individual tool schemas.
    // The LLM discovers capabilities via upstream descriptions,
    // then calls tools by name through the Dedalus proxy.
    return [];
  }

  async callTool(args: GatewayToolCall): Promise<CallToolResult> {
    await this.ensureInitialized();
    const slug = toSlug(args.upstreamId);
    const repo = this.repos.find((r) => r.slug === slug);
    if (!repo) {
      throw new Error(`Unknown marketplace server: ${slug}`);
    }
    return callToolViaDedalus(
      this.apiKey,
      slug,
      args.toolName,
      args.arguments,
      this.logger,
      this.credentials,
    );
  }

  async close(): Promise<void> {
    // No persistent connections to clean up
  }
}

// ---------------------------------------------------------------------------
// CompositeGatewayRuntime
// ---------------------------------------------------------------------------

export class CompositeGatewayRuntime implements GatewayRuntime {
  constructor(private readonly runtimes: GatewayRuntime[]) {}

  async refresh(): Promise<void> {
    await Promise.allSettled(this.runtimes.map((r) => r.refresh()));
  }

  async getCatalog(): Promise<SearchCatalog> {
    const catalogs = await Promise.all(
      this.runtimes.map((r) => r.getCatalog()),
    );
    return buildSearchCatalog({
      upstreams: catalogs.flatMap((c) => c.upstreams),
      tools: catalogs.flatMap((c) => c.tools),
    });
  }

  async listUpstreams(): Promise<GatewayUpstreamStatus[]> {
    const lists = await Promise.all(
      this.runtimes.map((r) => r.listUpstreams()),
    );
    return lists.flat();
  }

  async listTools(
    args?: { upstreamId?: string },
  ): Promise<GatewayToolSummary[]> {
    if (args?.upstreamId) {
      const runtime = this.findOwner(args.upstreamId);
      if (runtime) {
        return runtime.listTools(args);
      }
      throw new Error(`Unknown upstream: ${args.upstreamId}`);
    }
    const lists = await Promise.all(
      this.runtimes.map((r) => r.listTools()),
    );
    return lists.flat();
  }

  async callTool(args: GatewayToolCall): Promise<CallToolResult> {
    const runtime = this.findOwner(args.upstreamId);
    if (runtime) {
      return runtime.callTool(args);
    }
    throw new Error(`Unknown upstream: ${args.upstreamId}`);
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.runtimes.map((r) => r.close()));
  }

  private findOwner(upstreamId: string): GatewayRuntime | undefined {
    if (isMarketplaceUpstream(upstreamId)) {
      return this.runtimes.find(
        (r) => r instanceof DedalusMarketplaceRuntime,
      );
    }
    // Default to first non-marketplace runtime
    return this.runtimes.find(
      (r) => !(r instanceof DedalusMarketplaceRuntime),
    );
  }
}
