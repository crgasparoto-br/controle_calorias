import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTextResponseMock, findCatalogFoodSemanticMock } = vi.hoisted(() => ({
  createTextResponseMock: vi.fn(),
  findCatalogFoodSemanticMock: vi.fn(async () => null),
}));

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({ createTextResponse: createTextResponseMock }),
}));
vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));
vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => findCatalogFoodSemanticMock(...args),
}));

const {
  decideCommercialNutritionPolicy,
  projectFoodResolution,
  resolveCanonicalFoodQuantity,
} = await import("./foodItemResolution");
const { processMealInput } = await import("./nutritionEngine");
const { prepareCountableFoodRegistrationResolved } = await import("./countableFoodQuantity");
const { resolveCanonicalFoodAdditionItems } = await import(
  "./modules/whatsapp/intent/canonicalFoodAdditionResolution"
);

const NOW = new Date("2026-09-29T11:00:00.000Z");
const TZ = "America/Sao_Paulo";

function aiFailure() {
  createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));
}

function extraction(items: Array<Record<string, unknown>>) {
  createTextResponseMock.mockResolvedValue({
    id: "resp-1244",
    outputText: JSON.stringify({
      mealLabel: "Café da manhã",
      confidence: 0.9,
      reasoning: "Itens identificados.",
      items,
    }),
    raw: { mocked: true },
  });
}

function extractedItem(overrides: Record<string, unknown>) {
  return {
    brand: null,
    servings: 1,
    estimatedCalories: 0,
    estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
    confidence: 0.9,
    foodClassification: {
      processingLevel: "processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 0,
      isPlainWater: false,
    },
    ...overrides,
  };
}

function householdRuntime(result: unknown = null) {
  return { resolveHouseholdMeasure: vi.fn(async () => result as never) };
}

async function captureError(promise: Promise<unknown>) {
  return promise.then(
    () => { throw new Error("expected clarification"); },
    error => error,
  );
}

/**
 * Registro normal: gate contável canônico + pipeline nutricional sobre o texto
 * reescrito. A quantidade original vem da resolução estruturada do gate.
 */
async function resolveThroughRegistration(text: string) {
  const prepared = await prepareCountableFoodRegistrationResolved(1244, text);
  expect(prepared.pendingItems).toEqual([]);
  expect(prepared.resolutions).toHaveLength(1);
  const [resolution] = prepared.resolutions;
  const processed = await processMealInput({
    text: prepared.registrationText,
    occurredAt: NOW,
    timeZone: TZ,
  });
  expect(processed.items).toHaveLength(1);
  return projectFoodResolution({
    item: {
      ...processed.items[0],
      quantity: resolution.request.count,
      unit: resolution.request.requestedUnit,
    },
    quantitySource: resolution.resolution.kind,
  });
}

/** Adição a refeição existente: resolvedor canônico de adição com runtime real. */
async function resolveThroughAddition(item: { foodName: string; quantity: number; unit: string }) {
  const result = await resolveCanonicalFoodAdditionItems({
    userId: 1244,
    addition: {
      mealLabel: "Café da manhã",
      date: NOW,
      items: [{ ...item, brand: null }],
    } as never,
    occurredAt: NOW,
    timeZone: TZ,
  });
  expect(result.kind).toBe("items");
  if (result.kind !== "items") throw new Error("expected items");
  const [resolved] = result.items;
  return projectFoodResolution({
    item: resolved as never,
    quantitySource: resolved.quantityResolution?.kind ?? null,
  });
}

beforeEach(() => {
  createTextResponseMock.mockReset();
  findCatalogFoodSemanticMock.mockReset();
  findCatalogFoodSemanticMock.mockResolvedValue(null);
  vi.stubEnv("AI_MEAL_VISION_PROVIDER", "openai");
  vi.stubEnv("AI_MEAL_VISION_MODEL", "gpt-4.1-mini");
});

describe("#1244 — quantidade canônica única", () => {
  it.each([
    ["ovo frito", 1, "un", 50],
    ["ovos fritos", 2, "un", 100],
    // Controles discriminantes fora dos casos citados na issue.
    ["ovos cozidos", 3, "un", 150],
    ["mussarela", 2, "fatia", 40],
  ])("resolve %s x%s %s pela porção canônica local sem medida caseira", async (foodName, count, unit, grams) => {
    const runtime = householdRuntime();
    const result = await resolveCanonicalFoodQuantity(
      { userId: 1, foodName, quantity: count, unit },
      runtime,
    );

    expect(result).toEqual(expect.objectContaining({
      kind: "canonical_portion",
      originalQuantity: count,
      grams,
    }));
    expect(runtime.resolveHouseholdMeasure).not.toHaveBeenCalled();
  });

  it("não reabre massa explícita, com ou sem marca", async () => {
    const runtime = householdRuntime();
    for (const brand of [null, "Growth"]) {
      const result = await resolveCanonicalFoodQuantity(
        { userId: 1, foodName: "creatina", brand, quantity: 6, unit: "g" },
        runtime,
      );
      expect(result).toEqual(expect.objectContaining({
        kind: "explicit_mass_or_volume",
        grams: 6,
      }));
    }
    expect(runtime.resolveHouseholdMeasure).not.toHaveBeenCalled();
  });

  it("não inventa gramatura para contável desconhecido sem referência segura", async () => {
    const runtime = householdRuntime(null);
    const result = await resolveCanonicalFoodQuantity(
      { userId: 1, foodName: "pitomba silvestre", quantity: 3, unit: "un" },
      runtime,
    );

    expect(result).toBeNull();
    expect(runtime.resolveHouseholdMeasure).toHaveBeenCalledTimes(1);
  });

  it("adição de `1 ovo frito` não pede gramatura e usa 50 g", async () => {
    aiFailure();
    const result = await resolveCanonicalFoodAdditionItems({
      userId: 1244,
      addition: {
        mealLabel: "Café da manhã",
        date: NOW,
        items: [{ foodName: "ovo frito", brand: null, quantity: 1, unit: "un" }],
      } as never,
      occurredAt: NOW,
      timeZone: TZ,
    });

    expect(result.kind).toBe("items");
    if (result.kind !== "items") return;
    expect(result.items[0]).toEqual(expect.objectContaining({
      quantity: 1,
      estimatedGrams: 50,
      quantityResolution: expect.objectContaining({ kind: "canonical_portion", grams: 50 }),
    }));
    expect(result.items[0].foodName.toLowerCase()).toContain("frito");
  });
});

describe("#1244 — paridade semântica entre registro e adição", () => {
  it.each([
    ["1 ovo frito", { foodName: "ovo frito", quantity: 1, unit: "un" }],
    ["2 ovos fritos", { foodName: "ovos fritos", quantity: 2, unit: "un" }],
    // Controle discriminante não citado na issue.
    ["3 ovos cozidos", { foodName: "ovos cozidos", quantity: 3, unit: "un" }],
  ])("%s produz o mesmo FoodResolutionResult nos dois entrypoints", async (text, addition) => {
    aiFailure();
    const registration = await resolveThroughRegistration(text);
    aiFailure();
    const added = await resolveThroughAddition(addition);

    expect(added.quantity).toEqual(registration.quantity);
    expect(added.nutrition).toEqual(registration.nutrition);
    expect(added.clarification).toEqual(registration.clarification);
    expect(added.clarification.required).toBe(false);
    expect(registration.quantity.source).toBe("canonical_portion");
    // O preparo permanece na identidade nutricional dos dois lados.
    expect(registration.identity.food).toMatch(/frit|cozid/);
    expect(added.identity.food).toMatch(/frit|cozid/);
  });
});

describe("#1244 — especificidade comercial", () => {
  const base = {
    alternatives: [],
    hasInferredNutrition: false,
    confidence: 0.9,
    visualEvidence: false,
    hasUnverifiedNutritionLabelClaim: false,
    foodClassification: null,
  };

  it("marca em categoria específica não cria pergunta de variante", () => {
    for (const [identitySource, brand] of [
      ["creatina growth", "Growth"],
      // Controle discriminante: outra categoria/marca fora da issue.
      ["colágeno hidrolisado sanavita", "Sanavita"],
    ]) {
      const decision = decideCommercialNutritionPolicy({
        ...base,
        identitySource,
        brand,
        requestedVariant: null,
      });
      expect(decision).toEqual({ kind: "clarify", reason: "commercial_nutrition_unverified" });
    }
  });

  it("categoria ampla sem variante continua exigindo variante", () => {
    expect(decideCommercialNutritionPolicy({
      ...base,
      identitySource: "chocolate nestle",
      brand: "Nestle",
      requestedVariant: null,
    })).toEqual({ kind: "clarify", reason: "brand_variant_unresolved" });
  });

  it("alternativas nutricionalmente distintas continuam fail-closed", () => {
    expect(decideCommercialNutritionPolicy({
      ...base,
      identitySource: "creatina growth",
      brand: "Growth",
      requestedVariant: null,
      alternatives: [
        { name: "Creatina Growth", brand: "Growth", productVariant: null, servingLabel: "3 g", gramsPerServing: 3 },
        { name: "Creatina Growth Sabor Limão", brand: "Growth", productVariant: "limão", servingLabel: "5 g", gramsPerServing: 5 },
      ],
    })).toEqual({ kind: "clarify", reason: "brand_variant_unresolved" });
  });

  it("baixa confiança visual mantém clarificação de identidade", () => {
    expect(decideCommercialNutritionPolicy({
      ...base,
      identitySource: "leite uht integral itambe",
      brand: "Itambé",
      requestedVariant: "integral",
      confidence: 0.3,
      visualEvidence: true,
    })).toEqual({ kind: "clarify", reason: "commercial_identity_unverified" });
  });

  it("baixa confiança não promove categoria específica a pendência nutricional", () => {
    expect(decideCommercialNutritionPolicy({
      ...base,
      identitySource: "creatina growth",
      brand: "Growth",
      requestedVariant: null,
      confidence: 0.3,
    })).toEqual({ kind: "clarify", reason: "brand_variant_unresolved" });
  });

  it("identidade completa usa referência genérica compatível como provisória", () => {
    const decision = decideCommercialNutritionPolicy({
      ...base,
      identitySource: "Leite UHT Integral Itambé",
      brand: "Itambé",
      requestedVariant: "integral",
      visualEvidence: true,
    });
    expect(decision.kind).toBe("provisional_generic_reference");
    if (decision.kind === "provisional_generic_reference") {
      expect(decision.reference.isBrandedProduct ?? false).toBe(false);
      expect(decision.reference.name.toLowerCase()).toContain("integral");
    }
  });

  it("token não explicado pela referência genérica não autoriza a referência", () => {
    const decision = decideCommercialNutritionPolicy({
      ...base,
      identitySource: "Leite UHT Integral Zero Lactose Itambé",
      brand: "Itambé",
      requestedVariant: "integral zero lactose",
      visualEvidence: true,
    });
    expect(decision.kind).toBe("clarify");
  });
});

describe("#1244 — pipeline real por canal", () => {
  function creatineItem() {
    return extractedItem({
      foodName: "creatina",
      brand: "Growth",
      quantity: 6,
      unit: "g",
      portionText: "6 g",
      estimatedGrams: 6,
    });
  }

  it.each([
    ["texto", { text: "6g creatina growth" }],
    ["áudio transcrito", { transcript: "6g creatina growth" }],
  ])("`6g creatina Growth` por %s preserva massa e marca e não pede variante", async (_label, input) => {
    extraction([creatineItem()]);
    const error = await captureError(processMealInput({ ...input, occurredAt: NOW, timeZone: TZ }));

    expect(error).toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({
        brand: "Growth",
        clarificationReason: "commercial_nutrition_unverified",
      }),
    });
    expect(error.message).not.toMatch(/variante|linha|sabor/i);
    expect(error.message).not.toMatch(/identidade comercial/i);
    const [item] = error.context.items;
    expect(item).toEqual(expect.objectContaining({ quantity: 6, unit: "g", estimatedGrams: 6 }));
    expect(projectFoodResolution({ item }).clarification.missingField).toBe("nutrition");
  });

  it("texto e áudio concordam semanticamente para `6g creatina Growth`", async () => {
    extraction([creatineItem()]);
    const textError = await captureError(processMealInput({ text: "6g creatina growth", occurredAt: NOW, timeZone: TZ }));
    extraction([creatineItem()]);
    const audioError = await captureError(processMealInput({ transcript: "6g creatina growth", occurredAt: NOW, timeZone: TZ }));

    const text = projectFoodResolution({ item: textError.context.items[0] });
    const audio = projectFoodResolution({ item: audioError.context.items[0] });
    expect(audio).toEqual(text);
  });

  function milkImageItem(overrides: Record<string, unknown> = {}) {
    return extractedItem({
      foodName: "Leite UHT Integral Itambé",
      brand: null,
      quantity: 200,
      unit: "ml",
      portionText: "200 ml",
      estimatedGrams: 200,
      foodClassification: {
        processingLevel: "processed",
        isFruit: false,
        isVegetable: false,
        fiberGrams: 0,
        isPlainWater: false,
      },
      ...overrides,
    });
  }

  it("imagem frontal de Leite UHT Integral Itambé vira estimativa provisória, não falha de identidade", async () => {
    extraction([milkImageItem()]);
    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,controlled-milk-fixture",
      occurredAt: NOW,
      timeZone: TZ,
    });

    expect(result.semanticContract.needsClarification).toBe(false);
    const [item] = result.items;
    expect(item).toEqual(expect.objectContaining({
      brand: "Itambé",
      quantity: 200,
      unit: "ml",
      resolution: expect.objectContaining({
        nutritionOrigin: "provisional_estimate",
        nutritionVerified: false,
        ambiguity: null,
      }),
    }));
    expect(item.foodName).toMatch(/integral/i);
    expect(item.calories).toBeGreaterThan(0);
    expect(item.resolution?.sourceEvidence).toMatch(/referência genérica/i);
    expect(item.resolution?.sourceEvidence).toMatch(/não é a composição oficial/i);
  });

  it("controle discriminante: outra marca/categoria com referência genérica completa segue o mesmo mecanismo", async () => {
    extraction([extractedItem({
      foodName: "Whey Protein Serrabella",
      brand: "Serrabella",
      quantity: 30,
      unit: "g",
      portionText: "30 g",
      estimatedGrams: 30,
    })]);
    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,controlled-whey-fixture",
      occurredAt: NOW,
      timeZone: TZ,
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      brand: "Serrabella",
      resolution: expect.objectContaining({
        nutritionOrigin: "provisional_estimate",
        nutritionVerified: false,
      }),
    }));
  });

  it("imagem com marca legível e variante ilegível pede a variante", async () => {
    extraction([milkImageItem({ foodName: "Leite Itambé" })]);
    const error = await captureError(processMealInput({
      imageUrl: "data:image/jpeg;base64,controlled-milk-no-variant",
      occurredAt: NOW,
      timeZone: TZ,
    }));

    expect(error).toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({ clarificationReason: "brand_variant_unresolved" }),
    });
  });

  it("imagem com baixa confiança continua em clarificação de identidade", async () => {
    extraction([milkImageItem({ confidence: 0.3 })]);
    const error = await captureError(processMealInput({
      imageUrl: "data:image/jpeg;base64,controlled-milk-low-confidence",
      occurredAt: NOW,
      timeZone: TZ,
    }));

    expect(error.code).toBe("food_identity_clarification_required");
    expect(error.context.clarificationReason).not.toBe("commercial_nutrition_unverified");
  });
});
