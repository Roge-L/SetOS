/**
 * SetOS MCP worker entrypoint.
 *
 *   GET  /  or /health   → liveness (no auth)
 *   *    /mcp            → the MCP server (Streamable HTTP), bearer-gated
 *
 * Stateless: `createMcpHandler` needs no Durable Objects. Auth is a single bearer
 * check up front (src/auth.ts); everything past it is the tool/service layer.
 */

import { createMcpHandler } from "agents/mcp";
import { requireBearer } from "./auth";
import { buildServer } from "./server";
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json({ name: "setos", status: "ok" });
    }

    if (url.pathname === "/mcp") {
      const denied = requireBearer(request, env);
      if (denied) return denied;
      return createMcpHandler(buildServer(env), { route: "/mcp" })(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
