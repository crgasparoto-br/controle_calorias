import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_CAPABILITY_REGISTRY } from "../capabilities";

describe("FOOD_CLASSIFICATION reservation contract", () => {
  it("has no independent external inference consumer in issue 922", () => {
    const mealExtraction = readFileSync("server/mealAiExtraction.ts", "utf8");
    const backfill = readFileSync("scripts/backfill-food-classification.ts", "utf8");

    expect(AI_CAPABILITY_REGISTRY.FOOD_CLASSIFICATION.hasConsumer).toBe(false);
    expect(mealExtraction).not.toContain("classifyFoodNameWithAi");
    expect(backfill).not.toContain("createTextResponse");
    expect(backfill).not.toContain("AI_CALL");
    expect(backfill).toContain("Nenhuma inferência externa de FOOD_CLASSIFICATION foi executada");
  });
});
