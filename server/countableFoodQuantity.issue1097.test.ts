import { describe, expect, it } from "vitest";
import { findCatalogFood } from "./catalogMatching";
import {
  getSafeCatalogCountableGrams,
  parseCountableFoodQuantitySegment,
  prepareCountableFoodRegistrationResolved,
} from "./countableFoodQuantity";

describe("issue #1097 — porções comuns e Panco Premium", () => {
  it.each([
    ["1 fatia de mussarela", "mussarela", 20],
    ["1 fatia de presunto", "presunto", 18],
  ])("resolve %s por catálogo local em %s g", (text, foodName, grams) => {
    const request = parseCountableFoodQuantitySegment(text);
    const food = request ? findCatalogFood(request.foodName) : undefined;

    expect(request).toEqual(
      expect.objectContaining({
        foodName,
        requestedUnit: "fatia",
        count: 1,
      })
    );
    expect(food).toBeDefined();
    expect(
      request && food ? getSafeCatalogCountableGrams(food, request) : null
    ).toBe(grams);
  });

  it("resolve o Panco Premium pela porção curada de 2 fatias = 50 g", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "1 fatia de pão de forma Panco Premium"
    );

    expect(prepared.pendingItems).toEqual([]);
    expect(prepared.registrationText).toBe(
      "25 g de pão de forma Panco Premium"
    );
    expect(prepared.resolutions).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          foodName: "pão de forma Panco Premium",
          brand: "Panco",
          requestedUnit: "fatia",
          count: 1,
        }),
        resolution: expect.objectContaining({
          kind: "canonical_portion",
          grams: 25,
        }),
        commercialFood: expect.objectContaining({
          name: "Pão de Forma Panco Premium",
          brandName: "Panco",
        }),
      }),
    ]);
  });

  it("resolve a mensagem multi-item do caso real sem pendência de fatia", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "1,5 pão francês, 1 fatia de mussarela, 1 fatia de presunto, 40g de requeijão, 20g de manteiga Batavo com sal, 3 xícaras de café, 1 fatia de pão de forma panco Premium"
    );

    expect(prepared.pendingItems).toEqual([]);
    expect(prepared.registrationText).toContain("75 g de pão francês");
    expect(prepared.registrationText).toContain("20 g de mussarela");
    expect(prepared.registrationText).toContain("18 g de presunto");
    expect(prepared.registrationText).toContain(
      "25 g de pão de forma panco Premium"
    );
  });
});
