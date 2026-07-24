import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { getDay, getSummary } from "../services/summary";
import { READ_ONLY, dateField } from "./shared";
import type { ToolCtx } from "./shared";

export function registerSummaryTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "setos_get_day",
    {
      description:
        "Everything about one day in a single call (default today): calorie/macro totals, every meal with its id, the full workout, and body weight. " +
        "Reach for this first on 'how am I tracking today?', 'what did I eat on <date>?', 'what did I do yesterday?' — it replaces separate meal + workout + weight lookups.",
      inputSchema: { date: dateField.describe("Local date YYYY-MM-DD. Omit for today.") },
      annotations: READ_ONLY,
    },
    run(async (args: { date?: string }) => jsonResult(await getDay(ctx.db, ctx.userId, ctx.tz, args.date)))
  );

  server.registerTool(
    "setos_get_summary",
    {
      description:
        "Roll up a date range (default: last 7 days ending today): per-day calorie/macro totals, averages across days actually logged, which days had workouts, and the body-weight trend with net change. " +
        "Use for 'how was my week/month?', weekly reviews, and consistency or weight-trend questions. Specify `days` for a trailing window or `start`/`end` for an exact range (max 92 days). Set include_per_day false for just the aggregates.",
      inputSchema: {
        days: z.number().int().min(1).max(92).optional().describe("Trailing window ending `end`/today. Default 7."),
        start: dateField.describe("Exact range start YYYY-MM-DD (overrides `days`)."),
        end: dateField.describe("Range end YYYY-MM-DD. Default today."),
        include_per_day: z
          .boolean()
          .optional()
          .describe("false = omit the per-day breakdown and return only aggregates. Default true."),
      },
      annotations: READ_ONLY,
    },
    run(async (args) => jsonResult(await getSummary(ctx.db, ctx.userId, ctx.tz, args)))
  );
}
