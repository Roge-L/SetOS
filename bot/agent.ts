// Smart message routing agent using OpenAI function calling.
//
// Every user message goes through the agent, which decides what action(s) to take.
// The agent loop runs until the model returns a text response (no more tool calls).
//
// Architecture references:
// - Function calling: https://platform.openai.com/docs/guides/function-calling
// - Strict mode: https://platform.openai.com/docs/guides/structured-outputs
// - Agent loop: https://developers.openai.com/cookbook/examples/orchestrating_agents
// - zodFunction: https://github.com/openai/openai-node/blob/master/helpers.md
// - Tool design: https://www.anthropic.com/engineering/writing-tools-for-agents

import { z } from "zod";
import { zodFunction } from "openai/helpers/zod";
import { getOpenAI, models } from "@/lib/openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { logFood } from "@/services/food-logger";
import {
  getActiveSession,
  startWorkoutSession,
  finishWorkoutSession,
  logWorkoutExercises,
  getLastExerciseName,
} from "@/services/workout-logger";
import { recalculateDailyTotals } from "@/services/daily-totals";
import { todayDate, dateInTimezone, getUTCRangeForLocalDate } from "@/lib/utils";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const MAX_ITERATIONS = 5;

// Escape LIKE/ILIKE metacharacters to prevent pattern injection
// Ref: https://www.postgresql.org/docs/current/functions-matching.html#FUNCTIONS-LIKE
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

// --- Tool schemas (strict: true is set automatically by zodFunction) ---

const LogFoodSchema = z.object({
  description: z
    .string()
    .describe("The food description exactly as the user said it"),
});

const LogWorkoutSetsSchema = z.object({
  text: z.string().describe("The workout sets text exactly as the user said it"),
  weight: z
    .number()
    .nullable()
    .describe(
      "Weight in lbs if the user mentioned one (e.g. 225, 135). Null if no weight mentioned. Extract from any format: '225 lbs', 'at 225', 'with 225', etc."
    ),
});

const StartWorkoutSchema = z.object({
  title: z
    .string()
    .describe("Optional workout title, or empty string if none given"),
});

const FinishWorkoutSchema = z.object({});

const MoveMealSchema = z.object({
  meal_name_hint: z
    .string()
    .describe("Substring that identifies which meal to move"),
  target_date: z
    .string()
    .describe("Target date in YYYY-MM-DD format"),
});

const DeleteMealSchema = z.object({
  meal_name_hint: z
    .string()
    .describe("Substring that identifies which meal to delete"),
});

const MoveWorkoutSchema = z.object({
  workout_hint: z
    .string()
    .describe("Substring or description identifying which workout to move"),
  target_date: z
    .string()
    .describe("Target date in YYYY-MM-DD format"),
});

const DeleteWorkoutSchema = z.object({
  workout_hint: z
    .string()
    .describe("Substring or description identifying which workout to delete"),
});

const TOOLS = [
  zodFunction({
    name: "log_food",
    parameters: LogFoodSchema,
    description:
      "Log a food entry. Call when the user mentions eating or drinking something. Pass their exact description.",
  }),
  zodFunction({
    name: "log_workout_sets",
    parameters: LogWorkoutSetsSchema,
    description:
      'Log workout sets. Call when the user describes exercises, sets, reps, or cardio. Examples: "bench 5x5 at 225", "ran 25 min", "squat 315 5 5 3". Always extract the weight if mentioned. Auto-creates a workout session if none is active.',
  }),
  zodFunction({
    name: "start_workout",
    parameters: StartWorkoutSchema,
    description:
      "Explicitly start a new workout session. Only call if the user explicitly says they want to start a workout, not when they just log sets.",
  }),
  zodFunction({
    name: "finish_workout",
    parameters: FinishWorkoutSchema,
    description:
      "End the current workout session. Call when the user says they're done working out.",
  }),
  zodFunction({
    name: "move_meal",
    parameters: MoveMealSchema,
    description:
      'Move a meal to a different date. Call when the user says a meal was actually on a different day. "yesterday" = use yesterday\'s date, "last night" = use yesterday\'s date.',
  }),
  zodFunction({
    name: "delete_meal",
    parameters: DeleteMealSchema,
    description:
      "Delete a meal entry. Call when the user says to remove, undo, or delete a meal.",
  }),
  zodFunction({
    name: "move_workout",
    parameters: MoveWorkoutSchema,
    description:
      'Move a workout to a different date. Call when the user says a workout was actually on a different day. "yesterday" / "last night" = use yesterday\'s date.',
  }),
  zodFunction({
    name: "delete_workout",
    parameters: DeleteWorkoutSchema,
    description:
      "Delete a workout session and all its exercises/sets. Call when the user says to remove a workout.",
  }),
];

// --- Tool execution ---

async function executeTool(
  userId: string,
  name: string,
  args: Record<string, any>
): Promise<string> {
  const supabase = createAdminClient();

  switch (name) {
    case "log_food": {
      const result = await logFood({
        userId,
        text: args.description,
      });
      const est = result.estimation;
      return `Logged: ${est.parsed_meal_name} — ${est.estimated_calories} cal | P: ${Math.round(est.estimated_protein_g)}g | C: ${Math.round(est.estimated_carbs_g)}g | F: ${Math.round(est.estimated_fat_g)}g${est.estimated_fiber_g > 0 ? ` | Fiber: ${Math.round(est.estimated_fiber_g)}g` : ""} (${est.confidence} confidence, source: ${result.source})`;
    }

    case "log_workout_sets": {
      let session = await getActiveSession(userId);
      if (!session) {
        session = await startWorkoutSession(userId);
      }
      const currentExercise = await getLastExerciseName(session.id);
      const result = await logWorkoutExercises({
        userId,
        sessionId: session.id,
        text: args.text,
        currentExercise,
        defaultWeight: args.weight ?? undefined,
      });
      if (result.exercises.length === 0) {
        return "Couldn't parse workout sets. Try a format like: bench 185x8, or 10 10 8";
      }
      return result.exercises
        .map((ex) => {
          if (ex.is_cardio) {
            const s = ex.sets[0];
            const mins = s?.duration_seconds
              ? Math.round(s.duration_seconds / 60)
              : "?";
            return `Logged: ${ex.normalized_exercise_name} — ${mins} min${s?.notes ? " " + s.notes : ""}`;
          }
          const sets = ex.sets
            .map((s) =>
              s.weight && s.reps
                ? `${s.weight}x${s.reps}`
                : s.reps
                  ? `${s.reps} reps`
                  : "—"
            )
            .join(", ");
          return `Logged: ${ex.normalized_exercise_name} — ${sets}`;
        })
        .join("\n");
    }

    case "start_workout": {
      const existing = await getActiveSession(userId);
      if (existing) {
        return "You already have an active workout. Finish it first or just send your sets.";
      }
      const session = await startWorkoutSession(
        userId,
        args.title || undefined
      );
      return `Workout started${session.title ? ": " + session.title : ""}. Send your sets!`;
    }

    case "finish_workout": {
      const session = await getActiveSession(userId);
      if (!session) return "No active workout to finish.";
      await finishWorkoutSession(session.id);
      return "Workout finished. Nice work!";
    }

    case "move_meal": {
      const { data: meals } = await supabase
        .from("meal_logs")
        .select("id, parsed_meal_name, logged_at")
        .eq("user_id", userId)
        .ilike("parsed_meal_name", `%${escapeLike(args.meal_name_hint)}%`)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!meals?.length) return `No meal found matching "${args.meal_name_hint}"`;

      const meal = meals[0];
      const timePart = meal.logged_at.slice(11);
      const oldDate = dateInTimezone(new Date(meal.logged_at));

      await supabase
        .from("meal_logs")
        .update({
          logged_at: `${args.target_date}T${timePart}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", meal.id);

      await recalculateDailyTotals(userId, oldDate);
      await recalculateDailyTotals(userId, args.target_date);

      return `Moved "${meal.parsed_meal_name}" to ${args.target_date}`;
    }

    case "delete_meal": {
      const { data: meals } = await supabase
        .from("meal_logs")
        .select("id, parsed_meal_name, logged_at")
        .eq("user_id", userId)
        .ilike("parsed_meal_name", `%${escapeLike(args.meal_name_hint)}%`)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!meals?.length) return `No meal found matching "${args.meal_name_hint}"`;

      const meal = meals[0];
      const mealDate = dateInTimezone(new Date(meal.logged_at));
      await supabase.from("meal_logs").delete().eq("id", meal.id);
      await recalculateDailyTotals(userId, mealDate);

      return `Deleted "${meal.parsed_meal_name}"`;
    }

    case "move_workout": {
      const { data: workouts } = await supabase
        .from("workout_sessions")
        .select("id, title, started_at, ended_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      const workout =
        workouts?.find(
          (w) =>
            w.title?.toLowerCase().includes(args.workout_hint.toLowerCase())
        ) || workouts?.[0];

      if (!workout) return `No workout found matching "${args.workout_hint}"`;

      const timePart = workout.started_at.slice(11);
      const update: Record<string, string> = {
        started_at: `${args.target_date}T${timePart}`,
      };
      if (workout.ended_at) {
        update.ended_at = `${args.target_date}T${workout.ended_at.slice(11)}`;
      }

      await supabase.from("workout_sessions").update(update).eq("id", workout.id);

      return `Moved workout "${workout.title || "Untitled"}" to ${args.target_date}`;
    }

    case "delete_workout": {
      const { data: workouts } = await supabase
        .from("workout_sessions")
        .select("id, title")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      const workout =
        workouts?.find(
          (w) =>
            w.title?.toLowerCase().includes(args.workout_hint.toLowerCase())
        ) || workouts?.[0];

      if (!workout) return `No workout found matching "${args.workout_hint}"`;

      await supabase.from("workout_sessions").delete().eq("id", workout.id);

      return `Deleted workout "${workout.title || "Untitled"}"`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// --- Build context for the agent ---

async function buildContext(userId: string): Promise<string> {
  const supabase = createAdminClient();
  const today = todayDate();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = dateInTimezone(yesterday);

  const todayRange = getUTCRangeForLocalDate(today);
  const yesterdayRange = getUTCRangeForLocalDate(yesterdayStr);

  const [mealsToday, mealsYesterday, workoutsRecent, activeSession] =
    await Promise.all([
      supabase
        .from("meal_logs")
        .select("parsed_meal_name, logged_at")
        .eq("user_id", userId)
        .gte("logged_at", todayRange.start)
        .lte("logged_at", todayRange.end)
        .order("logged_at"),
      supabase
        .from("meal_logs")
        .select("parsed_meal_name, logged_at")
        .eq("user_id", userId)
        .gte("logged_at", yesterdayRange.start)
        .lte("logged_at", yesterdayRange.end)
        .order("logged_at"),
      supabase
        .from("workout_sessions")
        .select("title, started_at, ended_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      getActiveSession(userId),
    ]);

  let ctx = `Today: ${today}. Yesterday: ${yesterdayStr}.\n`;
  ctx += `Active workout session: ${activeSession ? "YES" : "no"}\n\n`;

  ctx += "Today's meals:\n";
  for (const m of mealsToday.data || []) {
    ctx += `- ${m.parsed_meal_name}\n`;
  }
  if (!mealsToday.data?.length) ctx += "- (none)\n";

  ctx += "\nYesterday's meals:\n";
  for (const m of mealsYesterday.data || []) {
    ctx += `- ${m.parsed_meal_name}\n`;
  }
  if (!mealsYesterday.data?.length) ctx += "- (none)\n";

  ctx += "\nRecent workouts:\n";
  for (const w of workoutsRecent.data || []) {
    const dateStr = dateInTimezone(new Date(w.started_at));
    ctx += `- ${w.title || "Untitled"} (${dateStr})${w.ended_at ? "" : " [active]"}\n`;
  }
  if (!workoutsRecent.data?.length) ctx += "- (none)\n";

  return ctx;
}

const SYSTEM_PROMPT = `You are SetOS, a personal calorie/macro and workout tracking assistant on Telegram. Be concise.

You have tools to: log food, log workout sets, start/finish workouts, move entries between dates, and delete entries.

Rules:
- When the user mentions eating or drinking something, call log_food with their exact description.
- When the user sends workout data (exercises, sets, reps, weight, cardio), call log_workout_sets. Always extract the weight if mentioned anywhere in the message. This auto-creates a session if needed.
- When the user wants to correct dates ("was actually yesterday", "move X to april 2"), call the appropriate move tool. Convert "yesterday"/"last night" to the actual YYYY-MM-DD date.
- When the user wants to delete something, call the appropriate delete tool.
- You may call multiple tools in one turn if the user asks for multiple corrections.
- If the message is just conversational (greeting, thanks, question), respond with text — don't call any tool.
- Keep responses short. No emojis except where the user uses them.
- Never ask for confirmation before acting — just do it. The user can undo.`;

// --- Main agent entry point ---

export async function runAgent(
  userId: string,
  userMessage: string,
  extraContext?: string
): Promise<string> {
  const openai = getOpenAI();
  const context = await buildContext(userId);

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\nCurrent state:\n${context}`,
    },
    {
      role: "user",
      content: extraContext
        ? `${userMessage}\n\n[Additional context: ${extraContext}]`
        : userMessage,
    },
  ];

  // Agent loop — ref: https://developers.openai.com/cookbook/examples/orchestrating_agents
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: models.text,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.1,
    });

    const msg = response.choices[0]?.message;
    if (!msg) return "Something went wrong.";

    messages.push(msg);

    // No tool calls — model is done, return text response
    if (!msg.tool_calls?.length) {
      return msg.content || "Done.";
    }

    // Execute tool calls and feed results back
    for (const call of msg.tool_calls) {
      let result: string;
      try {
        // Type narrowing: tool calls from function calling always have .function
        const fn = "function" in call ? call.function : null;
        if (!fn) {
          result = "Unsupported tool call type";
        } else {
          const args = JSON.parse(fn.arguments);
          result = await executeTool(userId, fn.name, args);
        }
      } catch (e: any) {
        // Feed errors back so the model can self-correct
        result = `Error: ${e.message}`;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return "Reached max steps. Please try a simpler request.";
}
