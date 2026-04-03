import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import type { GatewayRuntime } from "./gateway/types.js";
import type { Logger } from "./types.js";
import {
  GatewayRegistry,
  CompositeGatewayRuntime,
  DedalusMarketplaceRuntime,
} from "./gateway/index.js";
import { createThoughtboxMarketplaceServer } from "./dedalus-marketplace/server.js";

const logger: Logger = {
  debug: (msg, ...args) => console.error(`[DEBUG] ${msg}`, ...args),
  info: (msg, ...args) => console.error(`[INFO]  ${msg}`, ...args),
  warn: (msg, ...args) => console.error(`[WARN]  ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
};

async function buildGateway(config: Config): Promise<GatewayRuntime> {
  const fileGateway = await GatewayRegistry.fromDefaultManifest(logger);

  if (!config.dedalusApiKey) {
    return fileGateway;
  }

  const marketplace = new DedalusMarketplaceRuntime(
    config.dedalusApiKey,
    logger,
    config.credentials,
  );
  const composite = new CompositeGatewayRuntime([fileGateway, marketplace]);
  await composite.refresh();
  logger.info("[Dedalus] Marketplace integration enabled");
  return composite;
}

export class ThoughtboxServer {
  private readonly config: Config;
  private mcpServer: McpServer | null = null;
  private gateway: GatewayRuntime | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  async init(): Promise<void> {
    this.gateway = await buildGateway(this.config);
    this.mcpServer = await createThoughtboxMarketplaceServer({
      gateway: this.gateway,
    });
    this.setupErrorHandling();
  }

  getServer(): Server {
    if (!this.mcpServer) {
      throw new Error("ThoughtboxServer not initialized — call init() first");
    }
    return this.mcpServer.server;
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.mcpServer?.close(),
      this.gateway?.close(),
    ]);
  }

  private setupErrorHandling(): void {
    this.mcpServer!.server.onerror = (error) =>
      console.error("[MCP Error]", error);

    process.on("SIGINT", async () => {
      await this.close();
      process.exit(0);
    });
  }
}

export async function createStandaloneServer(
  config: Config,
): Promise<McpServer> {
  const gateway = await buildGateway(config);
  return createThoughtboxMarketplaceServer({ gateway });
}
