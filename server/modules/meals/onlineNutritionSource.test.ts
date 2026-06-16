import { describe, expect, it, vi } from "vitest";

import {
  lookupOnlineNutritionSource,
  selectOnlineNutritionCandidate,
  shouldLookupOnlineNutritionSource,
  type OnlineNutritionCandidate,
} from "./onlineNutritionSource";

const cocaZero: OnlineNutritionCandidate = {
  productName: "Coca-Cola Zero lata 350 ml",
  brandName: "Coca-Cola",
  variants: ["zero", "sem açúcar"],
  serving: {
    quantity: 350,
    unit: "ml",
    milliliters: 350,
  },
  nutrition: {
    caloriesKcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
  },
  source: {
    url: "https://www.coca-cola.com/br/pt/about-us/faq/coca-cola-zero",
    domain: "coca-cola.com",
    type: "manufacturer",
    retrievedAt: "2026-06-16T00:00:00.000Z",
  },
};

const cocaTraditional: OnlineNutritionCandidate = {
  ...cocaZero,
  productName: "Coca-Cola Original lata 350 ml",
  variants: ["tradicional", "original"],
  nutrition: {
    caloriesKcal: 149,
    proteinG: 0,
    carbsG: 37,
    fatG: 0,
  },
};

describe("online nutrition source lookup", () => {
  it("dispara busca apenas para produto com marca sem fonte interna exata", () => {
    expect(shouldLookupOnlineNutritionSource({
      text: "iogurte Nestlé natural",
      productName: "iogurte natural",
      brandName: "Nestlé",
      hasExactInternalSource: false,
    })).toBe(true);

    expect(shouldLookupOnlineNutritionSource({
      text: "banana",
      productName: "banana",
      hasExactInternalSource: false,
    })).toBe(false);

    expect(shouldLookupOnlineNutritionSource({
      text: "Coca-Cola zero",
      productName: "Coca-Cola zero",
      brandName: "Coca-Cola",
      hasExactInternalSource: true,
    })).toBe(false);
  });

  it("seleciona fonte exata de fabricante e normaliza para a quantidade informada", () => {
    const result = selectOnlineNutritionCandidate({
      text: "Coca-Cola zero lata 350 ml",
      productName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variants: ["zero"],
      quantity: 350,
      unit: "ml",
    }, [cocaZero]);

    expect(result).toEqual(expect.objectContaining({
      status: "exact",
      confidence: expect.any(Number),
      candidate: cocaZero,
      normalizedNutrition: expect.objectContaining({
        servingText: "350 ml",
        factor: 1,
        caloriesKcal: 0,
        carbsG: 0,
      }),
    }));
    expect(result.confidence).toBeGreaterThanOrEqual(0.86);
  });

  it("nao escolhe versao tradicional quando a variacao zero foi informada", () => {
    const result = selectOnlineNutritionCandidate({
      text: "Coca-Cola zero lata 350 ml",
      productName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variants: ["zero"],
      quantity: 350,
      unit: "ml",
    }, [cocaTraditional]);

    expect(result.status).toBe("not_found");
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("marca fontes muito proximas como ambiguas", () => {
    const similarZero = {
      ...cocaZero,
      productName: "Coca-Cola sem açúcar lata 350 ml",
      variants: ["sem açúcar", "zero"],
      source: {
        ...cocaZero.source,
        type: "official_label" as const,
      },
    };

    const result = selectOnlineNutritionCandidate({
      text: "Coca-Cola zero lata 350 ml",
      productName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variants: ["zero"],
      quantity: 350,
      unit: "ml",
    }, [cocaZero, similarZero]);

    expect(result).toEqual(expect.objectContaining({
      status: "ambiguous",
      alternatives: expect.arrayContaining([cocaZero, similarZero]),
    }));
  });

  it("nao normaliza porcao quando a unidade nao e convertivel com seguranca", () => {
    const result = selectOnlineNutritionCandidate({
      text: "Coca-Cola zero uma lata",
      productName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variants: ["zero"],
      quantity: 1,
      unit: "lata",
    }, [cocaZero]);

    expect(result).toEqual(expect.objectContaining({
      status: "similar",
      normalizedNutrition: undefined,
      reason: expect.stringContaining("porcao"),
    }));
  });

  it("bloqueia fonte fora da allowlist", () => {
    const result = selectOnlineNutritionCandidate({
      text: "Coca-Cola zero lata",
      productName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variants: ["zero"],
    }, [{
      ...cocaZero,
      source: {
        ...cocaZero.source,
        domain: "fonte-desconhecida.example",
        url: "https://fonte-desconhecida.example/coca-zero",
      },
    }]);

    expect(result).toEqual(expect.objectContaining({
      status: "unsafe_source",
      confidence: 0,
    }));
  });

  it("retorna fallback seguro quando o provider falha", async () => {
    const provider = {
      search: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };

    const result = await lookupOnlineNutritionSource({
      text: "Coca-Cola zero lata",
      productName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variants: ["zero"],
    }, provider);

    expect(provider.search).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      status: "provider_error",
      confidence: 0,
      errorCode: "timeout",
    }));
  });
});
