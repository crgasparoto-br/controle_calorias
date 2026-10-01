import { describe, expect, it } from "vitest";
import {
  findUnsafeCountableFoodQuantity,
  getSafeCatalogCountableGrams,
  hasUnsafeKnownCountableFoodQuantity,
  parseCountableFoodQuantitySegment,
  prepareCountableFoodRegistrationResolved,
  resolveSafeCountableCatalogGrams,
} from "./countableFoodQuantity";
import { findCountableNutritionReference } from "./foodItemResolution";

describe("issue #1097 — porções comuns e Panco Premium", () => {
  it.each([
    ["1 fatia de mussarela", "mussarela", 20, 1],
    ["1 fatia de presunto", "presunto", 18, 1],
    ["1,5 fatias de mortadela", "mortadela", 22.5, 1.5],
    ["1.5 fatias de mortadela", "mortadela", 22.5, 1.5],
  ])("resolve %s por catálogo local em %s g", (text, foodName, grams, count) => {
    const request = parseCountableFoodQuantitySegment(text);

    expect(request).toEqual(
      expect.objectContaining({
        foodName,
        requestedUnit: "fatia",
        count,
      })
    );
    expect(
      request ? getSafeCatalogCountableGrams(undefined, request, true) : null
    ).toBe(grams);
    expect(resolveSafeCountableCatalogGrams(foodName, count, "fatia", true)).toEqual(
      expect.objectContaining({
        grams,
        food: expect.objectContaining({
          name: expect.stringMatching(/mussarela|presunto|mortadela/i),
        }),
      })
    );
  });

  it.each([
    ["ovo", 1, 50],
    ["ovo frito", 1, 50],
    ["ovos fritos", 2, 100],
  ])("resolve %s pela referência unitária do ovo", (foodName, count, grams) => {
    expect(resolveSafeCountableCatalogGrams(foodName, count, "un", true)).toEqual(
      expect.objectContaining({
        grams,
        food: expect.objectContaining({ name: "Ovo de galinha", gramsPerServing: 50 }),
      }),
    );
  });

  it.each([
    ["1 linguiça de frango assado", "linguiça de frango assado", 1, 100],
    ["2 linguiças de frango assadas", "linguiças de frango assadas", 2, 200],
  ])("resolve %s pela porção unitária canônica", (text, foodName, count, grams) => {
    const request = parseCountableFoodQuantitySegment(text);

    if (count === 1) {
      expect(request).toBeNull();
    } else {
      expect(request).toEqual(expect.objectContaining({
        foodName,
        count,
        requestedUnit: "un",
      }));
    }
    expect(resolveSafeCountableCatalogGrams(foodName, count, "un", true)).toEqual(
      expect.objectContaining({
        grams,
        food: expect.objectContaining({ name: expect.stringMatching(/ling.*frango/i) }),
      }),
    );
  });

  it("não mantém linguiça de frango assada pendente no registro resolvido", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "1 linguiça de frango assado",
    );

    expect(prepared.pendingItems).toEqual([]);
    expect(prepared.registrationText).toBe("100 g de linguiça de frango assado");
    expect(prepared.resolutions[0]).toEqual(expect.objectContaining({
      request: expect.objectContaining({
        foodName: "linguiça de frango assado",
        count: 1,
        requestedUnit: "un",
      }),
      resolution: expect.objectContaining({
        kind: "canonical_portion",
        grams: 100,
      }),
    }));
  });

  it("usa a referência nutricional curada da linguiça assada, sem placeholder", () => {
    expect(findCountableNutritionReference("linguiça de frango assado")).toEqual(
      expect.objectContaining({
        name: expect.stringMatching(/ling.*frango/i),
        calories: 243.66,
        protein: 18.19,
        carbs: 0,
        fat: 18.4,
      }),
    );
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
  it.each(["1,5 fatias de mortadela", "1.5 fatias de mortadela"])(
    "registra %s pela porção canônica de 15 g",
    async input => {
      const prepared = await prepareCountableFoodRegistrationResolved(
        42,
        input,
      );

      expect(prepared.pendingItems).toEqual([]);
      expect(prepared.registrationText).toBe("22.5 g de mortadela");
      expect(prepared.resolutions[0]).toEqual(expect.objectContaining({
        request: expect.objectContaining({
          foodName: "mortadela",
          count: 1.5,
          requestedUnit: "fatia",
        }),
        resolution: expect.objectContaining({
          kind: "canonical_portion",
          grams: 22.5,
        }),
      }));
    },
  );
  it.each(["1,5 kg de arroz", "1.5 ml de leite"])(
    "não reclassifica massa/volume decimal como unidade para %s",
    input => {
      expect(parseCountableFoodQuantitySegment(input)).toBeNull();
    },
  );
  it("não reabre massa canônica comercial no gate de contagem", () => {
    const input = "41,5 g de Kit Kat ao leite Nestlé";

    expect(findUnsafeCountableFoodQuantity(input)).toBeNull();
    expect(hasUnsafeKnownCountableFoodQuantity(input)).toBe(false);
    expect(hasUnsafeKnownCountableFoodQuantity("1 unidade de Kit Kat ao leite Nestlé")).toBe(true);
    expect(hasUnsafeKnownCountableFoodQuantity("100 g de arroz")).toBe(false);
  });
  it("preserva 1,5 fatias de mortadela dentro de uma mensagem multi-item", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "1 pão francês, 1,5 fatias de mortadela, 10 g de manteiga",
    );

    expect(prepared.pendingItems).toEqual([]);
    expect(prepared.registrationText).toContain("22.5 g de mortadela");
  });
});
