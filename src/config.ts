export interface Config {
  dedalusApiKey: string | undefined;
  port: number;
  isProduction: boolean;
}

export function loadConfig(): Config {
  const dedalusApiKey = process.env.DEDALUS_API_KEY || undefined;
  const port = parseInt(process.env.PORT || "8080", 10);
  const isProduction = process.env.NODE_ENV === "production";

  return {
    dedalusApiKey,
    port,
    isProduction,
  };
}
