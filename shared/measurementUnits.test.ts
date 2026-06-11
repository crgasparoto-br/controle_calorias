import { describe, expect, it } from "vitest";

import {
  convertFoodQuantityForRegistration,
  getFoodDensityGPerMl,
  normalizeMeasurementUnit,
  normalizeTextMeasurementUnits,
} from "./measurementUnits";

describe("normalizeMeasurementUnit", () => {
  it("normaliza unidades padrao de peso e volume", () => {
    expect(normalizeMeasurementUnit("gr")).toBe("g");
    expect(normalizeMeasurementUnit("gramas")).toBe("g");
    expect(normalizeMeasurementUnit("mililitros")).toBe("ml");
    expect(normalizeMeasurementUnit("unidade")).toBe("un");
  });

  it("corrige abreviacoes provaveis de unidade quando o contexto e numerico", () => {
    expect(normalizeMeasurementUnit("mo")).toBe("ml");
    expect(normalizeMeasurementUnit("grs")).toBe("g");
    expect(normalizeMeasurementUnit("kgs")).toBe("kg");
  });

  it("mantem medidas caseiras e comerciais livres", () => {
    expect(normalizeMeasurementUnit("scoop")).toBe("scoop");
    expect(normalizeMeasurementUnit("long neck")).toBe("long neck");
    expect(normalizeMeasurementUnit("lata")).toBe("lata");
    expect(normalizeMeasurementUnit("xícara grande")).toBe("xícara grande");
  });
});

describe("normalizeTextMeasurementUnits", () => {
  it("normaliza unidades comuns preservando o restante da mensagem", () => {
    expect(normalizeTextMeasurementUnits("300mo água")).toBe("300 ml água");
    expect(normalizeTextMeasurementUnits("adicionar 2kgs arroz e 30grs feijão")).toBe("adicionar 2 kg arroz e 30 g feijão");
  });
});

describe("convertFoodQuantityForRegistration", () => {
  it("converte massa de leite integral para volume usando densidade documentada", () => {
    expect(getFoodDensityGPerMl("leite integral")).toBe(1.03);
    expect(convertFoodQuantityForRegistration({
      foodName: "leite integral",
      quantity: 211,
      unit: "g",
    })).toEqual(expect.objectContaining({
      quantity: 204.9,
      unit: "ml",
      estimatedGrams: 211,
      portionText: "204,9 ml (convertido de 211 g)",
    }));
  });

  it("nao inventa conversao massa-volume para alimento sem densidade confiavel", () => {
    expect(convertFoodQuantityForRegistration({
      foodName: "arroz branco",
      quantity: 211,
      unit: "g",
    })).toBeNull();
  });
});
