import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export interface GatewayManifestUpstream {
  id: string;
  name?: string;
  description?: string;
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface GatewayManifest {
  version: 1;
  upstreams: GatewayManifestUpstream[];
}

export type GatewayUpstreamStatus = {
  id: string;
  name: string;
  description?: string;
  url: string;
  enabled: boolean;
  status: "available" | "unavailable" | "disabled";
  toolCount: number;
  error?: string;
};

export type GatewayToolSummary = {
  upstreamId: string;
  upstreamName: string;
  name: string;
  title?: string;
  description?: string;
  inputSchema: Tool["inputSchema"];
  annotations?: Tool["annotations"];
  execution?: Tool["execution"];
};

export interface GatewayCatalogSnapshot {
  upstreams: GatewayUpstreamStatus[];
  tools: GatewayToolSummary[];
}

export interface GatewayToolCall {
  upstreamId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface GatewayRuntime {
  getCatalog(): Promise<GatewayCatalogSnapshot>;
  listUpstreams(): Promise<GatewayUpstreamStatus[]>;
  listTools(args?: { upstreamId?: string }): Promise<GatewayToolSummary[]>;
  callTool(args: GatewayToolCall): Promise<CallToolResult>;
  refresh(): Promise<void>;
  close(): Promise<void>;
}
