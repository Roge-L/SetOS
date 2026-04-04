const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const API_URL = "https://platform.fatsecret.com/rest/server.api";

// No token caching — Cloudflare Workers don't persist module state between requests.
// Each request fetches a fresh token. FatSecret tokens last 24h but that doesn't help here.
// Ref: https://github.com/cloudflare/workerd/issues/2328
async function getToken(): Promise<string> {
  const credentials = btoa(
    `${process.env.FATSECRET_ID}:${process.env.FATSECRET_SECRET}`
  );

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=basic",
  });

  if (!res.ok) throw new Error(`FatSecret token error: ${res.status}`);

  const data = await res.json();
  return data.access_token;
}

interface FatSecretFood {
  food_id: string;
  food_name: string;
  food_type: string; // "Generic" | "Brand" | "Restaurant"
  brand_name?: string;
  food_description: string;
}

interface FatSecretServing {
  serving_description: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  calories: string;
  protein: string;
  carbohydrate: string;
  fat: string;
  fiber?: string;
}

interface FatSecretNutrition {
  food_name: string;
  brand_name?: string;
  food_type: string;
  serving_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

async function searchFatSecret(
  query: string
): Promise<FatSecretFood[]> {
  const token = await getToken();
  const params = new URLSearchParams({
    method: "foods.search",
    search_expression: query,
    max_results: "5",
    format: "json",
  });

  const res = await fetch(`${API_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return [];

  const data = await res.json();
  if (!data.foods?.food) return [];

  const foods = Array.isArray(data.foods.food)
    ? data.foods.food
    : [data.foods.food];

  return foods;
}

async function getFatSecretNutrition(
  foodId: string
): Promise<FatSecretNutrition | null> {
  const token = await getToken();
  const params = new URLSearchParams({
    method: "food.get.v4",
    food_id: foodId,
    format: "json",
  });

  const res = await fetch(`${API_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data.food?.servings?.serving) return null;

  const servings = Array.isArray(data.food.servings.serving)
    ? data.food.servings.serving
    : [data.food.servings.serving];

  // Prefer "1 serving" or the first serving
  const serving: FatSecretServing =
    servings.find(
      (s: FatSecretServing) =>
        s.serving_description?.toLowerCase().includes("serving") ||
        s.metric_serving_unit === "g"
    ) || servings[0];

  return {
    food_name: data.food.food_name,
    brand_name: data.food.brand_name,
    food_type: data.food.food_type,
    serving_description: serving.serving_description,
    calories: parseFloat(serving.calories) || 0,
    protein_g: parseFloat(serving.protein) || 0,
    carbs_g: parseFloat(serving.carbohydrate) || 0,
    fat_g: parseFloat(serving.fat) || 0,
    fiber_g: parseFloat(serving.fiber || "0") || 0,
  };
}

// Search and return the best match with full nutrition data
export async function lookupFatSecret(
  query: string
): Promise<FatSecretNutrition | null> {
  try {
    const results = await searchFatSecret(query);
    if (results.length === 0) return null;

    // Prefer branded/restaurant results over generic
    const best =
      results.find((r) => r.food_type === "Brand") ||
      results.find((r) => r.food_type === "Restaurant") ||
      results[0];

    return getFatSecretNutrition(best.food_id);
  } catch (e) {
    console.error("FatSecret lookup failed:", e);
    return null;
  }
}
