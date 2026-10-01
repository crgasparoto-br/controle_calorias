import { describe, expect, it } from "vitest";
import {
  getSafeCatalogCountableGrams,
  parseCountableFoodQuantitySegment,
  prepareCountableFoodRegistrationResolved,
  resolveSafeCountableCatalogGrams,
} from "./countableFoodQuantity";

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
  it("preserva 1,5 fatias de mortadela dentro de uma mensagem multi-item", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "1 pão francês, 1,5 fatias de mortadela, 10 g de manteiga",
    );

    expect(prepared.pendingItems).toEqual([]);
    expect(prepared.registrationText).toContain("22.5 g de mortadela");
  });
});
