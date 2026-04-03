import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { buildSearchCatalog, type SearchCatalog } from "../code-mode/search-index.js";
import type { Logger } from "../types.js";
import { loadGatewayManifest, resolveManifestHeaders } from "./manifest.js";
import type {
  GatewayManifest,
  GatewayManifestUpstream,
  GatewayRuntime,
  GatewayToolCall,
  GatewayToolSummary,
  GatewayUpstreamStatus,
} from "./types.js";

const GATEWAY_CLIENT_INFO = {
  name: "thoughtbox-gateway",
  version: "1.2.2",
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createStatus(upstream: GatewayManifestUpstream): GatewayUpstreamStatus {
  return {
    id: upstream.id,
    name: upstream.name ?? upstream.id,
    description: upstream.description,
    url: upstream.url,
    enabled: upstream.enabled !== false,
    status: upstream.enabled === false ? "disabled" : "unavailable",
    toolCount: 0,
  };
}

function toToolSummary(upstream: GatewayManifestUpstream, tool: Tool): GatewayToolSummary {
  return {
    upstreamId: upstream.id,
    upstreamName: upstream.name ?? upstream.id,
    name: tool.name,
    title: tool.title ?? tool.annotations?.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    execution: tool.execution,
  };
}

class HostedHttpUpstream {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private status: GatewayUpstreamStatus;
  private tools: GatewayToolSummary[] = [];

  constructor(
    private readonly upstream: GatewayManifestUpstream,
    private readonly logger: Logger,
    private readonly fetchImpl?: typeof fetch,
  ) {
    this.status = createStatus(upstream);
  }

  private async ensureConnected(): Promise<void> {
    if (this.transport && this.client) {
      return;
    }

    const headers = resolveManifestHeaders(this.upstream);
    const transportOptions: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = {};
    if (headers) {
      transportOptions.requestInit = { headers };
    }
    if (this.fetchImpl) {
      transportOptions.fetch = this.fetchImpl;
    }

    this.transport = new StreamableHTTPClientTransport(new URL(this.upstream.url), transportOptions);
    this.client = new Client(GATEWAY_CLIENT_INFO, { capabilities: {} });
    await this.client.connect(this.transport);
  }

  private async resetConnection(): Promise<void> {
    const transport = this.transport;
    const client = this.client;
    this.transport = null;
    this.client = null;

    await Promise.allSettled([
      transport?.close(),
      client?.close(),
    ]);
  }

  private markUnavailable(message: string): void {
    this.status = {
      ...this.status,
      status: this.status.enabled ? "unavailable" : "disabled",
      error: message,
      toolCount: 0,
    };
    this.tools = [];
  }

  async refreshTools(): Promise<void> {
    if (this.upstream.enabled === false) {
      this.status = {
        ...this.status,
        status: "disabled",
        error: undefined,
        toolCount: 0,
      };
      this.tools = [];
      return;
    }

    try {
      await this.ensureConnected();
      const { tools } = await this.client!.listTools();
      this.tools = tools.map((tool) => toToolSummary(this.upstream, tool));
      this.status = {
        ...this.status,
        status: "available",
        toolCount: this.tools.length,
        error: undefined,
      };
    } catch (error) {
      const message = normalizeError(error);
      this.logger.warn(`Gateway upstream "${this.upstream.id}" failed during tool discovery: ${message}`);
      this.markUnavailable(message);
      await this.resetConnection();
    }
  }

  async callTool(args: GatewayToolCall): Promise<CallToolResult> {
    if (this.upstream.enabled === false) {
      throw new Error(`Gateway upstream "${this.upstream.id}" is disabled`);
    }

    try {
      await this.ensureConnected();
      const result = await this.client!.callTool({
        name: args.toolName,
        arguments: args.arguments ?? {},
      });

      this.status = {
        ...this.status,
        status: "available",
        error: undefined,
      };
      return result as CallToolResult;
    } catch (error) {
      const message = normalizeError(error);
      this.logger.warn(`Gateway upstream "${this.upstream.id}" failed during tool call "${args.toolName}": ${message}`);
      this.markUnavailable(message);
      await this.resetConnection();
      throw new Error(`Gateway upstream "${this.upstream.id}" call failed: ${message}`);
    }
  }

  getStatus(): GatewayUpstreamStatus {
    return clone(this.status);
  }

  getTools(): GatewayToolSummary[] {
    return clone(this.tools);
  }

  async close(): Promise<void> {
    await this.resetConnection();
  }
}

export class GatewayRegistry implements GatewayRuntime {
  private readonly upstreams: Map<string, HostedHttpUpstream>;
  private initialized = false;

  constructor(
    private readonly manifest: GatewayManifest,
    private readonly logger: Logger,
    options?: { fetch?: typeof fetch },
  ) {
    this.upstreams = new Map(
      manifest.upstreams.map((upstream) => [
        upstream.id,
        new HostedHttpUpstream(upstream, logger, options?.fetch),
      ]),
    );
  }

  static async fromDefaultManifest(logger: Logger): Promise<GatewayRegistry> {
    const manifest = await loadGatewayManifest();
    return new GatewayRegistry(manifest, logger);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.refresh();
    }
  }

  private getUpstream(id: string): HostedHttpUpstream {
    const upstream = this.upstreams.get(id);
    if (!upstream) {
      throw new Error(`Unknown gateway upstream "${id}"`);
    }
    return upstream;
  }

  async refresh(): Promise<void> {
    await Promise.allSettled(
      [...this.upstreams.values()].map((upstream) => upstream.refreshTools()),
    );
    this.initialized = true;
  }

  async getCatalog(): Promise<SearchCatalog> {
    await this.ensureInitialized();
    return buildSearchCatalog({
      upstreams: [...this.upstreams.values()].map((upstream) => upstream.getStatus()),
      tools: [...this.upstreams.values()].flatMap((upstream) => upstream.getTools()),
    });
  }

  async listUpstreams(): Promise<GatewayUpstreamStatus[]> {
    await this.ensureInitialized();
    return [...this.upstreams.values()].map((upstream) => upstream.getStatus());
  }

  async listTools(args?: { upstreamId?: string }): Promise<GatewayToolSummary[]> {
    await this.ensureInitialized();

    if (args?.upstreamId) {
      return this.getUpstream(args.upstreamId).getTools();
    }

    return [...this.upstreams.values()].flatMap((upstream) => upstream.getTools());
  }

  async callTool(args: GatewayToolCall): Promise<CallToolResult> {
    await this.ensureInitialized();
    return this.getUpstream(args.upstreamId).callTool(args);
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.upstreams.values()].map((upstream) => upstream.close()),
    );
  }
}
