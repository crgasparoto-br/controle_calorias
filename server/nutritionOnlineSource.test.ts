import { describe, expect, it } from "vitest";
import {
  evaluateOnlineNutritionSourceCandidate,
  selectOnlineNutritionSourceCandidate,
  shouldRequestOnlineNutritionSource,
  type OnlineNutritionSourceCandidate,
} from "./nutritionOnlineSource";

const queriedAt = "2026-06-15T12:00:00.000Z";

const manufacturerCokeZero: OnlineNutritionSourceCandidate = {
  id: "coca-zero-official-label",
  name: "Coca-Cola zero lata 350 ml",
  brandName: "Coca-Cola",
  variation: "zero",
  originType: "manufacturer",
  sourceName: "Coca-Cola Brasil",
  sourceUrl: "https://www.coca-cola.com/br/pt/about-us/faq/coca-cola-zero",
  sourceVersion: "2026-06",
  queriedAt,
  confidence: 0.97,
  serving: {
    quantity: 350,
    unit: "lata",
    text: "1 lata (350 ml)",
  },
  nutritionPerServing: {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  },
  aliases: ["coca zero lata", "coca-cola zero"],
};

const retailerCokeZero: OnlineNutritionSourceCandidate = {
  ...manufacturerCokeZero,
  id: "coca-zero-retailer-label",
  originType: "trusted_retailer",
  sourceName: "Varejo com tabela nutricional",
  sourceUrl: "https://www.example.com/produtos/coca-zero-lata",
  confidence: 0.82,
};

const communityCokeZero: OnlineNutritionSourceCandidate = {
  ...manufacturerCokeZero,
  id: "coca-zero-community",
  originType: "community_database",
  sourceName: "Base comunitaria",
  sourceUrl: "https://community.example.com/foods/coca-zero",
  confidence: 0.64,
};

const traditionalCoke: OnlineNutritionSourceCandidate = {
  ...manufacturerCokeZero,
  id: "coca-traditional-official-label",
  name: "Coca-Cola tradicional lata 350 ml",
  variation: "tradicional",
  aliases: ["coca-cola tradicional", "coca lata"],
};

const query = {
  foodName: "Coca-Cola zero lata",
  brandName: "Coca-Cola",
  variation: "zero",
  unit: "lata",
};

describe("nutrition online source", () => {
  it("solicita busca online para produto de marca com variacao ou embalagem", () => {
    expect(shouldRequestOnlineNutritionSource(query)).toEqual({
      shouldRequest: true,
      reasons: expect.arrayContaining([
        "brand_present",
        "critical_variation_present",
        "packaging_or_unit_present",
      ]),
    });
  });

  it("aceita fonte do fabricante quando produto, variacao e porcao batem", () => {
    const evaluation = evaluateOnlineNutritionSourceCandidate(query, manufacturerCokeZero);

    expect(evaluation.status).toBe("accepted");
    expect(evaluation.candidate?.id).toBe("coca-zero-official-label");
    expect(evaluation.selection).toEqual(expect.objectContaining({
      quality: "exact",
      reviewRequired: false,
      isEstimate: false,
    }));
    expect(evaluation.selection?.source).toEqual(expect.objectContaining({
      type: "manufacturer_label",
      name: "Coca-Cola Brasil",
      version: "2026-06",
    }));
    expect(evaluation.reasons).toEqual(expect.arrayContaining([
      "source_allowed",
      "specific_source_match",
      "portion_safely_convertible",
    ]));
  });

  it("mantem varejo confiavel como revisao, nao como fonte exata automatica", () => {
    const evaluation = evaluateOnlineNutritionSourceCandidate(query, retailerCokeZero);

    expect(evaluation.status).toBe("needs_review");
    expect(evaluation.selection?.source.type).toBe("trusted_retailer");
    expect(evaluation.selection?.reviewRequired).toBe(true);
    expect(evaluation.reasons).toContain("trusted_retailer_requires_review");
  });

  it("rejeita candidato com variacao critica diferente", () => {
    const evaluation = evaluateOnlineNutritionSourceCandidate(query, traditionalCoke);

    expect(evaluation.status).toBe("rejected");
    expect(evaluation.selection?.candidate).toBeNull();
    expect(evaluation.reasons).toContain("candidate_mismatch");
  });

  it("envia para revisao quando a porcao nao e convertivel com seguranca", () => {
    const evaluation = evaluateOnlineNutritionSourceCandidate({
      ...query,
      unit: "copo",
    }, manufacturerCokeZero);

    expect(evaluation.status).toBe("needs_review");
    expect(evaluation.reasons).toContain("portion_not_safely_convertible");
  });

  it("nao usa fonte comunitaria como fonte exata", () => {
    const evaluation = evaluateOnlineNutritionSourceCandidate(query, communityCokeZero);

    expect(evaluation.status).toBe("needs_review");
    expect(evaluation.selection?.source.type).toBe("community_database");
    expect(evaluation.reasons).toContain("community_source_requires_review");
  });

  it("retorna fallback seguro quando nao ha candidato online confiavel", () => {
    const evaluation = selectOnlineNutritionSourceCandidate(query, []);

    expect(evaluation.status).toBe("fallback_safe");
    expect(evaluation.candidate).toBeNull();
    expect(evaluation.selection).toBeNull();
    expect(evaluation.reasons).toContain("no_online_candidate_available");
  });

  it("prioriza fabricante aceito antes de varejo revisavel", () => {
    const evaluation = selectOnlineNutritionSourceCandidate(query, [retailerCokeZero, manufacturerCokeZero]);

    expect(evaluation.status).toBe("accepted");
    expect(evaluation.candidate?.id).toBe("coca-zero-official-label");
  });
});
