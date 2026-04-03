import { getOpenAI, models } from "@/lib/openai";
import {
  MEAL_ESTIMATION_SYSTEM,
  buildMealEstimationPrompt,
} from "@/prompts/meal-estimation";
import { MealEstimationSchema, type MealEstimation } from "@/validators/meal";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

// Standard estimation using Chat Completions (for image + text, or basic text)
export async function estimateMeal(opts: {
  text?: string | null;
  transcript?: string | null;
  imageUrl?: string | null;
}): Promise<MealEstimation> {
  const openai = getOpenAI();
  const userPrompt = buildMealEstimationPrompt(opts.text, opts.transcript);

  const content: ContentPart[] = [{ type: "text", text: userPrompt }];

  if (opts.imageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: opts.imageUrl },
    });
  }

  const model = opts.imageUrl ? models.vision : models.text;

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: MEAL_ESTIMATION_SYSTEM },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 500,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty response from OpenAI meal estimation");

  const parsed = JSON.parse(raw);
  return MealEstimationSchema.parse(parsed);
}

// Web-search-backed estimation using the Responses API.
// Used when database lookups (FatSecret, Open Food Facts) miss.
// Searches the web for real nutrition data before estimating.
//
// API references:
// - Responses API: https://platform.openai.com/docs/guides/responses-vs-chat-completions
// - Web search tool: https://platform.openai.com/docs/guides/tools-web-search
// - Structured outputs (json_schema): https://platform.openai.com/docs/guides/structured-outputs
// - OpenAI Node SDK: https://github.com/openai/openai-node
export async function estimateMealWithWebSearch(
  query: string
): Promise<MealEstimation> {
  const openai = getOpenAI();

  const prompt = `Look up the actual nutrition information for: "${query}"

Search for the real calorie and macro data from nutrition databases, restaurant menus, or food labels. Use the real data you find to fill in the values.

${MEAL_ESTIMATION_SYSTEM}`;

  // Uses Responses API (not Chat Completions) for web_search tool support.
  // text.format uses json_schema (not json_object — that's Chat Completions only).
  const response = await openai.responses.create({
    model: models.text,
    input: prompt,
    tools: [
      {
        type: "web_search",
        search_context_size: "low",
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "meal_estimation",
        strict: true,
        schema: {
          type: "object",
          properties: {
            parsed_meal_name: { type: "string" },
            estimated_calories: { type: "number" },
            estimated_protein_g: { type: "number" },
            estimated_carbs_g: { type: "number" },
            estimated_fat_g: { type: "number" },
            estimated_fiber_g: { type: "number" },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            assumptions: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "parsed_meal_name",
            "estimated_calories",
            "estimated_protein_g",
            "estimated_carbs_g",
            "estimated_fat_g",
            "estimated_fiber_g",
            "confidence",
            "assumptions",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const raw = response.output_text;
  if (!raw) throw new Error("Empty response from OpenAI web search estimation");

  const parsed = JSON.parse(raw);
  const result = MealEstimationSchema.parse(parsed);

  if (!result.assumptions.some((a) => a.toLowerCase().includes("web"))) {
    result.assumptions.unshift("Nutrition looked up via web search");
  }
  return result;
}
