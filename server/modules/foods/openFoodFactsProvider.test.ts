import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOpenFoodFactsCacheForTests,
  lookupOpenFoodFactsProduct,
} from "./openFoodFactsProvider";

const enabledEnv = {
  OPEN_FOOD_FACTS_ENABLED: "true",
  OPEN_FOOD_FACTS_USER_AGENT: "ControleCaloriasTest/1.0 (tests@example.com)",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Open Food Facts adapter", () => {
  beforeEach(() => clearOpenFoodFactsCacheForTests());

  it("rejeita barcode malformado antes de qualquer acesso externo", async () => {
    const fetchImpl = vi.fn();
    const result = await lookupOpenFoodFactsProduct({
      barcode: "12-345",
      fetchImpl,
      env: enabledEnv,
    });
    expect(result.status).toBe("invalid_barcode");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("não chama o provider com a flag desligada", async () => {
    const fetchImpl = vi.fn();
    const result = await lookupOpenFoodFactsProduct({
      barcode: "00012345678905",
      fetchImpl,
      env: {},
    });
    expect(result.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserva zeros à esquerda e transforma somente campos presentes em candidato", async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        status: 1,
        product: {
          product_name_pt: "Biscoito teste",
          brands: "Marca teste",
          generic_name: "original",
          quantity: "120 g",
          product_quantity_unit: "g",
          serving_size: "30 g",
          serving_quantity: 30,
          serving_quantity_unit: "g",
          nutriments: {
            "energy-kcal_100g": 480,
            proteins_100g: 6,
            carbohydrates_100g: 70,
            fat_100g: 20,
          },
          last_modified_t: 1700000000,
          image_front_url: "https://example.invalid/image.jpg",
        },
      })
    );
    const result = await lookupOpenFoodFactsProduct({
      barcode: "00012345678905",
      fetchImpl,
      env: enabledEnv,
      now: () => 1_700_000_100_000,
    });
    expect(result.status).toBe("found");
    expect(result.candidate?.barcode).toBe("00012345678905");
    expect(result.candidate?.nutritionPer100g.fiberGrams).toBeNull();
    expect(result.candidate?.provenance.imagePolicy).toContain("not imported");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/product/00012345678905?fields="),
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": enabledEnv.OPEN_FOOD_FACTS_USER_AGENT,
        }),
      })
    );
  });

  it("distingue resposta incompleta e nunca converte ausência em zero", async () => {
    const result = await lookupOpenFoodFactsProduct({
      barcode: "78912345",
      fetchImpl: vi.fn(async () =>
        response({
          status: 1,
          product: {
            product_name: "Produto parcial",
            nutriments: { "energy-kcal_100g": 0 },
          },
        })
      ),
      env: enabledEnv,
    });
    expect(result.status).toBe("incomplete");
    expect(result.candidate?.nutritionPer100g.proteinGrams).toBeNull();
  });

  it("limita retry em rate limit e mantém fallback explícito", async () => {
    const fetchImpl = vi.fn(async () => response({}, 429));
    const result = await lookupOpenFoodFactsProduct({
      barcode: "78912345",
      fetchImpl,
      env: enabledEnv,
      sleep: vi.fn(async () => undefined),
    });
    expect(result.status).toBe("rate_limited");
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("trata HTTP 404 como não encontrado sem consumir uma segunda tentativa", async () => {
    const fetchImpl = vi.fn(async () => response({}, 404));
    const result = await lookupOpenFoodFactsProduct({
      barcode: "78912345",
      fetchImpl,
      env: enabledEnv,
      sleep: vi.fn(async () => undefined),
    });
    expect(result.status).toBe("not_found");
    expect(result.attempts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifica timeout como indisponibilidade após retry limitado", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("synthetic timeout");
      error.name = "AbortError";
      throw error;
    });
    const result = await lookupOpenFoodFactsProduct({
      barcode: "78912345",
      fetchImpl,
      env: enabledEnv,
      sleep: vi.fn(async () => undefined),
    });
    expect(result.status).toBe("unavailable");
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("cacheia somente resultado externo e não repete a chamada válida", async () => {
    const fetchImpl = vi.fn(async () =>
      response({ status: 0, product: null })
    );
    const first = await lookupOpenFoodFactsProduct({
      barcode: "78912345",
      fetchImpl,
      env: enabledEnv,
    });
    const second = await lookupOpenFoodFactsProduct({
      barcode: "78912345",
      fetchImpl,
      env: enabledEnv,
    });
    expect(first.status).toBe("not_found");
    expect(second.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
