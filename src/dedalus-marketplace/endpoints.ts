import {
  ExecuteTool,
  EXECUTE_TOOL,
  SearchTool,
  SEARCH_TOOL,
} from "../code-mode/index.js";
import { executeToolInputSchema } from "../code-mode/execute-tool.js";
import { searchToolInputSchema } from "../code-mode/search-tool.js";
import type { GatewayRuntime } from "../gateway/types.js";

type TextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type MarketplaceEndpointMetadata = {
  resource: string;
  operation: "read" | "write";
  tags: string[];
};

export type MarketplaceEndpointTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: Record<string, unknown>;
};

export type MarketplaceEndpoint = {
  metadata: MarketplaceEndpointMetadata;
  tool: MarketplaceEndpointTool;
  handler: (args: unknown) => Promise<TextResult>;
};

export interface CreateThoughtboxMarketplaceEndpointsArgs {
  gateway: GatewayRuntime;
}

function asToolDefinition(
  tool: typeof SEARCH_TOOL | typeof EXECUTE_TOOL,
): MarketplaceEndpointTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

export function createThoughtboxMarketplaceEndpoints(
  args: CreateThoughtboxMarketplaceEndpointsArgs,
): MarketplaceEndpoint[] {
  const searchTool = new SearchTool(() => args.gateway.getCatalog());
  const executeTool = new ExecuteTool({ gateway: args.gateway });

  return [
    {
      metadata: {
        resource: "gateway.catalog",
        operation: "read",
        tags: ["gateway", "code-mode", "search"],
      },
      tool: asToolDefinition(SEARCH_TOOL),
      handler: async (input) => searchTool.handle(searchToolInputSchema.parse(input)),
    },
    {
      metadata: {
        resource: "gateway.execute",
        operation: "write",
        tags: ["gateway", "code-mode", "execute"],
      },
      tool: asToolDefinition(EXECUTE_TOOL),
      handler: async (input) => executeTool.handle(executeToolInputSchema.parse(input)),
    },
  ];
}
