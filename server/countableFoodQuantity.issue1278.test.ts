import { describe, expect, it } from "vitest";
import { prepareCountableFoodRegistrationResolved } from "./countableFoodQuantity";
import { resolveSafeCountableCatalogGrams } from "./foodItemResolution";
import { resolveHouseholdMeasure } from "./householdMeasureResolution";

describe("issue #1278 — porção canônica da pêra e lote misto de frutas", () => {
  it("resolve a pêra pela medida caseira média curada, sem depender de pesquisa", () => {
    expect(resolveSafeCountableCatalogGrams("pêra", 1, "un", true)).toEqual(
      expect.objectContaining({
        grams: 178,
        food: expect.objectContaining({ name: "Pêra", servingLabel: "1 unidade" }),
      }),
    );
  });

  it.each([
    ["1 pêra", "pêra", 178, "canonical_portion", "178 g de pêra"],
    ["1,5 pêra williams", "pêra williams", 267, "canonical_portion", "267 g de pêra williams"],
    // Qualificador de cultivar não comprovado mantém a identidade informada e usa
    // a referência base como média usual estimada quando não há pesquisa utilizável.
    ["1 pêra packans", "pêra packans", 178, "usual_average", "178 g de pêra packans"],
  ])("registra %s preservando a identidade informada", async (input, foodName, grams, kind, expectedText) => {
    const prepared = await prepareCountableFoodRegistrationResolved(42, input);

    expect(prepared.pendingItems).toEqual([]);
    expect(prepared.registrationText).toBe(expectedText);
    expect(prepared.resolutions[0]).toEqual(
      expect.objectContaining({
        request: expect.objectContaining({ foodName, requestedUnit: "un" }),
        resolution: expect.objectContaining({ kind, grams }),
      }),
    );
  });

  it("usa a referência base somente quando a pesquisa não devolve referência utilizável", async () => {
    const unavailableRuntime = {
      resolveCapabilityConfig: () => ({
        state: "disabled" as const,
        primary: null,
        fallbacks: [],
      }),
      executeResolvedCapability: async () => {
        throw new Error("capability must not run while disabled");
      },
      createDomainTextResponse: async () => {
        throw new Error("provider must not run while disabled");
      },
    } as never;

    const fallback = await resolveHouseholdMeasure(
      { userId: 42, foodName: "pêra packans", quantity: 1, unit: "un" },
      unavailableRuntime,
    );

    expect(fallback).toEqual(
      expect.objectContaining({
        kind: "usual_average",
        grams: 178,
        requestedUnit: "unidade",
        sourceUrls: ["https://tabnut.dis.epm.br/alimento/09252/pera-cru"],
      }),
    );

    const unsupported = await resolveHouseholdMeasure(
      { userId: 42, foodName: "eletrodoméstico", quantity: 1, unit: "un" },
      unavailableRuntime,
    );
    expect(unsupported).toBeNull();
  });

  it("resolve o lote misto de frutas sem perder a fruta com qualificador não catalogado", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "1 pêra packans e 1 maçã fugi",
    );

    expect(prepared.pendingItems).toEqual([]);
    expect(prepared.registrationText).toBe("178 g de pêra packans\n130 g de maçã fugi");
  });

  it("não confunde laranja pêra com a fruta pêra", () => {
    expect(resolveSafeCountableCatalogGrams("laranja pêra", 1, "un", true)).toBeNull();
  });

  it("mantém as porções contáveis já curadas", async () => {
    const mortadela = await prepareCountableFoodRegistrationResolved(42, "1,5 fatias de mortadela");
    const linguica = await prepareCountableFoodRegistrationResolved(42, "2 linguiças de frango assadas");

    expect(mortadela.registrationText).toBe("22.5 g de mortadela");
    expect(linguica.registrationText).toBe("200 g de linguiças de frango assadas");
    expect([...mortadela.pendingItems, ...linguica.pendingItems]).toEqual([]);
  });
});
