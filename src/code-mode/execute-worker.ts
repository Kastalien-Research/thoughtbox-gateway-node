export function executeWorkerMain(): void {
  const { parentPort, workerData } = require("node:worker_threads") as typeof import("node:worker_threads");
  const util = require("node:util") as typeof import("node:util");

  if (!parentPort) {
    throw new Error("thoughtbox_execute worker must be started with a parent port");
  }
  const port = parentPort;

  const MAX_LOGS = 100;
  const pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  let nextRequestId = 1;

  function normalizeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function rejectBlockedSyntax(code: string): void {
    const blockedPatterns: Array<{ pattern: RegExp; message: string }> = [
      {
        pattern: /\bimport\s*\(/,
        message: "Dynamic import is not available inside thoughtbox_execute.",
      },
      {
        pattern: /\bimport\s+[^("'`]/,
        message: "Import statements are not available inside thoughtbox_execute.",
      },
    ];

    for (const blockedPattern of blockedPatterns) {
      if (blockedPattern.pattern.test(code)) {
        throw new Error(blockedPattern.message);
      }
    }
  }

  function callHost(method: string, args?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      pendingRequests.set(id, {
        resolve,
        reject,
      });
      port.postMessage({
        type: "rpc",
        id,
        method,
        args,
      });
    });
  }

  port.on("message", (message: unknown) => {
    if (!message || typeof message !== "object") {
      return;
    }

    const payload = message as {
      type?: string;
      id?: number;
      result?: unknown;
      error?: string;
    };

    if (payload.type !== "rpc-result" || typeof payload.id !== "number") {
      return;
    }

    const pendingRequest = pendingRequests.get(payload.id);
    if (!pendingRequest) {
      return;
    }

    pendingRequests.delete(payload.id);

    if (payload.error) {
      pendingRequest.reject(new Error(payload.error));
      return;
    }

    pendingRequest.resolve(payload.result);
  });

  const logs: string[] = [];
  const cappedConsole = {
    log: (...args: unknown[]) => {
      if (logs.length < MAX_LOGS) logs.push(util.format(...args));
    },
    warn: (...args: unknown[]) => {
      if (logs.length < MAX_LOGS) logs.push(`[warn] ${util.format(...args)}`);
    },
    error: (...args: unknown[]) => {
      if (logs.length < MAX_LOGS) logs.push(`[error] ${util.format(...args)}`);
    },
  };

  const tbCall = async (args: {
    upstreamId: string;
    toolName: string;
    arguments?: Record<string, unknown>;
  }) => callHost("gateway:callTool", args);

  const tb = Object.freeze({
    gateway: Object.freeze({
      listUpstreams: async () => callHost("gateway:listUpstreams"),
      listTools: async (args?: { upstreamId?: string }) =>
        callHost("gateway:listTools", args ?? {}),
      getCatalog: async () => callHost("gateway:getCatalog"),
      refresh: async () => {
        await callHost("gateway:refresh");
        return callHost("gateway:getCatalog");
      },
      call: tbCall,
    }),
    call: tbCall,
  });

  const restrictedGlobals = ["process", "fetch", "require", "module", "exports"];

  function hideRestrictedGlobals(): Array<{
    key: string;
    hadOwnProperty: boolean;
    value: unknown;
  }> {
    return restrictedGlobals.map((key) => {
      const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, key);
      const value = (globalThis as Record<string, unknown>)[key];

      try {
        (globalThis as Record<string, unknown>)[key] = undefined;
      } catch {
        // Ignore if a global cannot be reassigned in this runtime.
      }

      return {
        key,
        hadOwnProperty,
        value,
      };
    });
  }

  function restoreRestrictedGlobals(
    snapshots: Array<{ key: string; hadOwnProperty: boolean; value: unknown }>,
  ): void {
    for (const snapshot of snapshots) {
      try {
        if (snapshot.hadOwnProperty) {
          (globalThis as Record<string, unknown>)[snapshot.key] = snapshot.value;
        } else {
          delete (globalThis as Record<string, unknown>)[snapshot.key];
        }
      } catch {
        // Ignore restore failures during worker teardown.
      }
    }
  }

  async function execute(code: string): Promise<unknown> {
    rejectBlockedSyntax(code);

    const hiddenGlobals = hideRestrictedGlobals();
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...args: string[]
      ) => (...values: unknown[]) => Promise<unknown>;

      const run = new AsyncFunction(
        "tb",
        "console",
        "setTimeout",
        "clearTimeout",
        `"use strict"; return (${code})();`,
      );

      return await run(tb, cappedConsole, setTimeout, clearTimeout);
    } finally {
      restoreRestrictedGlobals(hiddenGlobals);
    }
  }

  async function main(): Promise<void> {
    try {
      const code =
        workerData && typeof workerData === "object" && typeof workerData.code === "string"
          ? workerData.code
          : "";

      if (!code) {
        throw new Error("Missing code");
      }

      const result = await execute(code);
      port.postMessage({
        type: "result",
        result,
        logs,
      });
    } catch (error) {
      port.postMessage({
        type: "result",
        result: null,
        logs,
        error: normalizeError(error),
      });
    }
  }

  void main();
}
