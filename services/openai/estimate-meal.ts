import { getOpenAI, models } from "@/lib/openai";
import {
  MEAL_ESTIMATION_SYSTEM,
  buildMealEstimationPrompt,
} from "@/prompts/meal-estimation";
import { MealEstimationSchema, type MealEstimation } from "@/validators/meal";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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
