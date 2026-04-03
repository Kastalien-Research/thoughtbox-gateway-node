import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayRuntime } from "../gateway/types.js";
import { createThoughtboxMarketplaceEndpoints } from "./endpoints.js";

const THOUGHTBOX_MARKETPLACE_INSTRUCTIONS = `Thoughtbox is a code-mode-first MCP gateway.

Two tools:
- \`thoughtbox_search\`: Write JavaScript to query the upstream/tool catalog
- \`thoughtbox_execute\`: Write JavaScript using the \`tb\` SDK to call proxied tools

Workflow: search to discover available upstreams and tools, then execute code against them.
Use \`console.log()\` for debugging — output captured in response logs.`;

export function newThoughtboxMarketplaceServer(): McpServer {
  return new McpServer(
    {
      name: "thoughtbox-server",
      version: "1.2.2",
    },
    {
      instructions: THOUGHTBOX_MARKETPLACE_INSTRUCTIONS,
      capabilities: { tools: {} },
    },
  );
}

export async function initThoughtboxMarketplaceServer(args: {
  server: McpServer;
  gateway: GatewayRuntime;
}): Promise<McpServer> {
  const endpoints = createThoughtboxMarketplaceEndpoints({
    gateway: args.gateway,
  });

  for (const endpoint of endpoints) {
    args.server.registerTool(
      endpoint.tool.name,
      {
        description: endpoint.tool.description,
        inputSchema: endpoint.tool.inputSchema as any,
        annotations: endpoint.tool.annotations,
      },
      endpoint.handler as any,
    );
  }

  return args.server;
}

export async function createThoughtboxMarketplaceServer(args: {
  gateway: GatewayRuntime;
}): Promise<McpServer> {
  const server = newThoughtboxMarketplaceServer();
  return initThoughtboxMarketplaceServer({
    server,
    gateway: args.gateway,
  });
}
