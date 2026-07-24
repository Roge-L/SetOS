import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { todayDate, shiftDate } from "../lib/dates";
import { READ_ONLY } from "./shared";
import type { ToolCtx } from "./shared";

/**
 * Zero-DB grounding tool. Resolves "today"/"yesterday" in the tracker's
 * timezone and states the logging conventions, so date maths and macro logging
 * start from the right place without a database round-trip.
 */
export function registerContextTool(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "setos_about",
    {
      description:
        "What SetOS is, today's and yesterday's date in the tracker's timezone, and the conventions for logging. Call this first when unsure about dates, or at the start of a session, before resolving relative dates like 'yesterday' or 'last Tuesday'.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    run(async () => {
      const today = todayDate(ctx.tz);
      return jsonResult({
        app: "SetOS — personal calorie/macro and workout tracker",
        timezone: ctx.tz,
        today,
        yesterday: shiftDate(today, -1),
        conventions: [
          "Dates are YYYY-MM-DD in the timezone above. Resolve relative dates ('yesterday', 'last night', 'on Tuesday') to a concrete date before calling; omit the date to mean today.",
          "Food: YOU estimate calories and macros for the portion eaten and pass them to setos_log_meals with your assumptions and a confidence. For branded/restaurant/packaged items call setos_lookup_food first for real data.",
          "Batch: log every item from one description in a single setos_log_meals call, and a whole workout in a single setos_log_workout call.",
          "Editing needs ids: get meal ids from setos_search_meals/setos_get_day, and session/exercise/set ids from setos_get_workouts.",
          "Workouts: expand shorthand into explicit sets. A plate = 135lb, plate+25 = 185lb, 2 plates = 225lb.",
          "The server rounds macros and keeps daily totals in sync — don't pre-round.",
          "Act without asking permission for ordinary logging; confirm before deleting.",
        ],
        capabilities: {
          meals: "log (batch), search/filter, update any field incl. moving days, delete by id",
          workouts: "log whole sessions, read full detail, edit session/exercise/individual set, delete at any level, per-lift progression + PRs",
          body: "log/overwrite and delete daily weight",
          summaries: "one day in full, or any range up to 92 days with averages, workout days and weight trend",
        },
      });
    })
  );
}
