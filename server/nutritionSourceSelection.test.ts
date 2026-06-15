import { describe, expect, it } from "vitest";
import { selectNutritionSource, type NutritionSourceCandidate } from "./nutritionSourceSelection";

const brandedExact: NutritionSourceCandidate = {
  id: "coca-zero-label",
  name: "Coca-Cola zero lata",
  brandName: "Coca-Cola",
  sourceType: "manufacturer_label",
  sourceName: "Rótulo do fabricante",
  sourceVersion: "2026-01",
  reviewedAt: "2026-06-01",
  confidence: 0.96,
  servingUnit: "lata",
  aliases: ["coca cola zero", "coca zero lata"],
};

const brandedTraditional: NutritionSourceCandidate = {
  id: "coca-tradicional-label",
  name: "Coca-Cola tradicional lata",
  brandName: "Coca-Cola",
  sourceType: "manufacturer_label",
  sourceName: "Rótulo do fabricante",
  confidence: 0.95,
  servingUnit: "lata",
  aliases: ["coca cola tradicional", "coca lata"],
};

const genericSoda: NutritionSourceCandidate = {
  id: "refrigerante-generico",
  name: "Refrigerante cola",
  sourceType: "generic_estimate",
  sourceName: "Estimativa genérica",
  confidence: 0.48,
  servingUnit: "ml",
};

const officialChicken: NutritionSourceCandidate = {
  id: "tbca-frango-grelhado",
  name: "Frango grelhado",
  sourceType: "official_database",
  sourceName: "TBCA",
  sourceVersion: "2023",
  confidence: 0.9,
  servingUnit: "g",
  aliases: ["peito de frango grelhado"],
};

describe("selectNutritionSource", () => {
  it("prioriza produto com marca, variacao e fonte especifica", () => {
    const selection = selectNutritionSource({
      foodName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variation: "zero",
      unit: "lata",
    }, [genericSoda, brandedExact, brandedTraditional]);

    expect(selection.candidate?.id).toBe("coca-zero-label");
    expect(selection.quality).toBe("exact");
    expect(selection.isEstimate).toBe(false);
    expect(selection.reviewRequired).toBe(false);
    expect(selection.reasons).toContain("exact_brand_variation_match");
    expect(selection.source).toEqual(expect.objectContaining({
      type: "manufacturer_label",
      name: "Rótulo do fabricante",
      version: "2026-01",
    }));
  });

  it("nao usa versao tradicional quando a variacao zero foi informada", () => {
    const selection = selectNutritionSource({
      foodName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variation: "zero",
      unit: "lata",
    }, [brandedTraditional]);

    expect(selection.candidate).toBeNull();
    expect(selection.quality).toBe("needs_review");
    expect(selection.reviewRequired).toBe(true);
    expect(selection.reasons).toEqual(expect.arrayContaining([
      "critical_variation_mismatch_rejected",
      "no_candidate_available",
    ]));
  });

  it("usa fallback estimado e marca revisao quando produto de marca nao tem fonte especifica", () => {
    const selection = selectNutritionSource({
      foodName: "Refrigerante Exemplo zero",
      brandName: "Exemplo",
      variation: "zero",
      unit: "ml",
    }, [genericSoda]);

    expect(selection.candidate?.id).toBe("refrigerante-generico");
    expect(selection.quality).toBe("estimated");
    expect(selection.isEstimate).toBe(true);
    expect(selection.reviewRequired).toBe(true);
    expect(selection.reasons).toEqual(expect.arrayContaining(["estimated_fallback_used"]));
  });

  it("prioriza base oficial ou curada para alimento sem marca", () => {
    const selection = selectNutritionSource({
      foodName: "peito de frango grelhado",
      unit: "g",
    }, [officialChicken]);

    expect(selection.candidate?.id).toBe("tbca-frango-grelhado");
    expect(selection.quality).toBe("exact");
    expect(selection.reviewRequired).toBe(false);
    expect(selection.reasons).toContain("curated_or_official_unbranded_match");
    expect(selection.source).toEqual(expect.objectContaining({
      type: "official_database",
      name: "TBCA",
      version: "2023",
    }));
  });

  it("reduz confianca quando unidade ou porcao nao bate com a fonte", () => {
    const selection = selectNutritionSource({
      foodName: "peito de frango grelhado",
      unit: "fatia",
    }, [officialChicken]);

    expect(selection.candidate?.id).toBe("tbca-frango-grelhado");
    expect(selection.reviewRequired).toBe(true);
    expect(selection.confidence).toBeLessThan(0.9);
    expect(selection.reasons).toContain("unit_or_portion_uncertain");
  });
});
