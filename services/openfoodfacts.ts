const BASE_URL = "https://world.openfoodfacts.org";
const USER_AGENT = "SetOS/1.0 (personal-tracker)";

interface OFFNutrition {
  food_name: string;
  brand: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  serving_size: string | null;
}

export async function searchOpenFoodFacts(
  query: string
): Promise<OFFNutrition | null> {
  try {
    const params = new URLSearchParams({
      search_terms: query,
      search_simple: "1",
      action: "process",
      json: "1",
      fields:
        "code,product_name,brands,nutriments,serving_size,nutrition_grades",
      page_size: "5",
    });

    const res = await fetch(`${BASE_URL}/cgi/search.pl?${params}`, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.products || data.products.length === 0) return null;

    // Pick the first product with nutriment data
    const product = data.products.find(
      (p: any) => p.nutriments && p.nutriments["energy-kcal_100g"] != null
    );
    if (!product) return null;

    const n = product.nutriments;

    return {
      food_name: product.product_name || query,
      brand: product.brands || null,
      calories: Math.round(n["energy-kcal_100g"] || 0),
      protein_g: Math.round(n.proteins_100g || 0),
      carbs_g: Math.round(n.carbohydrates_100g || 0),
      fat_g: Math.round(n.fat_100g || 0),
      fiber_g: Math.round(n.fiber_100g || 0),
      serving_size: product.serving_size || null,
    };
  } catch (e) {
    console.error("Open Food Facts lookup failed:", e);
    return null;
  }
}
