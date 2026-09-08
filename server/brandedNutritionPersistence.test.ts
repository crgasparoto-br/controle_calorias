import { describe, expect, it, vi } from "vitest";
import {
  buildNutritionResearchIdentityKey,
  createNutritionResearchPersistence,
} from "./brandedNutritionPersistence";
import type { CatalogFood } from "./nutritionEngineTypes";
import type {
  FoodCatalogRepository,
  FoodCatalogRow,
} from "./repositories/foodCatalogRepository";

const now = new Date("2026-09-05T12:00:00.000Z");

function row(overrides: Partial<FoodCatalogRow> = {}) {
  return {
    id: 10,
    slug: "web-nutrition-panco-premium",
    name: "Pão de Forma Panco Premium",
    aliases: JSON.stringify(["pão de forma Panco Premium 50 g"]),
    brandId: null,
    brandName: "Panco",
    productVariant: "premium",
    foodType: "branded" as const,
    barcode: null,
    dataSource: "web_nutrition",
    servingLabel: "2 fatias (50 g)",
    servingUnit: "g",
    gramsPerServing: 50,
    calories: 125,
    protein: 4,
    carbs: 24,
    fat: 1.5,
    fiber: 1.2,
    isFruit: 0,
    isVegetable: 0,
    isUltraProcessed: 1,
    processingLevel: "processed" as const,
    classificationSource: null,
    classificationConfidence: null,
    researchIdentityKey: buildNutritionResearchIdentityKey(
      "2 fatias de pão de forma Panco Premium 50 g"
    ),
    sourceUrls: JSON.stringify(["https://panco.com.br/produto/premium"]),
    sourceEvidence: "Tabela nutricional oficial: 125 kcal por 50 g.",
    sourceVerifiedAt: now,
    sourceConfidence: 0.9,
    isUserCreated: 0,
    createdByUserId: null,
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies FoodCatalogRow;
}

function food(overrides: Partial<CatalogFood> = {}): CatalogFood {
  return {
    slug: "web-nutrition-panco-premium",
    name: "Pão de Forma Panco Premium",
    aliases: ["2 fatias de pão de forma Panco Premium 50 g"],
    servingLabel: "2 fatias (50 g)",
    gramsPerServing: 50,
    calories: 125,
    protein: 4,
    carbs: 24,
    fat: 1.5,
    fiber: 1.2,
    brandName: "Panco",
    productVariant: "premium",
    variants: ["Pão de Forma Panco Premium"],
    sourceUrls: ["https://panco.com.br/produto/premium"],
    sourceEvidence: "Tabela nutricional oficial: 125 kcal por 50 g.",
    sourceVerifiedAt: now,
    sourceConfidence: 0.9,
    isBrandedProduct: true,
    ...overrides,
  };
}

function repository(overrides: Partial<FoodCatalogRepository> = {}) {
  return {
    findAll: vi.fn(async () => []),
    findResearchedByIdentity: vi.fn(async () => null),
    upsertResearchedNutrition: vi.fn(async () => 10),
    findResearchedCandidates: vi.fn(async () => []),
    findFavoriteIdsByUserId: vi.fn(async () => new Set<number>()),
    upsertFavorite: vi.fn(async () => undefined),
    deleteFavorite: vi.fn(async () => undefined),
    insert: vi.fn(async () => 10),
    update: vi.fn(async () => 1),
    ...overrides,
  } satisfies FoodCatalogRepository;
}

describe("brandedNutritionPersistence", () => {
  it("reutiliza uma fonte fresca e mantém a variante persistida", async () => {
    const stored = row();
    const repo = repository({
      findResearchedByIdentity: vi.fn(async key =>
        key === stored.researchIdentityKey ? stored : null
      ),
    });
    const persistence = createNutritionResearchPersistence({
      repository: repo,
      now: () => now,
    });

    const result = await persistence.findByIdentity(
      "2 fatias de pão de forma Panco Premium 50 g"
    );

    expect(result).toEqual(
      expect.objectContaining({
        brandName: "Panco",
        productVariant: "premium",
        calories: 125,
        sourceUrls: ["https://panco.com.br/produto/premium"],
      })
    );
    expect(repo.findResearchedByIdentity).toHaveBeenCalledWith(
      stored.researchIdentityKey
    );
  });

  it("não reutiliza resultado expirado", async () => {
    const repo = repository({
      findResearchedByIdentity: vi.fn(async () =>
        row({ sourceVerifiedAt: new Date("2026-07-01T12:00:00.000Z") })
      ),
    });
    const persistence = createNutritionResearchPersistence({
      repository: repo,
      now: () => now,
    });

    await expect(
      persistence.findByIdentity("2 fatias de pão de forma Panco Premium 50 g")
    ).resolves.toBeNull();
  });

  it("reutiliza candidato equivalente mesmo com ordem textual diferente", async () => {
    const stored = row();
    const repo = repository({
      findResearchedByIdentity: vi.fn(async () => null),
      findResearchedCandidates: vi.fn(async () => [stored]),
    });
    const persistence = createNutritionResearchPersistence({
      repository: repo,
      now: () => now,
    });

    const result = await persistence.findByIdentity(
      "Panco Premium pão de forma 50 g"
    );

    expect(result).toEqual(
      expect.objectContaining({
        brandName: "Panco",
        productVariant: "premium",
        calories: 125,
      })
    );
    expect(repo.findResearchedCandidates).toHaveBeenCalledWith({
      brandName: "Panco",
      limit: 50,
    });
  });

  it("não reutiliza candidato de variante divergente", async () => {
    const repo = repository({
      findResearchedByIdentity: vi.fn(async () => null),
      findResearchedCandidates: vi.fn(async () => [row()]),
    });
    const persistence = createNutritionResearchPersistence({
      repository: repo,
      now: () => now,
    });

    await expect(
      persistence.findByIdentity("Panco Integral pão de forma 50 g")
    ).resolves.toBeNull();
  });

  it("persiste fontes e evidência apenas para resultado completo e atualiza o cache", async () => {
    const repo = repository();
    const refresh = vi.fn(async () => undefined);
    const persistence = createNutritionResearchPersistence({
      repository: repo,
      refreshCatalogCache: refresh,
      now: () => now,
    });

    const result = await persistence.save(
      "2 fatias de pão de forma Panco Premium 50 g",
      food()
    );

    expect(result).toEqual(
      expect.objectContaining({
        researchIdentityKey: expect.stringMatching(/^nutrition-research-v1:/),
      })
    );
    expect(repo.upsertResearchedNutrition).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: "Panco",
        productVariant: "premium",
        sourceUrls: JSON.stringify(["https://panco.com.br/produto/premium"]),
        sourceEvidence: expect.stringContaining("125 kcal"),
        sourceVerifiedAt: now,
      })
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("não grava variante específica para uma consulta genérica", async () => {
    const repo = repository();
    const persistence = createNutritionResearchPersistence({
      repository: repo,
      now: () => now,
    });

    await expect(
      persistence.save("Panco pão de forma", food())
    ).resolves.toBeNull();
    expect(repo.upsertResearchedNutrition).not.toHaveBeenCalled();
  });

  it("não grava resultado sem fonte ou evidência", async () => {
    const repo = repository();
    const persistence = createNutritionResearchPersistence({
      repository: repo,
      now: () => now,
    });

    await expect(
      persistence.save(
        "Panco pão de forma",
        food({ sourceUrls: [], sourceEvidence: null })
      )
    ).resolves.toBeNull();
    expect(repo.upsertResearchedNutrition).not.toHaveBeenCalled();
  });
});
