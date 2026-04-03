import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GatewayManifest, GatewayManifestUpstream } from "./types.js";

const upstreamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

const manifestSchema = z.object({
  version: z.literal(1).default(1),
  upstreams: z.array(upstreamSchema).default([]),
}).superRefine((manifest, ctx) => {
  const seen = new Set<string>();
  for (const upstream of manifest.upstreams) {
    if (seen.has(upstream.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate upstream id "${upstream.id}" in gateway manifest`,
      });
    }
    seen.add(upstream.id);
  }
});

function parseManifest(raw: string): GatewayManifest {
  return manifestSchema.parse(JSON.parse(raw)) as GatewayManifest;
}

export function getDefaultGatewayManifestPath(cwd = process.cwd()): string {
  const configured = process.env["THOUGHTBOX_GATEWAY_MANIFEST"];
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(cwd, configured);
  }

  return path.resolve(cwd, "thoughtbox.gateway.json");
}

export async function loadGatewayManifest(filePath = getDefaultGatewayManifestPath()): Promise<GatewayManifest> {
  try {
    const raw = await readFile(filePath, "utf8");
    return parseManifest(raw);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, upstreams: [] };
    }
    throw error;
  }
}

const envTokenPattern = /\$\{([A-Z0-9_]+)\}/g;

function resolveHeaderValue(value: string): string {
  return value.replace(envTokenPattern, (_match, envName: string) => {
    const resolved = process.env[envName];
    if (resolved === undefined) {
      throw new Error(`Missing environment variable "${envName}" required by gateway manifest header interpolation`);
    }
    return resolved;
  });
}

export function resolveManifestHeaders(upstream: GatewayManifestUpstream): Record<string, string> | undefined {
  if (!upstream.headers) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(upstream.headers).map(([key, value]) => [key, resolveHeaderValue(value)]),
  );
}
