import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { logWorkout, listWorkouts, moveWorkout, deleteWorkout } from "../services/workout";
import { DESTRUCTIVE, READ_ONLY, WRITE, type ToolCtx } from "./shared";

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional()
  .describe("Local date YYYY-MM-DD. Omit for today.");

export function registerWorkoutTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "log_workout",
    {
      description:
        "Log one exercise with its sets. Call once per exercise (multiple exercises = multiple calls). Use standard normalized names ('Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Lat Pulldown', 'Run'). " +
        "Expand shorthand: '5x5 at 225' = 5 sets of {reps:5, weight:225}; '185 8 8 6' = three sets at 185 with reps 8,8,6; plate math: 'a plate' = 135lb, 'plate and 25' = 185lb, '2 plates' = 225lb, '60s' = 60lb dumbbells. " +
        "For cardio, set is_cardio:true with duration_minutes and an empty sets array. Logging the same exercise again on the same day appends sets. Defaults to today.",
      inputSchema: {
        exercise: z.string().min(1).describe("Normalized exercise name."),
        sets: z
          .array(
            z.object({
              reps: z.number().int().nullable().describe("Reps in the set; null for cardio."),
              weight: z.number().nullable().describe("Weight in `unit`; null for bodyweight/cardio."),
            })
          )
          .describe("One object per set. Empty array for cardio."),
        unit: z.enum(["lb", "kg"]).optional().describe("Weight unit; default lb."),
        is_cardio: z.boolean().optional().describe("True for run/walk/bike/etc."),
        duration_minutes: z.number().nullable().optional().describe("Cardio duration in minutes."),
        notes: z.string().nullable().optional().describe("Optional note like 'felt heavy', 'PR', 'easy'."),
        date: dateField,
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await logWorkout(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "list_workouts",
    {
      description:
        "Read workouts. Pass a date for that day's full session (exercises + sets), or omit date and pass limit for the most recent N sessions (default 7) — useful for spotting PRs and progression.",
      inputSchema: {
        date: dateField,
        limit: z.number().int().min(1).max(30).optional().describe("Recent sessions to return when no date is given."),
      },
      annotations: READ_ONLY,
    },
    run(async (args: { date?: string; limit?: number }) => jsonResult(await listWorkouts(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "move_workout",
    {
      description:
        "Move a whole workout session to a different day. Identify it by session_id (preferred), or a hint (an exact YYYY-MM-DD date, or a substring of the session title). Fails if a workout already exists on the destination day.",
      inputSchema: {
        session_id: z.string().uuid().optional(),
        hint: z.string().optional().describe("A YYYY-MM-DD date or part of the workout title."),
        target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Destination date YYYY-MM-DD."),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await moveWorkout(ctx.db, ctx.userId, args)))
  );

  server.registerTool(
    "delete_workout",
    {
      description:
        "Delete an entire workout session and all its exercises/sets. Identify it by session_id (preferred) or a hint (date or title substring); an ambiguous hint returns the matches instead of deleting.",
      inputSchema: {
        session_id: z.string().uuid().optional(),
        hint: z.string().optional().describe("A YYYY-MM-DD date or part of the workout title."),
      },
      annotations: DESTRUCTIVE,
    },
    run(async (args) => jsonResult(await deleteWorkout(ctx.db, ctx.userId, args)))
  );
}
