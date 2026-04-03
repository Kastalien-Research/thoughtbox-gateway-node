import type { IncomingHttpHeaders } from "node:http";

export type MarketplaceAuthOptions = {
  apiKey?: string;
  xAPIKey?: string;
};

function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function parseMarketplaceAuthHeaders(
  headers: IncomingHttpHeaders,
): MarketplaceAuthOptions {
  const authorization = getFirstHeaderValue(headers.authorization);
  if (authorization) {
    const [scheme, ...rest] = authorization.split(" ");
    const value = rest.join(" ").trim();

    switch (scheme) {
      case "Bearer":
        return value ? { apiKey: value } : {};
      default:
        throw new Error(
          'Unsupported authorization scheme. Expected the "Authorization" header to use Bearer.',
        );
    }
  }

  return {
    apiKey: getFirstHeaderValue(headers["x-dedalus-api-key"]),
    xAPIKey: getFirstHeaderValue(headers["x-api-key"]),
  };
}
