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
  getSessionForDate,
  logStructuredExercise,
} from "@/services/workout-logger";
import { recalculateDailyTotals } from "@/services/daily-totals";
import { todayDate, dateInTimezone, getUTCRangeForLocalDate, formatSets } from "@/lib/utils";
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
  date: z
    .string()
    .nullable()
    .describe(
      "Date in YYYY-MM-DD format if the user mentioned a specific day (e.g. 'last night', 'on tuesday', 'april 3rd'). Null if no date mentioned (defaults to today)."
    ),
});

const WorkoutSetSchema = z.object({
  reps: z
    .number()
    .nullable()
    .describe("Number of reps. Null for cardio."),
  weight: z
    .number()
    .nullable()
    .describe("Weight in the specified unit. Null if bodyweight or cardio."),
});

const LogWorkoutSchema = z.object({
  exercise: z
    .string()
    .describe(
      'Normalized exercise name. Use standard names: "Bench Press", "Squat", "Deadlift", "Overhead Press", "Barbell Row", "Incline DB Press", "Lat Pulldown", "Pull-up", "Bicep Curl", "Tricep Pushdown", "Leg Press", "Run", etc.'
    ),
  sets: z
    .array(WorkoutSetSchema)
    .describe(
      'Array of sets. "5x5 at 225" = 5 objects each with reps:5, weight:225. "185 8 8 6" = [{reps:8,weight:185},{reps:8,weight:185},{reps:6,weight:185}]. "10 10 8" with no weight = [{reps:10,weight:null},...]'
    ),
  unit: z
    .enum(["lb", "kg"])
    .describe("Weight unit. Default to lb unless user says kg."),
  is_cardio: z
    .boolean()
    .describe("True for cardio exercises (run, walk, bike, etc.)"),
  duration_minutes: z
    .number()
    .nullable()
    .describe("Duration in minutes for cardio. Null for non-cardio."),
  notes: z
    .string()
    .nullable()
    .describe('Optional notes like "easy", "felt heavy", "PR". Null if none.'),
  date: z
    .string()
    .nullable()
    .describe(
      "Date in YYYY-MM-DD format if the user mentioned a specific day. Null = today."
    ),
});

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
    name: "log_workout",
    parameters: LogWorkoutSchema,
    description:
      'Log a single exercise with sets. Extract exercise name, each set\'s reps and weight, and unit. Call once per exercise. "bench 5x5 225" = exercise:"Bench Press", 5 sets of reps:5 weight:225. "ran 25 min" = exercise:"Run", is_cardio:true, duration_minutes:25. Plate math: "plate" = 135lb, "plate and 25" = 185lb, "2 plates" = 225lb.',
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
        date: args.date ?? undefined,
      });
      const est = result.estimation;
      const today = todayDate();
      const datePrefix = result.date !== today ? `[${result.date}] ` : "";
      let response = `${datePrefix}Logged: ${est.parsed_meal_name} — ${est.estimated_calories} cal | P: ${Math.round(est.estimated_protein_g)}g | C: ${Math.round(est.estimated_carbs_g)}g | F: ${Math.round(est.estimated_fat_g)}g`;
      if (result.dailyTotals) {
        const t = result.dailyTotals;
        response += `\nDay total: ${t.calories} cal | P: ${Math.round(t.protein_g)}g | C: ${Math.round(t.carbs_g)}g | F: ${Math.round(t.fat_g)}g`;
      }
      return response;
    }

    case "log_workout": {
      const targetDate = args.date ?? undefined;
      const session = await getSessionForDate(userId, targetDate);
      await logStructuredExercise({
        sessionId: session.id,
        exercise: args.exercise,
        sets: args.sets,
        unit: args.unit,
        is_cardio: args.is_cardio,
        duration_minutes: args.duration_minutes,
        notes: args.notes,
      });
      const today = todayDate();
      const datePrefix = (targetDate && targetDate !== today) ? `[${targetDate}] ` : "";
      if (args.is_cardio) {
        return `${datePrefix}Logged: ${args.exercise} — ${args.duration_minutes ?? "?"} min${args.notes ? " " + args.notes : ""}`;
      }
      return `${datePrefix}Logged: ${args.exercise} — ${formatSets(args.sets)}`;
    }

    case "move_meal": {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data: meals } = await supabase
        .from("meal_logs")
        .select("id, parsed_meal_name, logged_at")
        .eq("user_id", userId)
        .ilike("parsed_meal_name", `%${escapeLike(args.meal_name_hint)}%`)
        .gte("logged_at", weekAgo.toISOString())
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
      const weekAgo2 = new Date();
      weekAgo2.setDate(weekAgo2.getDate() - 7);
      const { data: meals } = await supabase
        .from("meal_logs")
        .select("id, parsed_meal_name, logged_at")
        .eq("user_id", userId)
        .ilike("parsed_meal_name", `%${escapeLike(args.meal_name_hint)}%`)
        .gte("logged_at", weekAgo2.toISOString())
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
        .select("id, title, date")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      const workout = workouts?.find(
        (w) =>
          w.title?.toLowerCase().includes(args.workout_hint.toLowerCase()) ||
          w.date === args.workout_hint
      );

      if (!workout) return `No workout found matching "${args.workout_hint}". Recent workouts: ${workouts?.map((w) => `"${w.title || "Untitled"}" (${w.date})`).join(", ") || "none"}`;

      await supabase
        .from("workout_sessions")
        .update({ date: args.target_date })
        .eq("id", workout.id);

      return `Moved workout "${workout.title || "Untitled"}" (${workout.date}) to ${args.target_date}`;
    }

    case "delete_workout": {
      const { data: workouts } = await supabase
        .from("workout_sessions")
        .select("id, title, date")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      const workout = workouts?.find(
        (w) =>
          w.title?.toLowerCase().includes(args.workout_hint.toLowerCase()) ||
          w.date === args.workout_hint
      );

      if (!workout) return `No workout found matching "${args.workout_hint}". Recent workouts: ${workouts?.map((w) => `"${w.title || "Untitled"}" (${w.date})`).join(", ") || "none"}`;

      await supabase.from("workout_sessions").delete().eq("id", workout.id);

      return `Deleted workout "${workout.title || "Untitled"}" (${workout.date})`;
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

  const [mealsToday, mealsYesterday, todayTotals, workoutsRecent, todayExercises] =
    await Promise.all([
      supabase
        .from("meal_logs")
        .select("parsed_meal_name, estimated_calories, logged_at")
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
        .from("daily_nutrition_totals")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("user_id", userId)
        .eq("date", today)
        .single(),
      supabase
        .from("workout_sessions")
        .select("title, date")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("workout_sessions")
        .select(`
          workout_exercises (
            normalized_exercise_name,
            workout_sets ( reps, weight, unit )
          )
        `)
        .eq("user_id", userId)
        .eq("date", today)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  let ctx = `Today: ${today}. Yesterday: ${yesterdayStr}.\n\n`;

  // Daily totals
  const t = todayTotals.data;
  if (t) {
    ctx += `Today's totals: ${t.calories} cal | P: ${Math.round(t.protein_g)}g | C: ${Math.round(t.carbs_g)}g | F: ${Math.round(t.fat_g)}g\n\n`;
  }

  ctx += "Today's meals:\n";
  for (const m of mealsToday.data || []) {
    ctx += `- ${m.parsed_meal_name} (${m.estimated_calories} cal)\n`;
  }
  if (!mealsToday.data?.length) ctx += "- (none)\n";

  ctx += "\nYesterday's meals:\n";
  for (const m of mealsYesterday.data || []) {
    ctx += `- ${m.parsed_meal_name}\n`;
  }
  if (!mealsYesterday.data?.length) ctx += "- (none)\n";

  // Today's exercises (so agent knows current exercise for bare rep logging)
  const todayExs = todayExercises.data?.workout_exercises;
  if (todayExs?.length) {
    ctx += "\nToday's exercises:\n";
    for (const ex of todayExs) {
      const sets = ex.workout_sets
        .map((s: any) => s.weight ? `${s.weight}x${s.reps}` : `${s.reps} reps`)
        .join(", ");
      ctx += `- ${ex.normalized_exercise_name}: ${sets}\n`;
    }
  }

  ctx += "\nRecent workouts:\n";
  for (const w of workoutsRecent.data || []) {
    ctx += `- ${w.title || "Untitled"} (${w.date})\n`;
  }
  if (!workoutsRecent.data?.length) ctx += "- (none)\n";

  return ctx;
}

const SYSTEM_PROMPT = `You are SetOS, a personal calorie/macro and workout tracking assistant on Telegram. Be concise.

You have tools to: log food, log workout sets, move entries between dates, and delete entries.

Rules:
- When the user mentions eating or drinking something, call log_food with their exact description. If they mention a specific day ("last night", "on tuesday", "april 3rd"), set the date field to the resolved YYYY-MM-DD. Otherwise leave date null (defaults to today).
- When the user sends workout data, call log_workout once per exercise. Extract the exercise name, each set's reps and weight, and unit. For multiple exercises in one message, call log_workout multiple times. If they mention a specific day, set the date field. "plate" = 135lb, "plate and 25" = 185lb, "2 plates" = 225lb, "60s" = 60lb dumbbells.
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
