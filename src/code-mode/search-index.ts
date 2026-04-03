import type { GatewayCatalogSnapshot } from "../gateway/types.js";

export interface SearchCatalog extends GatewayCatalogSnapshot {}

export function buildSearchCatalog(snapshot: GatewayCatalogSnapshot): SearchCatalog {
  return {
    upstreams: structuredClone(snapshot.upstreams),
    tools: structuredClone(snapshot.tools),
  };
}
