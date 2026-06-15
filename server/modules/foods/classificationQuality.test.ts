import { describe, expect, it } from "vitest";
import { evaluateFoodClassificationQuality } from "./classificationQuality";

describe("evaluateFoodClassificationQuality", () => {
  it("marca alimento com categoria, fonte e classificacao inferivel como completo", () => {
    const quality = evaluateFoodClassificationQuality({
      name: "Peito de frango grelhado",
      category: "Proteinas",
      source: {
        id: 1,
        slug: "tbca",
        name: "Tabela Brasileira de Composicao de Alimentos",
        version: "2023",
        foodCode: "123",
      },
    });

    expect(quality).toEqual({
      status: "complete",
      reviewRequired: false,
      confidence: 1,
      reasons: [],
      flags: ["generic", "protein"],
    });
  });

  it("identifica alimento sem categoria, fonte e classificacao util como pendente", () => {
    const quality = evaluateFoodClassificationQuality({
      name: "Item importado sem revisao",
      category: null,
      source: null,
    });

    expect(quality.status).toBe("pending");
    expect(quality.reviewRequired).toBe(true);
    expect(quality.confidence).toBeLessThan(0.6);
    expect(quality.reasons).toEqual(expect.arrayContaining([
      "missing_category",
      "missing_nutrition_source",
      "missing_processing_classification",
      "estimated_or_generic_source",
    ]));
    expect(quality.flags).toEqual(["generic"]);
  });

  it("classifica bebida sem acucar como bebida de baixa caloria", () => {
    const quality = evaluateFoodClassificationQuality({
      name: "Cafe sem acucar",
      category: "Bebidas",
      source: {
        id: 2,
        slug: "curated-catalog",
        name: "Catalogo curado",
      },
    });

    expect(quality.status).toBe("complete");
    expect(quality.reasons).toEqual([]);
    expect(quality.flags).toEqual(expect.arrayContaining(["beverage", "generic", "low_calorie_drink"]));
  });

  it("marca produto com marca e fonte generica para revisao", () => {
    const quality = evaluateFoodClassificationQuality({
      name: "Refrigerante zero lata",
      brandName: "Exemplo",
      category: "Bebidas",
      source: {
        id: 3,
        slug: "generic-estimate",
        name: "Estimativa generica",
      },
    });

    expect(quality.status).toBe("partial");
    expect(quality.reviewRequired).toBe(true);
    expect(quality.reasons).toEqual(expect.arrayContaining([
      "estimated_or_generic_source",
      "branded_product_without_specific_source",
    ]));
    expect(quality.flags).toEqual(expect.arrayContaining([
      "beverage",
      "branded",
      "low_calorie_drink",
      "ultra_processed",
    ]));
  });
});
