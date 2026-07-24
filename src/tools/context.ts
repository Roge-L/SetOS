import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { todayDate } from "../lib/dates";
import { READ_ONLY, type ToolCtx } from "./shared";

/**
 * about — a zero-DB grounding tool. Tells Claude what SetOS is, what "today" is in
 * the tracker's timezone, and the conventions to follow. Cheap to call at the
 * start of a session so date math and macro logging start from the right place.
 */
export function registerContextTool(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "about",
    {
      description:
        "What SetOS is, today's date in the tracker's timezone, and the conventions for logging. Call this first if unsure about dates or how to log.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    run(async () =>
      jsonResult({
        app: "SetOS — a personal calorie/macro and workout tracker",
        timezone: ctx.tz,
        today: todayDate(ctx.tz),
        tools: {
          food: ["log_food", "lookup_food", "list_meals", "edit_meal", "move_meal", "delete_meal"],
          workouts: ["log_workout", "list_workouts", "move_workout", "delete_workout"],
          body: ["log_weight"],
          summaries: ["get_day", "get_week"],
        },
        conventions: [
          "Dates are YYYY-MM-DD in the timezone above; 'today'/'yesterday' resolve against it.",
          "For food, YOU estimate calories and macros for the portion eaten and pass them to log_food; for branded/restaurant/packaged items call lookup_food first for real data.",
          "Note your assumptions (portion, oil, sauces) and a confidence when logging food.",
          "For workouts, use standard exercise names and expand shorthand into explicit sets; plate math: plate=135lb, plate+25=185lb, 2 plates=225lb.",
          "The server rounds macros and keeps daily totals in sync — don't pre-round.",
        ],
      })
    )
  );
}
