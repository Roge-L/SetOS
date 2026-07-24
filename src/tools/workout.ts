import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import {
  logWorkout,
  getWorkouts,
  updateWorkout,
  updateExercise,
  updateSet,
  deleteWorkoutItems,
  exerciseHistory,
} from "../services/workout";
import { DESTRUCTIVE, READ_ONLY, WRITE, dateField, uuidField } from "./shared";
import type { ToolCtx } from "./shared";

const PLATE_MATH =
  "Plate math: 'a plate' = 135lb, 'plate and 25' = 185lb, '2 plates' = 225lb, '3 plates' = 315lb, '60s' = 60lb dumbbells.";

export function registerWorkoutTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "setos_log_workout",
    {
      description:
        "Log a whole workout in ONE call — every exercise with its sets. Do not call this once per exercise; pass them all in `exercises`. " +
        "Expand shorthand into explicit sets: '5x5 at 225' = five {reps:5, weight:225}; '185 8 8 6' = three sets at 185 with reps 8, 8, 6; bodyweight = weight null. " +
        PLATE_MATH +
        " Cardio: give one set with duration_minutes (and optionally distance), no reps/weight. " +
        "Logging an exercise that already exists on that day APPENDS sets to it. Defaults to today. Returns session_id.",
      inputSchema: {
        exercises: z
          .array(
            z.object({
              exercise: z
                .string()
                .min(1)
                .describe("Normalized name, e.g. 'Bench Press', 'Squat', 'Lat Pulldown', 'Run'."),
              unit: z.enum(["lb", "kg"]).optional().describe("Weight unit, default lb."),
              sets: z
                .array(
                  z.object({
                    reps: z.number().int().nullable().optional().describe("Reps; null/omit for cardio."),
                    weight: z.number().nullable().optional().describe("Weight in `unit`; null for bodyweight/cardio."),
                    rir: z.number().int().nullable().optional().describe("Reps in reserve, if mentioned."),
                    duration_minutes: z.number().nullable().optional().describe("Cardio duration."),
                    distance: z.string().nullable().optional().describe("Cardio distance, e.g. '5k'."),
                    notes: z.string().nullable().optional().describe("Per-set note, e.g. 'felt heavy'."),
                  })
                )
                .min(1)
                .describe("One object per set performed."),
            })
          )
          .min(1)
          .max(20)
          .describe("Every exercise from this workout."),
        date: dateField.describe("Local date YYYY-MM-DD. Omit for today."),
        notes: z.string().nullable().optional().describe("Session-level note."),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await logWorkout(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "setos_get_workouts",
    {
      description:
        "Read logged workouts with full detail — every exercise and every set, each with its id. Pass `date` for one day, `start`/`end` for a range, or neither plus `limit` for the most recent sessions (default 7). " +
        "You need this before editing: session_id, exercise_id and set_id all come from here. To analyse one lift's progression over time use setos_exercise_history instead.",
      inputSchema: {
        date: dateField.describe("One local day YYYY-MM-DD."),
        start: dateField.describe("Range start YYYY-MM-DD (inclusive)."),
        end: dateField.describe("Range end YYYY-MM-DD (inclusive)."),
        limit: z.number().int().min(1).max(60).optional().describe("Max sessions to return; default 7 (1 with `date`)."),
      },
      annotations: READ_ONLY,
    },
    run(async (args) => jsonResult(await getWorkouts(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "setos_exercise_history",
    {
      description:
        "Progression and personal records for ONE lift over time — answers 'how is my bench going?', 'am I getting stronger?', 'what's my PR?'. " +
        "Matches the exercise name loosely, then returns per-session top set, total volume and estimated 1RM (Epley), newest first, plus heaviest set / best estimated 1RM / highest volume with their dates. " +
        "Prefer this over pulling many setos_get_workouts calls and doing the maths yourself.",
      inputSchema: {
        exercise: z.string().min(2).describe("Exercise name or fragment, e.g. 'bench' or 'Squat'."),
        limit: z.number().int().min(1).max(60).optional().describe("How many recent sessions to analyse; default 12."),
      },
      annotations: READ_ONLY,
    },
    run(async (args: { exercise: string; limit?: number }) =>
      jsonResult(await exerciseHistory(ctx.db, ctx.userId, args))
    )
  );

  server.registerTool(
    "setos_update_workout",
    {
      description:
        "Change a workout SESSION: move it to another date, retitle it, or set a session note. Only fields you pass change. " +
        "Moving to a date that already has a workout fails — merge by logging those exercises onto the existing day instead. Get session_id from setos_get_workouts.",
      inputSchema: {
        session_id: uuidField.describe("The session's id, from setos_get_workouts."),
        date: dateField.describe("Move the whole session to this local date."),
        title: z.string().min(1).optional().describe("Custom title (otherwise auto-named from exercises)."),
        notes: z.string().nullable().optional(),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await updateWorkout(ctx.db, ctx.userId, args)))
  );

  server.registerTool(
    "setos_update_exercise",
    {
      description:
        "Rename an exercise within a session (fix a wrong or misspelled name) and/or change its order position. Its sets are untouched. Get exercise_id from setos_get_workouts.",
      inputSchema: {
        exercise_id: uuidField.describe("The exercise's id, from setos_get_workouts."),
        name: z.string().min(1).optional().describe("New normalized exercise name."),
        position: z.number().int().min(0).optional().describe("New 0-based order within the session."),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await updateExercise(ctx.db, ctx.userId, args)))
  );

  server.registerTool(
    "setos_update_set",
    {
      description:
        "Fix ONE logged set — its reps, weight, unit, RIR, note, or cardio duration. This is the finest-grained edit: use it for 'the third set was 205 not 225'. Only fields you pass change. Get set_id from setos_get_workouts.",
      inputSchema: {
        set_id: uuidField.describe("The set's id, from setos_get_workouts."),
        reps: z.number().int().nullable().optional(),
        weight: z.number().nullable().optional(),
        unit: z.enum(["lb", "kg"]).optional(),
        rir: z.number().int().nullable().optional().describe("Reps in reserve."),
        duration_minutes: z.number().nullable().optional().describe("Cardio duration."),
        notes: z.string().nullable().optional(),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await updateSet(ctx.db, ctx.userId, args)))
  );

  server.registerTool(
    "setos_delete_workout_items",
    {
      description:
        "Permanently delete workout data at a chosen level. `target` sets the blast radius: 'session' removes a whole day's workout including all its exercises and sets; 'exercise' removes one exercise and its sets; 'sets' removes individual sets only. " +
        "Ids must come from setos_get_workouts. Confirm with the user first — especially for 'session'.",
      inputSchema: {
        target: z
          .enum(["session", "exercise", "sets"])
          .describe("What the ids refer to. 'session' cascades to all exercises and sets in that day."),
        ids: z.array(uuidField).min(1).max(50).describe("Ids of the chosen target type."),
      },
      annotations: DESTRUCTIVE,
    },
    run(async (args: { target: "session" | "exercise" | "sets"; ids: string[] }) =>
      jsonResult(await deleteWorkoutItems(ctx.db, ctx.userId, args))
    )
  );
}
