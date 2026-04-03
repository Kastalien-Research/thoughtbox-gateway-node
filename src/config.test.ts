import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig — credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parses DEDALUS_CREDENTIALS JSON array correctly", () => {
    const creds = [
      { connection_name: "twitter", values: { api_key: "abc123" } },
      { connection_name: "github", values: { token: "gh-tok", enabled: true } },
    ];
    vi.stubEnv("DEDALUS_CREDENTIALS", JSON.stringify(creds));

    const config = loadConfig();

    expect(config.credentials).toEqual(creds);
  });

  it("returns undefined credentials when env var is not set", () => {
    const config = loadConfig();

    expect(config.credentials).toBeUndefined();
  });

  it("returns undefined and warns when env var is invalid JSON", () => {
    vi.stubEnv("DEDALUS_CREDENTIALS", "not-json{{{");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = loadConfig();

    expect(config.credentials).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not valid JSON"),
    );
  });

  it("returns undefined and warns when env var is valid JSON but not an array", () => {
    vi.stubEnv(
      "DEDALUS_CREDENTIALS",
      JSON.stringify({ connection_name: "twitter", values: {} }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = loadConfig();

    expect(config.credentials).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not a JSON array"),
    );
  });
});
