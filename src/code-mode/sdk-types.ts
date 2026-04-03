/**
 * TypeScript type declarations for the `tb` SDK object.
 * Embedded in the thoughtbox_execute tool description so the LLM
 * gets type hints without loading the full gateway catalog first.
 */

export const TB_SDK_TYPES = `\`\`\`ts
interface TB {
  gateway: {
    listUpstreams(): Promise<Array<{
      id: string;
      name: string;
      description?: string;
      url: string;
      status: "available" | "unavailable" | "disabled";
      toolCount: number;
      error?: string;
    }>>;
    listTools(args?: { upstreamId?: string }): Promise<Array<{
      upstreamId: string;
      upstreamName: string;
      name: string;
      title?: string;
      description?: string;
      inputSchema: {
        type: "object";
        properties?: Record<string, object>;
        required?: string[];
      };
      annotations?: {
        title?: string;
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
      };
    }>>;
    getCatalog(): Promise<{
      upstreams: Array<{
        id: string;
        name: string;
        description?: string;
        url: string;
        status: "available" | "unavailable" | "disabled";
        toolCount: number;
        error?: string;
      }>;
      tools: Array<{
        upstreamId: string;
        upstreamName: string;
        name: string;
        title?: string;
        description?: string;
        inputSchema: object;
        annotations?: object;
      }>;
    }>;
    refresh(): Promise<{
      upstreams: Array<{
        id: string;
        name: string;
        url: string;
        status: "available" | "unavailable" | "disabled";
        toolCount: number;
        error?: string;
      }>;
      tools: Array<{
        upstreamId: string;
        upstreamName: string;
        name: string;
        title?: string;
        description?: string;
        inputSchema: object;
        annotations?: object;
      }>;
    }>;
    call(args: {
      upstreamId: string;
      toolName: string;
      arguments?: Record<string, unknown>;
    }): Promise<{
      content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
        | { type: "audio"; data: string; mimeType: string }
      >;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
      _meta?: Record<string, unknown>;
    }>;
  };

  call(args: {
    upstreamId: string;
    toolName: string;
    arguments?: Record<string, unknown>;
  }): Promise<{
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
      | { type: "audio"; data: string; mimeType: string }
    >;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    _meta?: Record<string, unknown>;
  }>;
}
\`\`\``;
