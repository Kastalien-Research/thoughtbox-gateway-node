import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createStandaloneServer } from "../server.js";
import type { Config } from "../config.js";

const sessions = new Map<
  string,
  { transport: StreamableHTTPServerTransport; server: McpServer }
>();

export function startHttpTransport(config: Config): void {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      transport: "streamable-http",
      server: "thoughtbox-gateway",
      version: "0.1.0",
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    try {
      const serverInstance = await createStandaloneServer(config);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server: serverInstance });
          console.error("[INFO]  New session created:", id);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          console.error("[INFO]  Session closed:", transport.sessionId);
        }
      };

      await serverInstance.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[ERROR] Streamable HTTP connection error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  const handleMethodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({ error: "Method not supported" });
  };
  app.get("/mcp", handleMethodNotAllowed);
  app.delete("/mcp", handleMethodNotAllowed);

  const host = config.isProduction ? "0.0.0.0" : "localhost";

  app.listen(config.port, host, () => {
    const displayUrl = config.isProduction
      ? `Port ${config.port}`
      : `http://localhost:${config.port}`;
    console.error(`[INFO]  Thoughtbox Gateway listening on ${displayUrl}`);

    if (!config.isProduction) {
      console.error(
        "Put this in your client config:\n" +
          JSON.stringify(
            {
              mcpServers: {
                "thoughtbox-gateway": {
                  url: `http://localhost:${config.port}/mcp`,
                },
              },
            },
            null,
            2,
          ),
      );
    }
  });
}
