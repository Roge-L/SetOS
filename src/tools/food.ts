import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, run } from "../lib/result";
import { untrusted, UNTRUSTED_NOTE } from "../lib/format";
import { logFood, listMeals, editMeal, moveMeal, deleteMeal } from "../services/food";
import { lookupFood } from "../services/nutrition";
import { DESTRUCTIVE, READ_ONLY, WRITE, type ToolCtx } from "./shared";

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional()
  .describe("Local date YYYY-MM-DD. Omit for today.");

export function registerFoodTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "log_food",
    {
      description:
        "Log a food/meal with its macros. YOU (Claude) estimate the calories and macronutrients for the portion the user actually ate, then pass them here — be practical, not clinical, and note your assumptions (portion size, cooking oil, sauces, rice volume). " +
        "For branded, restaurant, or packaged foods, call lookup_food FIRST to get real database values, then log those. " +
        "Round nothing yourself; the server rounds. Defaults to today unless a date/time is given.",
      inputSchema: {
        name: z.string().min(1).describe("Short meal name, e.g. 'Chipotle chicken burrito bowl'."),
        calories: z.number().nonnegative().describe("Total calories for the portion eaten."),
        protein_g: z.number().nonnegative().describe("Protein in grams."),
        carbs_g: z.number().nonnegative().describe("Carbohydrates in grams."),
        fat_g: z.number().nonnegative().describe("Fat in grams."),
        fiber_g: z.number().nonnegative().optional().describe("Fiber in grams (optional)."),
        confidence: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("How confident the estimate is: high = standard food clearly described, low = lots of guessing."),
        assumptions: z
          .array(z.string())
          .optional()
          .describe("Short notes on what you assumed (portion, oil, sauces, etc.), one per line."),
        date: dateField,
        time: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .optional()
          .describe("24h HH:MM local time, if it matters. Defaults to now."),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await logFood(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "lookup_food",
    {
      description:
        "Look up REAL nutrition data for a food from public databases (FatSecret + Open Food Facts). Use this before log_food for branded, restaurant, or packaged items so you log ground-truth macros instead of estimating. Returns up to a few candidates per serving; pick the closest match (or refine the query), then call log_food with the chosen values scaled to the portion eaten. " +
        UNTRUSTED_NOTE,
      inputSchema: {
        query: z.string().min(2).describe("What to look up, e.g. 'Chick-fil-A spicy deluxe' or 'Fairlife protein shake chocolate'."),
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
            ? "No database matches. Estimate the macros yourself and log with confidence: 'low' or 'medium'."
            : "Macros are PER the stated basis (a serving, or 100g). Scale to the actual portion before logging.",
      });
    })
  );

  server.registerTool(
    "list_meals",
    {
      description: "List everything logged for one day (default today), with each meal's macros and the day's running totals.",
      inputSchema: { date: dateField },
      annotations: READ_ONLY,
    },
    run(async (args: { date?: string }) => jsonResult(await listMeals(ctx.db, ctx.userId, ctx.tz, args.date)))
  );

  server.registerTool(
    "edit_meal",
    {
      description:
        "Correct a logged meal's name or macros. Get the meal_id from list_meals or get_day first. Only the fields you pass are changed; day totals are recalculated.",
      inputSchema: {
        meal_id: z.string().uuid().describe("The meal's id from list_meals / get_day."),
        name: z.string().min(1).optional(),
        calories: z.number().nonnegative().optional(),
        protein_g: z.number().nonnegative().optional(),
        carbs_g: z.number().nonnegative().optional(),
        fat_g: z.number().nonnegative().optional(),
        fiber_g: z.number().nonnegative().optional(),
        confidence: z.enum(["low", "medium", "high"]).optional(),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await editMeal(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "move_meal",
    {
      description:
        "Move a meal to a different day (e.g. 'that was actually last night'). Identify it by meal_id (preferred) or a name_hint; if a hint matches several meals you'll get the list back to disambiguate. Recalculates both days' totals.",
      inputSchema: {
        meal_id: z.string().uuid().optional().describe("Exact meal id (preferred)."),
        name_hint: z.string().optional().describe("Substring of the meal name, matched within the last 14 days."),
        target_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Destination date YYYY-MM-DD."),
      },
      annotations: WRITE,
    },
    run(async (args) => jsonResult(await moveMeal(ctx.db, ctx.userId, ctx.tz, args)))
  );

  server.registerTool(
    "delete_meal",
    {
      description:
        "Delete a logged meal. Identify it by meal_id (preferred) or a name_hint; a hint matching several meals returns the list instead of deleting, so a single call can never remove the wrong one. Recalculates the day's totals.",
      inputSchema: {
        meal_id: z.string().uuid().optional(),
        name_hint: z.string().optional().describe("Substring of the meal name, matched within the last 14 days."),
      },
      annotations: DESTRUCTIVE,
    },
    run(async (args) => jsonResult(await deleteMeal(ctx.db, ctx.userId, ctx.tz, args)))
  );
}
