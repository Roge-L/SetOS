import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { logWeight, deleteWeight } from "../services/body";
import { DESTRUCTIVE, WRITE, dateField } from "./shared";
import type { ToolCtx } from "./shared";

export function registerBodyTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "setos_log_weight",
    {
      description:
        "Record body weight for a day. One entry per day — logging the same day again overwrites it, so this doubles as the edit. kg is converted to lb and stored in pounds. Weight trends appear in setos_get_summary. Defaults to today.",
      inputSchema: {
        weight: z.number().positive().describe("Body weight value."),
        unit: z.enum(["lb", "kg"]).optional().describe("Unit of `weight`; default lb."),
        date: dateField.describe("Local date YYYY-MM-DD. Omit for today."),
        notes: z.string().nullable().optional().describe("Optional note, e.g. 'fasted, morning'."),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async (args) => jsonResult(await logWeight(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "setos_delete_weight",
    {
      description: "Remove the body-weight entry for a day (defaults to today). Use when a weigh-in was logged by mistake.",
      inputSchema: { date: dateField.describe("Local date YYYY-MM-DD. Omit for today.") },
      annotations: DESTRUCTIVE,
    },
    run(async (args: { date?: string }) => jsonResult(await deleteWeight(ctx.db, ctx.userId, ctx.tz, args.date)))
  );
}
