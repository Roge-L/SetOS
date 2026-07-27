import { describe, it, expect, vi, afterEach } from "vitest";
import { lookupFood } from "../src/services/nutrition";
import type { Env } from "../src/env";

// lookupFood only reads the (optional) FatSecret credentials; with none set it
// falls back to Open Food Facts, which is what these tests exercise.
const baseEnv = {} as unknown as Env;

afterEach(() => vi.restoreAllMocks());

function mockFetch(handler: (url: string) => unknown) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return { ok: true, json: async () => handler(url) } as Response;
  });
}

describe("lookupFood", () => {
  it("returns an Open Food Facts candidate when FatSecret creds are absent", async () => {
    // No FATSECRET_ID/SECRET → FatSecret is skipped; only OFF is queried.
    mockFetch((url) => {
      if (url.includes("openfoodfacts")) {
        return {
          products: [
            {
              product_name: "Fairlife Chocolate Protein Shake",
              brands: "Fairlife",
              nutriments: {
                "energy-kcal_100g": 60,
                proteins_100g: 12,
                carbohydrates_100g: 4,
                fat_100g: 1.5,
                fiber_100g: 0,
              },
            },
          ],
        };
      }
      return {};
    });

    const res = await lookupFood("fairlife chocolate protein", baseEnv);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({
      source: "openfoodfacts",
      name: "Fairlife Chocolate Protein Shake",
      basis: "100g",
      calories: 60,
      protein_g: 12,
    });
  });

  it("returns no candidates when nothing matches", async () => {
    mockFetch(() => ({ products: [] }));
    const res = await lookupFood("asdfqwer nonexistent food", baseEnv);
    expect(res.candidates).toHaveLength(0);
  });

  it("surfaces a FatSecret candidate when creds are present", async () => {
    const env = { ...baseEnv, FATSECRET_ID: "id", FATSECRET_SECRET: "secret" } as Env;
    mockFetch((url) => {
      if (url.includes("connect/token")) return { access_token: "tok" };
      if (url.includes("foods.search")) {
        return { foods: { food: { food_id: "1", food_name: "Big Mac", food_type: "Restaurant", brand_name: "McDonald's" } } };
      }
      if (url.includes("food.get")) {
        return {
          food: {
            food_name: "Big Mac",
            brand_name: "McDonald's",
            food_type: "Restaurant",
            servings: {
              serving: { serving_description: "1 burger", calories: "563", protein: "26", carbohydrate: "45", fat: "33", fiber: "3" },
            },
          },
        };
      }
      if (url.includes("openfoodfacts")) return { products: [] };
      return {};
    });

    const res = await lookupFood("big mac", env);
    const fs = res.candidates.find((c) => c.source === "fatsecret");
    expect(fs).toMatchObject({ name: "Big Mac", brand: "McDonald's", calories: 563, protein_g: 26 });
  });
});
