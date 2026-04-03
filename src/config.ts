export interface Config {
  dedalusApiKey: string | undefined;
  port: number;
  isProduction: boolean;
  credentials: unknown[] | undefined;
}

function parseCredentials(raw: string | undefined): unknown[] | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[Config] DEDALUS_CREDENTIALS is not valid JSON — ignoring credentials",
    );
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    console.warn(
      "[Config] DEDALUS_CREDENTIALS is not a JSON array — ignoring credentials",
    );
    return undefined;
  }
  return parsed;
}

export function loadConfig(): Config {
  const dedalusApiKey = process.env["DEDALUS_API_KEY"] || undefined;
  const port = parseInt(process.env["PORT"] || "8080", 10);
  const isProduction = process.env["NODE_ENV"] === "production";
  const credentials = parseCredentials(process.env["DEDALUS_CREDENTIALS"]);

  return {
    dedalusApiKey,
    port,
    isProduction,
    credentials,
  };
}
