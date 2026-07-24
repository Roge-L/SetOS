/**
 * Real nutrition data from free public databases, for the `lookup_food` tool.
 * Claude calls this when it wants ground-truth macros (branded/restaurant/packaged
 * foods) instead of estimating, then passes the chosen values to `log_food`.
 *
 * FatSecret is best for branded + restaurant items (needs OAuth creds); Open Food
 * Facts is best for packaged products (no key). Both are optional — if FatSecret
 * creds are absent we still return Open Food Facts results.
 *
 * Refs:
 *  - FatSecret Platform API: https://platform.fatsecret.com/api/
 *  - Open Food Facts:        https://world.openfoodfacts.org/data
 */

import type { Env } from "../env";

export interface FoodCandidate {
  source: "fatsecret" | "openfoodfacts";
  name: string;
  brand: string | null;
  /** What the macros are "per" — a serving description or "100g". */
  basis: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

const FS_TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const FS_API_URL = "https://platform.fatsecret.com/rest/server.api";
const OFF_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const OFF_USER_AGENT = "SetOS/2.0 (personal-tracker)";

interface FatSecretFood {
  food_id: string;
  food_name: string;
  food_type: string; // "Generic" | "Brand" | "Restaurant"
  brand_name?: string;
}

async function fsToken(env: Env): Promise<string | null> {
  if (!env.FATSECRET_ID || !env.FATSECRET_SECRET) return null;
  const credentials = btoa(`${env.FATSECRET_ID}:${env.FATSECRET_SECRET}`);
  const res = await fetch(FS_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=basic",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

async function fsSearch(query: string, token: string): Promise<FatSecretFood[]> {
  const params = new URLSearchParams({
    method: "foods.search",
    search_expression: query,
    max_results: "5",
    format: "json",
  });
  const res = await fetch(`${FS_API_URL}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = (await res.json()) as { foods?: { food?: FatSecretFood | FatSecretFood[] } };
  const food = data.foods?.food;
  if (!food) return [];
  return Array.isArray(food) ? food : [food];
}

async function fsNutrition(foodId: string, token: string): Promise<FoodCandidate | null> {
  const params = new URLSearchParams({ method: "food.get.v4", food_id: foodId, format: "json" });
  const res = await fetch(`${FS_API_URL}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    food?: {
      food_name: string;
      brand_name?: string;
      food_type: string;
      servings?: { serving?: FsServing | FsServing[] };
    };
  };
  const servings = data.food?.servings?.serving;
  if (!servings) return null;
  const list = Array.isArray(servings) ? servings : [servings];
  // Prefer a metric serving or one described as a "serving"; else the first.
  const serving =
    list.find((s) => s.serving_description?.toLowerCase().includes("serving") || s.metric_serving_unit === "g") ??
    list[0];
  if (!serving) return null;
  return {
    source: "fatsecret",
    name: data.food!.food_name,
    brand: data.food!.brand_name ?? null,
    basis: serving.serving_description ?? "1 serving",
    calories: Math.round(Number(serving.calories) || 0),
    protein_g: Math.round(Number(serving.protein) || 0),
    carbs_g: Math.round(Number(serving.carbohydrate) || 0),
    fat_g: Math.round(Number(serving.fat) || 0),
    fiber_g: Math.round(Number(serving.fiber ?? "0") || 0),
  };
}

interface FsServing {
  serving_description?: string;
  metric_serving_unit?: string;
  calories: string;
  protein: string;
  carbohydrate: string;
  fat: string;
  fiber?: string;
}

async function fatSecretCandidates(query: string, env: Env): Promise<FoodCandidate[]> {
  try {
    const token = await fsToken(env);
    if (!token) return [];
    const foods = await fsSearch(query, token);
    if (foods.length === 0) return [];
    // Prefer branded/restaurant items, then take up to 3 and fetch full nutrition in parallel.
    const ranked = [
      ...foods.filter((f) => f.food_type === "Brand"),
      ...foods.filter((f) => f.food_type === "Restaurant"),
      ...foods.filter((f) => f.food_type !== "Brand" && f.food_type !== "Restaurant"),
    ].slice(0, 3);
    const results = await Promise.all(ranked.map((f) => fsNutrition(f.food_id, token)));
    return results.filter((r): r is FoodCandidate => r !== null && r.calories > 0);
  } catch {
    return [];
  }
}

async function openFoodFactsCandidate(query: string): Promise<FoodCandidate | null> {
  try {
    const params = new URLSearchParams({
      search_terms: query,
      search_simple: "1",
      action: "process",
      json: "1",
      fields: "product_name,brands,nutriments,serving_size",
      page_size: "5",
    });
    const res = await fetch(`${OFF_URL}?${params}`, { headers: { "User-Agent": OFF_USER_AGENT } });
    if (!res.ok) return null;
    const data = (await res.json()) as { products?: OffProduct[] };
    const product = data.products?.find((p) => p.nutriments?.["energy-kcal_100g"] != null);
    if (!product) return null;
    const n = product.nutriments!;
    return {
      source: "openfoodfacts",
      name: product.product_name || query,
      brand: product.brands || null,
      basis: "100g",
      calories: Math.round(n["energy-kcal_100g"] ?? 0),
      protein_g: Math.round(n.proteins_100g ?? 0),
      carbs_g: Math.round(n.carbohydrates_100g ?? 0),
      fat_g: Math.round(n.fat_100g ?? 0),
      fiber_g: Math.round(n.fiber_100g ?? 0),
    };
  } catch {
    return null;
  }
}

interface OffProduct {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: {
    "energy-kcal_100g"?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    fiber_100g?: number;
  };
}

/**
 * Look up a food across both databases. Returns up to ~4 candidates so Claude can
 * pick the closest match (or refine the query) before logging.
 */
export async function lookupFood(query: string, env: Env): Promise<{ query: string; candidates: FoodCandidate[] }> {
  const [fs, off] = await Promise.all([fatSecretCandidates(query, env), openFoodFactsCandidate(query)]);
  const candidates = [...fs];
  if (off && off.calories > 0) candidates.push(off);
  return { query, candidates };
}
