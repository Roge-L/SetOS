import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { logWeight } from "../services/body";
import { WRITE, type ToolCtx } from "./shared";

export function registerBodyTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "log_weight",
    {
      description:
        "Record body weight for a day (one entry per day; re-logging the same day overwrites it). kg is converted to lb and stored in pounds. Weight trends show up in get_week. Defaults to today.",
      inputSchema: {
        weight: z.number().positive().describe("Body weight value."),
        unit: z.enum(["lb", "kg"]).optional().describe("Unit of `weight`; default lb."),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Local date YYYY-MM-DD. Omit for today."),
        notes: z.string().nullable().optional().describe("Optional note, e.g. 'fasted, morning'."),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await logWeight(ctx.db, ctx.userId, ctx.tz, args)))
  );
}
