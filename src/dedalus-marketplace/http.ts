import type { Server } from "node:http";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { GatewayRuntime } from "../gateway/types.js";
import { parseMarketplaceAuthHeaders } from "./auth.js";
import { createThoughtboxMarketplaceServer } from "./server.js";

function sendJsonRpcError(
  res: Response,
  status: number,
  message: string,
  code = -32000,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

function registerMethodNotAllowed(app: express.Express): void {
  const handleMethodNotAllowed = (_req: Request, res: Response) => {
    sendJsonRpcError(res, 405, "Method not supported");
  };

  app.get("/mcp", handleMethodNotAllowed);
  app.delete("/mcp", handleMethodNotAllowed);
}

export function createThoughtboxMarketplaceHttpApp(args: {
  gateway: GatewayRuntime;
}): express.Express {
  const app = express();
  app.set("query parser", "extended");
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      transport: "streamable-http",
      server: "thoughtbox",
      version: "1.2.2",
    });
  });

  app.get("/info", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      server: { name: "thoughtbox-server", version: "1.2.2" },
    });
  });

  registerMethodNotAllowed(app);

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      parseMarketplaceAuthHeaders(req.headers);
    } catch (error) {
      sendJsonRpcError(
        res,
        400,
        error instanceof Error ? error.message : String(error),
        -32600,
      );
      return;
    }

    const server = await createThoughtboxMarketplaceServer({
      gateway: args.gateway,
    });
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });

    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      await Promise.allSettled([transport.close(), server.close()]);
    };

    res.on("finish", () => {
      void cleanup();
    });
    res.on("close", () => {
      void cleanup();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      await cleanup();
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, "Internal server error", -32603);
      }
    }
  });

  return app;
}

export async function closeThoughtboxMarketplaceHttpServer(
  server: Server,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
