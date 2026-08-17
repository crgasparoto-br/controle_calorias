import { describe, expect, it } from "vitest";

import { resolveMealItemTarget } from "./mealItemTargetMatcher";

function item(foodName: string, overrides: Partial<{ canonicalName: string; brand: string; portionText: string }> = {}) {
  return {
    foodName,
    canonicalName: overrides.canonicalName ?? foodName,
    brand: overrides.brand ?? null,
    portionText: overrides.portionText ?? "100 g",
    estimatedGrams: 100,
  };
}

describe("resolveMealItemTarget", () => {
  it("encontra alimento por tokens parciais fora de ordem exata", () => {
    const result = resolveMealItemTarget([
      item("Arroz branco"),
      item("Queijo Minas Padrao Fatiado"),
      item("Tomate italiano"),
    ], "queijo minas");

    expect(result).toEqual(expect.objectContaining({
      kind: "matched",
      index: 1,
      item: expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado" }),
    }));
  });

  it("encontra alimento quando os tokens principais chegam em outra ordem", () => {
    const result = resolveMealItemTarget([
      item("Arroz branco"),
      item("Queijo Minas Padrao Fatiado"),
    ], "minas queijo");

    expect(result).toEqual(expect.objectContaining({
      kind: "matched",
      index: 1,
    }));
  });

  it("tolera pequeno erro de digitacao em token principal", () => {
    const result = resolveMealItemTarget([
      item("Pao frances"),
      item("Queijo Minas Padrao Fatiado"),
    ], "quejo minas");

    expect(result).toEqual(expect.objectContaining({
      kind: "matched",
      index: 1,
    }));
  });

  it("normaliza acentos e caixa antes de comparar", () => {
    const result = resolveMealItemTarget([
      item("Banana prata"),
      item("Pêra William"),
    ], "PERA");

    expect(result).toEqual(expect.objectContaining({
      kind: "matched",
      index: 1,
      item: expect.objectContaining({ foodName: "Pêra William" }),
    }));
  });

  it("usa nome canonico e marca como texto pesquisavel", () => {
    const result = resolveMealItemTarget([
      item("Iogurte natural", { canonicalName: "Iogurte desnatado", brand: "Nestle" }),
    ], "nestle desnatado");

    expect(result).toEqual(expect.objectContaining({
      kind: "matched",
      index: 0,
    }));
  });

  it("aceita alvo generico quando so existe um item compativel", () => {
    const result = resolveMealItemTarget([
      item("Arroz branco"),
      item("Queijo Minas Padrao Fatiado"),
    ], "queijo");

    expect(result).toEqual(expect.objectContaining({
      kind: "matched",
      index: 1,
    }));
  });

  it("pede esclarecimento quando alvo generico encontra varios candidatos", () => {
    const result = resolveMealItemTarget([
      item("Queijo Minas Padrao Fatiado"),
      item("Queijo mussarela"),
      item("Tomate italiano"),
    ], "queijo");

    expect(result).toEqual(expect.objectContaining({
      kind: "ambiguous",
      candidates: [
        expect.objectContaining({ index: 0 }),
        expect.objectContaining({ index: 1 }),
      ],
    }));
  });
});
