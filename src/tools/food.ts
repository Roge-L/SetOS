import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { untrusted, UNTRUSTED_NOTE } from "../lib/format";
import { logMeals, searchMeals, updateMeal, deleteMeals } from "../services/food";
import { lookupFood } from "../services/nutrition";
import { DESTRUCTIVE, READ_ONLY, WRITE, dateField, uuidField } from "./shared";
import type { ToolCtx } from "./shared";

const macro = (what: string) => z.number().nonnegative().describe(what);

export function registerFoodTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "setos_log_meals",
    {
      description:
        "Log one or more meals with their macros. YOU estimate calories and protein/carbs/fat for the portion ACTUALLY eaten, then pass them here with your assumptions (portion size, cooking oil, sauces, rice volume) and a confidence. " +
        "Pass ALL items from one description in a single call — 'eggs, toast and coffee' is one call with three meals, not three calls. " +
        "For branded / restaurant / packaged foods call setos_lookup_food FIRST and log the real numbers scaled to the portion. Don't pre-round; the server rounds. " +
        "Returns each meal's id (needed to edit or delete it) plus the updated totals for every day touched.",
      inputSchema: {
        meals: z
          .array(
            z.object({
              name: z.string().min(1).describe("Short meal name, e.g. 'Chipotle chicken burrito bowl'."),
              calories: macro("Total calories for the portion eaten."),
              protein_g: macro("Protein in grams."),
              carbs_g: macro("Carbohydrates in grams."),
              fat_g: macro("Fat in grams."),
              fiber_g: macro("Fiber in grams.").optional(),
              confidence: z
                .enum(["low", "medium", "high"])
                .optional()
                .describe("high = standard food, clearly described; low = lots of guessing. Default medium."),
              assumptions: z
                .array(z.string())
                .optional()
                .describe("What you assumed — portion, oil, sauces, etc. One short line each."),
              date: dateField.describe("Local date YYYY-MM-DD. Omit for today."),
              time: z
                .string()
                .regex(/^\d{1,2}:\d{2}$/)
                .optional()
                .describe("24h HH:MM local time. Omit for now."),
            })
          )
          .min(1)
          .max(25)
          .describe("The meals to log (1-25)."),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await logMeals(ctx.db, ctx.userId, ctx.tz, args.meals)))
  );

  server.registerTool(
    "setos_search_meals",
    {
      description:
        "Find logged meals. Defaults to today. Pass `date` for one day, or `start`/`end` for a range; filter by `name_contains` (e.g. 'chipotle') and calorie bounds. " +
        "Returns each meal's id, macros, date and time — use the ids with setos_update_meal / setos_delete_meals. A single-day search also returns that day's totals. " +
        "Use response_format 'detailed' to also see confidence and the assumptions recorded at log time. Paginate with `offset` when has_more is true.",
      inputSchema: {
        date: dateField.describe("One local day YYYY-MM-DD. Omit for today; ignored if start/end given."),
        start: dateField.describe("Range start YYYY-MM-DD (inclusive)."),
        end: dateField.describe("Range end YYYY-MM-DD (inclusive)."),
        name_contains: z.string().min(1).optional().describe("Case-insensitive substring of the meal name."),
        min_calories: z.number().nonnegative().optional(),
        max_calories: z.number().nonnegative().optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Page size, default 50."),
        offset: z.number().int().min(0).optional().describe("Skip this many results (from next_offset)."),
        response_format: z
          .enum(["concise", "detailed"])
          .optional()
          .describe("'detailed' adds confidence + assumptions. Default concise."),
      },
      annotations: READ_ONLY,
    },
    run(async (args) => jsonResult(await searchMeals(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "setos_update_meal",
    {
      description:
        "Change anything about one logged meal: its name, any macro, confidence, assumptions, and the date/time it belongs to. " +
        "Only the fields you pass change. Setting `date` MOVES the meal to that day (use this for 'that was actually last night') and both days' totals are recalculated. " +
        "Get meal_id from setos_search_meals or setos_get_day.",
      inputSchema: {
        meal_id: uuidField.describe("The meal's id, from setos_search_meals / setos_get_day."),
        name: z.string().min(1).optional(),
        calories: macro("New total calories.").optional(),
        protein_g: macro("New protein grams.").optional(),
        carbs_g: macro("New carb grams.").optional(),
        fat_g: macro("New fat grams.").optional(),
        fiber_g: macro("New fiber grams.").optional(),
        confidence: z.enum(["low", "medium", "high"]).optional(),
        assumptions: z.array(z.string()).optional().describe("Replaces the existing assumptions list."),
        date: dateField.describe("Move the meal to this local date."),
        time: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .optional()
          .describe("New 24h HH:MM local time."),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await updateMeal(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "setos_delete_meals",
    {
      description:
        "Permanently delete one or more logged meals BY ID. Ids come from setos_search_meals / setos_get_day — deleting by name is intentionally not supported so a call can never remove the wrong meal. " +
        "Confirm with the user before calling. Affected days' totals are recalculated.",
      inputSchema: {
        meal_ids: z.array(uuidField).min(1).max(50).describe("Exact meal ids to delete."),
      },
      annotations: DESTRUCTIVE,
    },
    run(async (args: { meal_ids: string[] }) =>
      jsonResult(await deleteMeals(ctx.db, ctx.userId, ctx.tz, args.meal_ids))
    )
  );

  server.registerTool(
    "setos_lookup_food",
    {
      description:
        "Look up REAL nutrition data from public databases (FatSecret + Open Food Facts). Call this BEFORE setos_log_meals for branded, restaurant, or packaged items so you log ground truth instead of estimating. " +
        "Returns a few candidates with macros per a stated basis (a serving, or 100g) — pick the closest, scale it to the portion actually eaten, then log. Does not log anything itself. " +
        UNTRUSTED_NOTE,
      inputSchema: {
        query: z
          .string()
          .min(2)
          .describe("What to look up, e.g. 'Chick-fil-A spicy deluxe' or 'Fairlife chocolate protein shake'."),
      },
      annotations: READ_ONLY,
    },
    run(async (args: { query: string }) => {
      const res = await lookupFood(args.query, ctx.env);
      return jsonResult({
        query: res.query,
        candidates: res.candidates.map((c) => ({
          source: c.source,
          name: untrusted(c.name),
          brand: c.brand ? untrusted(c.brand) : null,
          basis: c.basis,
          calories: c.calories,
          protein_g: c.protein_g,
          carbs_g: c.carbs_g,
          fat_g: c.fat_g,
          fiber_g: c.fiber_g,
        })),
        _note:
          res.candidates.length === 0
            ? "No database match. Estimate the macros yourself and log with confidence 'low' or 'medium'."
            : "Macros are PER the stated basis. Scale to the actual portion before logging.",
      });
    })
  );
}
