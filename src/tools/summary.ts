import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { getDay, getWeek } from "../services/summary";
import { READ_ONLY, type ToolCtx } from "./shared";

export function registerSummaryTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "get_day",
    {
      description:
        "The full picture for one day (default today): calorie/macro totals, every meal logged, the workout (exercises + sets), and body weight. The go-to tool for 'how am I tracking today?' or 'what did I eat on <date>?'.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Local date YYYY-MM-DD. Omit for today."),
      },
      annotations: READ_ONLY,
    },
    run(async (args: { date?: string }) => jsonResult(await getDay(ctx.db, ctx.userId, ctx.tz, args.date)))
  );

  server.registerTool(
    "get_week",
    {
      description:
        "A 7-day rollup ending on end_date (default today): per-day calorie/macro totals, averages across the days actually logged, which days had workouts, and the body-weight trend (start → end change). Use for 'how was my week?' and weekly reviews.",
      inputSchema: {
        end_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Last day of the 7-day window, YYYY-MM-DD. Omit for today."),
      },
      annotations: READ_ONLY,
    },
    run(async (args: { end_date?: string }) => jsonResult(await getWeek(ctx.db, ctx.userId, ctx.tz, args.end_date)))
  );
}
