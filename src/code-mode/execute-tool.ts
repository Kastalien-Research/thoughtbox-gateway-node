/**
 * Code Mode Execute Tool
 *
 * Accepts LLM-generated JavaScript that works against proxied MCP
 * tools via the `tb` SDK object. The host launches a dedicated worker
 * and exposes only the narrow `tb.gateway` RPC surface into that worker.
 */

import { Worker } from "node:worker_threads";
import { z } from "zod";
import type { CodeModeResult } from "./types.js";
import { TB_SDK_TYPES } from "./sdk-types.js";
import type { GatewayRuntime } from "../gateway/types.js";
import { executeWorkerMain } from "./execute-worker.js";

const TIMEOUT_MS = 30_000;
const MAX_RESULT_BYTES = 24_000;

export const executeToolInputSchema = z.object({
  code: z.string().describe(
    "JavaScript async arrow function using the `tb` SDK. " +
      "Example: `async () => { const tools = await tb.gateway.listTools(); return tools; }`",
  ),
});

export type ExecuteToolInput = z.infer<typeof executeToolInputSchema>;

export interface ExecuteToolDeps {
  gateway: GatewayRuntime;
}

export const EXECUTE_TOOL = {
  name: "thoughtbox_execute",
  description: `Run JavaScript using the \`tb\` SDK to inspect upstreams and call proxied MCP tools in a single call.

${TB_SDK_TYPES}

Example:
\`\`\`js
async () => {
  const tools = await tb.gateway.listTools();
  const target = tools.find((tool) => tool.name === "ping");
  if (!target) {
    throw new Error("No ping tool found");
  }

  return await tb.gateway.call({
    upstreamId: target.upstreamId,
    toolName: target.name,
  });
}
\`\`\`

Use \`console.log()\` for debugging — output captured in response logs.
\`tb.gateway.call()\` returns the raw upstream MCP tool result.`,
  inputSchema: executeToolInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
};

type ExecuteWorkerMessage =
  | {
      type: "rpc";
      id: number;
      method: string;
      args?: unknown;
    }
  | {
      type: "result";
      result: unknown;
      logs?: unknown;
      error?: string;
    };

type ExecuteWorkerResult = {
  result: unknown;
  logs: string[];
  error?: string;
};

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handleWorkerRpc(
  deps: ExecuteToolDeps,
  worker: Worker,
  message: Extract<ExecuteWorkerMessage, { type: "rpc" }>,
): Promise<void> {
  const respond = (payload: { type: "rpc-result"; id: number; result?: unknown; error?: string }) => {
    worker.postMessage(payload); // eslint-disable-line unicorn/require-post-message-target-origin
  };

  try {
    switch (message.method) {
      case "gateway:getCatalog":
        respond({
          type: "rpc-result",
          id: message.id,
          result: await deps.gateway.getCatalog(),
        });
        return;
      case "gateway:listUpstreams":
        respond({
          type: "rpc-result",
          id: message.id,
          result: await deps.gateway.listUpstreams(),
        });
        return;
      case "gateway:listTools":
        respond({
          type: "rpc-result",
          id: message.id,
          result: await deps.gateway.listTools(
            message.args as { upstreamId?: string } | undefined,
          ),
        });
        return;
      case "gateway:refresh":
        await deps.gateway.refresh();
        respond({
          type: "rpc-result",
          id: message.id,
          result: null,
        });
        return;
      case "gateway:callTool":
        respond({
          type: "rpc-result",
          id: message.id,
          result: await deps.gateway.callTool(
            message.args as {
              upstreamId: string;
              toolName: string;
              arguments?: Record<string, unknown>;
            },
          ),
        });
        return;
      default:
        respond({
          type: "rpc-result",
          id: message.id,
          error: `Unknown execute worker RPC method "${message.method}"`,
        });
    }
  } catch (error) {
    respond({
      type: "rpc-result",
      id: message.id,
      error: normalizeError(error),
    });
  }
}

async function runInWorker(
  input: ExecuteToolInput,
  deps: ExecuteToolDeps,
): Promise<ExecuteWorkerResult> {
  return new Promise((resolve) => {
    const preamble = "var __name = (target, value) => Object.defineProperty(target, 'name', { value, configurable: true });";
    const worker = new Worker(`${preamble};(${executeWorkerMain.toString()})();`, {
      eval: true,
      workerData: {
        code: input.code,
      },
    });

    let settled = false;
    const finish = (result: ExecuteWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      void worker.terminate().catch(() => {});
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      finish({
        result: null,
        logs: [],
        error: "Execution timed out",
      });
    }, TIMEOUT_MS);

    worker.on("message", (message: ExecuteWorkerMessage) => {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.type === "rpc") {
        void handleWorkerRpc(deps, worker, message);
        return;
      }

      if (message.type === "result") {
        finish({
          result: message.result,
          logs: Array.isArray(message.logs) ? message.logs.map(String) : [],
          error: message.error,
        });
      }
    });

    worker.on("error", (error) => {
      finish({
        result: null,
        logs: [],
        error: normalizeError(error),
      });
    });

    worker.on("exit", (code) => {
      if (settled || code === 0) {
        return;
      }

      finish({
        result: null,
        logs: [],
        error: `Execute worker exited with code ${code}`,
      });
    });
  });
}

export class ExecuteTool {
  private deps: ExecuteToolDeps;

  constructor(deps: ExecuteToolDeps) {
    this.deps = deps;
  }

  async handle(input: ExecuteToolInput): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const start = Date.now();

    let output: CodeModeResult;
    try {
      const workerResult = await runInWorker(input, this.deps);
      if (workerResult.error) {
        output = {
          result: null,
          logs: workerResult.logs,
          error: workerResult.error,
          durationMs: Date.now() - start,
        };
      } else {
        const durationMs = Date.now() - start;
        let serialized = JSON.stringify(workerResult.result, null, 2) ?? "null";
        let truncated = false;
        if (serialized.length > MAX_RESULT_BYTES) {
          serialized = serialized.slice(0, MAX_RESULT_BYTES) + "\n... [truncated]";
          truncated = true;
        }

        output = {
          result: truncated ? serialized : JSON.parse(serialized),
          logs: workerResult.logs,
          truncated: truncated || undefined,
          durationMs,
        };
      }
    } catch (error) {
      output = {
        result: null,
        logs: [],
        error: normalizeError(error),
        durationMs: Date.now() - start,
      };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
    };
  }
}
