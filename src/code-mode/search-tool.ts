/**
 * Code Mode Search Tool
 *
 * Accepts LLM-generated JavaScript that runs against a live catalog
 * of gateway upstreams and proxied tools. The LLM has full programmatic
 * filtering power over the catalog — no need for predefined query patterns.
 */

import * as vm from "node:vm";
import { z } from "zod";
import type { SearchCatalog } from "./search-index.js";
import type { CodeModeResult } from "./types.js";

const MAX_LOGS = 100;
const TIMEOUT_MS = 10_000;
const MAX_RESULT_BYTES = 24_000;

export const searchToolInputSchema = z.object({
  code: z.string().describe(
    "JavaScript async arrow function that receives `catalog` and returns filtered results. " +
    "Example: `async () => catalog.upstreams` or " +
    "`async () => catalog.tools.filter(tool => tool.name.includes('search'))`"
  ),
});

export type SearchToolInput = z.infer<typeof searchToolInputSchema>;
export type SearchCatalogSource = SearchCatalog | (() => SearchCatalog | Promise<SearchCatalog>);

export const SEARCH_TOOL = {
  name: "thoughtbox_search",
  description: `Discover gateway upstreams and proxied tools by writing JavaScript that queries the catalog.

The \`catalog\` object is available in scope:

interface SearchCatalog {
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
}

Examples:
- List upstreams: \`async () => catalog.upstreams\`
- Find available tools: \`async () => catalog.tools.filter(tool => tool.upstreamId === "demo")\`
- Search by keyword: \`async () => catalog.tools.filter(tool => (tool.description ?? "").toLowerCase().includes("search"))\`
- Find schema-bearing tools: \`async () => catalog.tools.filter(tool => Object.keys(tool.inputSchema.properties ?? {}).length > 0)\``,
  inputSchema: searchToolInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

export class SearchTool {
  private readonly catalogSource: SearchCatalogSource;

  constructor(catalogSource: SearchCatalogSource) {
    this.catalogSource = catalogSource;
  }

  private async getCatalog(): Promise<SearchCatalog> {
    if (typeof this.catalogSource === "function") {
      return this.catalogSource();
    }

    return this.catalogSource;
  }

  async handle(input: SearchToolInput): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const start = Date.now();
    const logs: string[] = [];

    const cappedConsole = {
      log: (...args: unknown[]) => {
        if (logs.length < MAX_LOGS) logs.push(args.map(String).join(" "));
      },
      warn: (...args: unknown[]) => {
        if (logs.length < MAX_LOGS) logs.push(`[warn] ${args.map(String).join(" ")}`);
      },
      error: (...args: unknown[]) => {
        if (logs.length < MAX_LOGS) logs.push(`[error] ${args.map(String).join(" ")}`);
      },
    };

    const catalog = await this.getCatalog();
    const sandbox = {
      catalog: Object.freeze(catalog),
      console: cappedConsole,
      JSON,
      Object,
      Array,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Date,
      Math,
      Promise,
      Error,
      TypeError,
      RangeError,
    };

    const context = vm.createContext(sandbox);

    let output: CodeModeResult;
    try {
      const script = new vm.Script(`(${input.code})()`, {
        filename: "codemode-search.js",
      });
      const rawResult = script.runInContext(context, { timeout: TIMEOUT_MS });
      const result = await Promise.race([
        rawResult,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Search execution timed out")), TIMEOUT_MS)
        ),
      ]);

      const durationMs = Date.now() - start;
      let serialized = JSON.stringify(result, null, 2);
      let truncated = false;
      if (serialized && serialized.length > MAX_RESULT_BYTES) {
        serialized = serialized.slice(0, MAX_RESULT_BYTES) + "\n... [truncated]";
        truncated = true;
      }

      output = {
        result: truncated ? serialized : JSON.parse(serialized ?? "null"),
        logs,
        truncated: truncated || undefined,
        durationMs,
      };
    } catch (err) {
      output = {
        result: null,
        logs,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
    };
  }
}
