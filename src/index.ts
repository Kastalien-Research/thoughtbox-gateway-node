#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { parseArgs } from "./cli.js";
import { ThoughtboxServer } from "./server.js";
import { runStdioTransport, startHttpTransport } from "./transport/index.js";

async function main() {
  const config = loadConfig();
  const cliOptions = parseArgs();

  const shouldUseHttp =
    cliOptions.port || (process.env["PORT"] && !cliOptions.stdio);
  const port = cliOptions.port || config.port;

  if (shouldUseHttp) {
    startHttpTransport({ ...config, port });
  } else {
    const server = new ThoughtboxServer(config);
    await server.init();
    await runStdioTransport(server.getServer());
  }
}

main().catch((error) => {
  console.error("Fatal error running Thoughtbox Gateway:", error);
  process.exit(1);
});
