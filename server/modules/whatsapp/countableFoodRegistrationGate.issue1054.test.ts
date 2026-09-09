import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood } from "../../nutritionEngineTypes";

const boundary = vi.hoisted(() => ({
  catalog: [] as CatalogFood[],
  search: vi.fn(),
  extraction: vi.fn(),
  confirm: vi.fn(),
  draft: vi.fn(),
  measureSearch: vi.fn(),
}));
vi.mock("../../catalogRuntime", () => ({
  getCatalogCache: () => boundary.catalog,
}));
vi.mock("../../catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => boundary.search(...args),
}));
vi.mock("../../mealAiExtraction", () => ({
  extractWithAi: (...args: unknown[]) => boundary.extraction(...args),
}));
vi.mock("../../_core/ai/domainTextResponse", () => ({
  createDomainTextResponse: (...args: unknown[]) =>
    boundary.measureSearch(...args),
}));
vi.mock("../../db", () => ({
  getDb: async () => null,
  logPersistenceWarning: vi.fn(),
  getHabitSnapshots: async () => [],
  createPendingMealInference: (...args: unknown[]) => boundary.draft(...args),
  confirmPendingMeal: (...args: unknown[]) => boundary.confirm(...args),
}));
vi.mock("../foods/service", () => ({
  searchGlobalFoodCatalog: async () => [],
  getGlobalFoodCatalogItem: vi.fn(),
  convertFoodPortionToGrams: vi.fn(),
}));
vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: async (_deps: unknown, meal: unknown) => ({
    action: "created",
    meal,
  }),
}));
vi.mock("./goalProgressService", () => ({
  getWhatsAppMealGoalProgress: async () => undefined,
}));

import { prepareWhatsappCountableFoodRegistration } from "./countableFoodRegistrationGate";
import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";
import { resolveWhatsappMealIntentRegistrationDetailsText } from "./mealIntentRegistrationDetailsInteraction";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import { detectKnownBrand } from "../../foodBrandDetection";
import { parseFoodText, splitFoodTextSegments } from "../../mealTextParsing";
import { MealInferenceError, processMealInput } from "../../nutritionEngine";

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});
let userId = 105400;
const now = new Date("2026-09-08T12:00:00Z");
function food(
  name = "Pão de forma Panco",
  grams = 50,
  brand = "Panco"
): CatalogFood {
  return {
    slug: name,
    name,
    aliases: [name],
    brandName: brand,
    isBrandedProduct: Boolean(brand),
    servingLabel: brand ? `2 fatias (${grams} g)` : "2 fatias",
    gramsPerServing: grams,
    calories: 127,
    protein: 4,
    carbs: 24,
    fat: 2,
    researchIdentityKey: `verified:${name}`,
    sourceUrls: [`https://example.test/${encodeURIComponent(name)}`],
    sourceEvidence: `Porção de ${grams} g (2 fatias): 127 kcal, 4 g proteínas, 24 g carboidratos, 2 g gorduras.`,
    sourceVerifiedAt: now,
    sourceConfidence: 0.95,
  };
}
const premium = () => ({
  ...food("Pão de forma Panco Premium", 50),
  productVariant: "premium",
});
const integral = () => ({
  ...food("Pão de forma Panco Integral", 60),
  productVariant: "integral",
});
const gate = (text: string) =>
  prepareWhatsappCountableFoodRegistration({ userId, text, receivedAt: now });

beforeEach(() => {
  userId++;
  boundary.catalog = [];
  vi.clearAllMocks();
  boundary.search.mockResolvedValue(null);
  boundary.measureSearch.mockRejectedValue(new Error("offline"));
  boundary.draft.mockReturnValue({ draftId: "draft-1054" });
  boundary.confirm.mockImplementation(async input => ({
    id: 1054,
    userId,
    mealLabel: input.mealLabel,
    occurredAt: input.occurredAt,
    items: input.items,
  }));
  boundary.extraction.mockImplementation(async ({ text }) => ({
    mealLabel: "Café da manhã",
    confidence: 0.9,
    reasoning: "Extração determinística no boundary de IA.",
    items: splitFoodTextSegments(text).map(segment => {
      const parsed = parseFoodText(segment);
      return {
        ...parsed,
        brand: detectKnownBrand(parsed.foodName),
        portionText: parsed.portionText ?? segment,
        servings: 1,
        estimatedGrams: parsed.estimatedGrams ?? 0,
        estimatedCalories: 0,
        estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
        confidence: 0.9,
      };
    }),
  }));
});

describe("#1054 — resolvedor real e precedência comercial", () => {
  it.each(["50 g", "Premium, 100 g de arroz", "Premium\n100 g de arroz"])(
    "não deixa %s substituir identidade ou deslocar os outros itens",
    async text => {
      boundary.catalog = [premium(), integral()];
      await gate("2 fatias de pão de forma Panco");
      const pending = await repository.getActivePendingOperation(userId, now);
      const reply = await resolveWhatsappMealIntentRegistrationDetailsText({
        userId,
        pendingOperation: pending!,
        text,
        receivedAt: now,
        userTimezone: "UTC",
      });
      // A complete new food command remains owned by the global router.
      expect(reply?.action ?? null).toBe(
        text === "50 g" ? "clarification_needed" : null
      );
      expect(
        (await repository.getActivePendingOperation(userId, now))?.id
      ).toBe(pending?.id);
      expect(boundary.confirm).not.toHaveBeenCalled();
    }
  );
  it("resolve uma referência canonicamente válida sem pedir peso e preserva fonte e marca", async () => {
    boundary.search.mockResolvedValue(food());
    const result = await gate("2 fatias de pão de forma Panco");
    expect(result).toMatchObject({
      kind: "ready",
      registrationText: "50 g de pão de forma Panco",
      resolutions: [
        {
          request: { brand: "Panco" },
          resolution: {
            kind: "researched_exact",
            grams: 50,
            sourceUrls: food().sourceUrls,
          },
        },
      ],
    });
    expect(boundary.search).toHaveBeenCalled();
    expect(boundary.measureSearch).not.toHaveBeenCalled();
  });

  it("pergunta variante primeiro e reutiliza os códigos/alternativas do contrato nutricional", async () => {
    boundary.catalog = [premium(), integral()];
    const result = await gate("2 fatias de pão de forma Panco");
    expect(result).toMatchObject({
      kind: "clarification",
      result: { data: { clarificationReason: "brand_variant_unresolved" } },
    });
    if (result.kind !== "clarification")
      throw new Error("Missing clarification");
    expect(result.result.reply).toMatch(/Premium.*Integral/);
    expect(result.result.reply).not.toMatch(/Informe somente o peso/);
    const canonical = await processMealInput({
      text: "2 fatias de pão de forma Panco",
    }).catch(error => error);
    expect(canonical).toBeInstanceOf(MealInferenceError);
    expect(result.result.data?.alternatives).toEqual(
      canonical.context.alternatives
    );
    expect(boundary.measureSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["Panco Premium", 50, "Panco"],
    ["Panco Integral", 60, "Panco"],
    ["Wickbold Integral", 56, "Wickbold"],
  ])(
    "resolve %s pela porção específica no mesmo caminho",
    async (identity, grams, brand) => {
      const reference = food(`Pão de forma ${identity}`, grams, brand);
      boundary.search.mockResolvedValue(reference);
      const result = await gate(`2 fatias de pão de forma ${identity}`);
      expect(result).toMatchObject({
        kind: "ready",
        registrationText: `${grams} g de pão de forma ${identity}`,
        resolutions: [
          {
            resolution: {
              grams,
              evidence: reference.sourceEvidence,
              sourceUrls: reference.sourceUrls,
            },
          },
        ],
      });
    }
  );

  it("pesquisa indisponível mantém identidade pendente e não usa macros genéricos", async () => {
    boundary.catalog = [food("Pão de forma", 50, "")];
    boundary.search.mockRejectedValue(new Error("search unavailable"));
    const result = await gate("2 fatias de pão de forma Panco");
    expect(result).toMatchObject({
      kind: "clarification",
      result: { data: { clarificationReason: "brand_variant_unresolved" } },
    });
    const pending = await repository.getActivePendingOperation(userId, now);
    expect(
      (pending?.target as any).countableContext.clarification.semanticContract
        .items[0].evidence.nutrition
    ).toMatchObject({
      verified: false,
      value: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    expect(boundary.confirm).not.toHaveBeenCalled();
  });

  it("identidade comprovada sem porção verificável permite pedir peso", async () => {
    boundary.search.mockResolvedValue({
      ...premium(),
      servingLabel: "100 g",
      gramsPerServing: 100,
    });
    const result = await gate("2 fatias de pão de forma Panco Premium");
    expect(result).toMatchObject({ kind: "clarification" });
    if (result.kind !== "clarification")
      throw new Error("Missing clarification");
    expect(result.result.reply).toContain("Informe somente o peso");
    expect(boundary.search).toHaveBeenCalled();
    expect(boundary.measureSearch).toHaveBeenCalled();
  });

  it("alimento sem marca mantém a porção genérica existente", async () => {
    boundary.catalog = [food("Pão de forma", 50, "")];
    expect(await gate("2 fatias de pão de forma")).toMatchObject({
      kind: "ready",
      registrationText: "50 g de pão de forma",
    });
  });

  it.each([food("Pão de forma Wickbold Premium", 45, "Wickbold"), integral()])(
    "rejeita outra marca ou variante: $name",
    async reference => {
      boundary.search.mockResolvedValue(reference);
      const result = await gate("2 fatias de pão de forma Panco Premium");
      expect(result).toMatchObject({
        kind: "clarification",
        result: {
          data: { clarificationReason: "commercial_identity_unverified" },
        },
      });
      expect(boundary.measureSearch).not.toHaveBeenCalled();
    }
  );

  it("variante explícita não comprovada mantém commercial_identity_unverified e marca", async () => {
    const result = await gate("2 fatias de pão de forma Panco Premium");
    expect(result).toMatchObject({
      kind: "clarification",
      result: {
        data: { clarificationReason: "commercial_identity_unverified" },
      },
    });
    if (result.kind !== "clarification")
      throw new Error("Missing clarification");
    expect(result.result.reply).toMatch(/Panco/);
    expect(result.result.reply).not.toMatch(/peso|volume/);
  });

  it.each(["50 g (2 fatias)", "Porção de 50 g (2 fatias)"])(
    "lê a relação física no rótulo %s",
    async servingLabel => {
      boundary.search.mockResolvedValue({ ...premium(), servingLabel });
      expect(
        await gate("2 fatias de pão de forma Panco Premium")
      ).toMatchObject({
        kind: "ready",
        registrationText: "50 g de pão de forma Panco Premium",
      });
    }
  );

  it("rejeita porção contraditória e evidência nutricional ausente", async () => {
    boundary.search.mockResolvedValue({ ...premium(), sourceUrls: [] });
    expect(await gate("2 fatias de pão de forma Panco Premium")).toMatchObject({
      kind: "clarification",
      result: {
        data: { clarificationReason: "commercial_identity_unverified" },
      },
    });
    boundary.search.mockResolvedValue({
      ...premium(),
      servingLabel: "2 fatias (75 g)",
    });
    const result = await gate("2 fatias de pão de forma Panco Premium");
    expect(result).toMatchObject({ kind: "clarification" });
    expect(result.kind === "clarification" && result.result.reply).toContain(
      "Informe somente o peso"
    );
  });

  it("analisa o lote completo, prioriza variante e não cria refeição parcial", async () => {
    boundary.catalog = [
      premium(),
      integral(),
      food("Presunto", 30, ""),
      food("Mussarela", 40, ""),
      { ...food("Leite integral", 100, ""), servingLabel: "100 ml" },
      { ...food("Requeijão Catupiry", 100, "Catupiry"), servingLabel: "100 g" },
    ];
    const text =
      "50ml leite integral, 2 fatias de pão de forma panco, 35g de requeijão catupiry, 1 fatia de presunto, 1 fatia de mussarela";
    const result = await executeConfirmedWhatsAppMealRegistration({
      userId,
      registrationText: text,
      originalText: text,
      occurredAt: now,
      userTimezone: "America/Sao_Paulo",
    });
    expect(result).toMatchObject({
      status: "clarification_requested",
      result: { data: { clarificationReason: "brand_variant_unresolved" } },
    });
    const pending = await repository.getActivePendingOperation(userId, now);
    expect(
      (pending!.target as any).countableContext.resolvedSegments
    ).toHaveLength(4);
    expect(boundary.draft).not.toHaveBeenCalled();
    expect(boundary.confirm).not.toHaveBeenCalled();
  });

  it.each(["cancelar", "expired", "different-user", "stale-operation"])(
    "protege continuação: %s",
    async scenario => {
      boundary.catalog = [premium(), integral()];
      await gate("2 fatias de pão de forma Panco");
      const pending = await repository.getActivePendingOperation(userId, now);
      if (scenario === "stale-operation")
        await gate("2 fatias de pão de forma Panco");
      const result = await resolveWhatsappMealIntentRegistrationDetailsText({
        userId: scenario === "different-user" ? userId + 100000 : userId,
        pendingOperation: pending!,
        text: scenario === "cancelar" ? "cancelar" : "Premium",
        receivedAt: new Date(
          now.getTime() + (scenario === "expired" ? 11 * 60 * 1000 : 1000)
        ),
        userTimezone: "UTC",
      });
      expect(boundary.confirm).not.toHaveBeenCalled();
      if (scenario === "cancelar")
        expect(result?.action).toBe("meal_intent_decision_cancelled");
      else expect(result).toBeNull();
      if (scenario === "stale-operation")
        expect(
          (await repository.getActivePendingOperation(userId, now))?.id
        ).not.toBe(pending?.id);
    }
  );

  it("analisa o exemplo de produção sem persistência parcial e retoma uma única vez com irmãos estáveis", async () => {
    const milk = { ...food("Leite integral", 100, ""), servingLabel: "100 ml" };
    const spread = {
      ...food("Requeijão Catupiry", 100, "Catupiry"),
      servingLabel: "100 g",
    };
    const ham = food("Presunto", 30, "");
    const cheese = food("Mussarela", 40, "");
    boundary.catalog = [premium(), integral(), milk, spread, ham, cheese];
    const text =
      "50ml leite integral, 2 fatias de pão de forma panco, 35g de requeijão catupiry, 1 fatia de presunto, 1 fatia de mussarela";
    const result = await executeConfirmedWhatsAppMealRegistration({
      userId,
      registrationText: text,
      originalText: text,
      occurredAt: now,
      userTimezone: "America/Sao_Paulo",
    });
    expect(result.status).toBe("clarification_requested");
    expect(boundary.draft).not.toHaveBeenCalled();
    expect(boundary.confirm).not.toHaveBeenCalled();
    const pending = await repository.getActivePendingOperation(userId, now);
    expect(pending).not.toBeNull();
    const context = (pending!.target as any).countableContext;
    expect(
      context.resolvedSegments.map((item: any) => item.segmentIndex)
    ).toEqual([0, 2, 3, 4]);
    const snapshots = structuredClone(context.resolvedSegments);
    boundary.catalog = [premium()]; // References for already resolved siblings disappear/change.
    boundary.extraction.mockClear();
    const reply = await resolveWhatsappMealIntentRegistrationDetailsText({
      userId,
      pendingOperation: pending!,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 1000),
      userTimezone: "UTC",
    });
    expect(reply?.action).toBe("meal_item_added");
    expect(boundary.confirm).toHaveBeenCalledOnce();
    const saved = boundary.confirm.mock.calls[0][0];
    expect(saved.items).toHaveLength(5);
    expect(saved.occurredAt).toBe(now.toISOString());
    for (const snapshot of snapshots)
      expect(saved.items[snapshot.segmentIndex]).toEqual(
        snapshot.processed.items[0]
      );
    expect(saved.items[1]).toMatchObject({
      brand: "Panco",
      estimatedGrams: 50,
      resolution: { productVariant: "premium", nutritionVerified: true },
    });
    expect(boundary.extraction).toHaveBeenCalledOnce();
    expect(
      await resolveWhatsappMealIntentRegistrationDetailsText({
        userId,
        pendingOperation: pending!,
        text: "Premium",
        receivedAt: new Date(now.getTime() + 2000),
        userTimezone: "UTC",
      })
    ).toBeNull();
    expect(boundary.confirm).toHaveBeenCalledOnce();
  });
});
