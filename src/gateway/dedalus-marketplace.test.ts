import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DedalusMarketplaceRuntime } from "./dedalus-marketplace.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_SLUG = "twitter-mcp";
const FAKE_API_KEY = "test-api-key";

const FAKE_REPO = {
  repo_id: "r1",
  slug: FAKE_SLUG,
  title: "Twitter MCP",
  subtitle: null,
  description: null,
  visibility: "public",
  tool_count: 3,
  has_dauth: false,
  mcp_url: null,
  tags: { auth: { none: true } },
};

const MARKETPLACE_RESPONSE = { repositories: [FAKE_REPO] };

const COMPLETION_RESPONSE = {
  choices: [{ message: { content: "tool result text" } }],
};

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function mockFetch(
  marketplaceBody: unknown,
  completionBody: unknown,
  completionOk = true,
) {
  return vi.fn().mockImplementation((url: string, _opts?: RequestInit) => {
    if ((url as string).includes("marketplace")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(marketplaceBody),
      });
    }
    return Promise.resolve({
      ok: completionOk,
      status: completionOk ? 200 : 500,
      statusText: completionOk ? "OK" : "Internal Server Error",
      json: () => Promise.resolve(completionBody),
      text: () => Promise.resolve("upstream error text"),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DedalusMarketplaceRuntime.callTool — credentials passthrough", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("includes credentials in the request body when provided", async () => {
    const creds = [
      { connection_name: "twitter", values: { api_key: "abc123" } },
    ];
    const fetchSpy = mockFetch(MARKETPLACE_RESPONSE, COMPLETION_RESPONSE);
    global.fetch = fetchSpy as unknown as typeof global.fetch;

    const logger = makeLogger();
    const runtime = new DedalusMarketplaceRuntime(FAKE_API_KEY, logger, creds);
    await runtime.callTool({
      upstreamId: `dedalus:${FAKE_SLUG}`,
      toolName: "search",
      arguments: { query: "hello" },
    });

    const completionCall = fetchSpy.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && args[0].includes("chat/completions"),
    );
    expect(completionCall).toBeDefined();
    const sentBody = JSON.parse(completionCall![1].body as string);
    expect(sentBody.credentials).toEqual(creds);
  });

  it("omits credentials field from request body when undefined", async () => {
    const fetchSpy = mockFetch(MARKETPLACE_RESPONSE, COMPLETION_RESPONSE);
    global.fetch = fetchSpy as unknown as typeof global.fetch;

    const logger = makeLogger();
    const runtime = new DedalusMarketplaceRuntime(FAKE_API_KEY, logger);
    await runtime.callTool({
      upstreamId: `dedalus:${FAKE_SLUG}`,
      toolName: "search",
      arguments: { query: "hello" },
    });

    const completionCall = fetchSpy.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && args[0].includes("chat/completions"),
    );
    expect(completionCall).toBeDefined();
    const sentBody = JSON.parse(completionCall![1].body as string);
    expect(Object.prototype.hasOwnProperty.call(sentBody, "credentials")).toBe(
      false,
    );
  });

  it("credentials never appear in error log messages", async () => {
    const secretCred = [
      {
        connection_name: "twitter",
        values: { api_key: "SUPER_SECRET_KEY_XYZ" },
      },
    ];
    const fetchSpy = mockFetch(MARKETPLACE_RESPONSE, {}, false);
    global.fetch = fetchSpy as unknown as typeof global.fetch;

    const logger = makeLogger();
    const runtime = new DedalusMarketplaceRuntime(
      FAKE_API_KEY,
      logger,
      secretCred,
    );
    await runtime.callTool({
      upstreamId: `dedalus:${FAKE_SLUG}`,
      toolName: "search",
      arguments: {},
    });

    const allErrorLogs: string = logger.error.mock.calls
      .map((args: unknown[]) => args.join(" "))
      .join("\n");

    expect(allErrorLogs).not.toContain("SUPER_SECRET_KEY_XYZ");
    expect(allErrorLogs).not.toContain("credentials");
  });
});
