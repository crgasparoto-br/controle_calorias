import { beforeEach, describe, expect, it, vi } from "vitest";

const getActivePendingOperationByTypeMock = vi.hoisted(() => vi.fn());
const listActivePendingOperationsByTypeMock = vi.hoisted(() => vi.fn());
const getActivePendingOperationMock = vi.hoisted(() => vi.fn());
const createPendingOperationMock = vi.hoisted(() => vi.fn());
const claimPendingOperationMock = vi.hoisted(() => vi.fn());
const listUserMealsMock = vi.hoisted(() => vi.fn());
const updateUserMealMock = vi.hoisted(() => vi.fn());
const persistArtifactMock = vi.hoisted(() => vi.fn());
const listArtifactsMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  getUserWhatsappConnection: vi.fn(async () => null),
  listUserMeals: listUserMealsMock,
  logInferenceEvent: vi.fn(),
  logPersistenceWarning: vi.fn(),
  updateUserMeal: updateUserMealMock,
}));

vi.mock("./catalogRuntime", () => ({
  refreshCatalogCache: vi.fn(async () => undefined),
}));

vi.mock("./modules/whatsapp/learningArtifactPersistence", () => ({
  listPersistedWhatsappLearningArtifacts: listArtifactsMock,
  persistWhatsappLearningArtifact: persistArtifactMock,
}));

vi.mock("./repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => ({
    listActivePendingOperationsByType: listActivePendingOperationsByTypeMock,
    getActivePendingOperationByType: getActivePendingOperationByTypeMock,
    getActivePendingOperation: getActivePendingOperationMock,
    createPendingOperation: createPendingOperationMock,
    claimPendingOperation: claimPendingOperationMock,
    cancelPendingOperation: vi.fn(),
    supersedePendingOperation: vi.fn(),
  })),
}));

vi.mock("./modules/whatsapp/pendingOperationPrecedence", () => ({
  supersedeActiveWhatsappPendingOperations: vi.fn(async () => true),
}));

vi.mock("./modules/whatsapp/replyTransport", () => ({
  sendWhatsAppLogicalReply: vi.fn(async () => ({ ok: true, sends: [] })),
}));

const {
  applyNutritionLabelPhotoToMeal,
  claimNutritionLabelPhotoRequest,
  createProvisionalNutritionLabelPhotoRequests,
  isNutritionLabelPhotoRequestTarget,
} = await import("./nutritionLabelCandidateService");

const provisionalItem = {
  foodName: "Amendoim Japonês Elma Chips",
  canonicalName: "Amendoim Japonês Elma Chips",
  brand: "Elma Chips",
  portionText: "1 pacote (145 g)",
  quantity: 1,
  unit: "pacote",
  servings: 1,
  estimatedGrams: 145,
  calories: 725,
  protein: 24.6,
  carbs: 66.7,
  fat: 40.6,
  confidence: 0.62,
  source: "heuristic" as const,
  resolution: {
    nutritionOrigin: "provisional_estimate" as const,
    nutritionVerified: false,
    sourceEvidence: null,
  },
};

const labelItem = {
  ...provisionalItem,
  foodName: "Amendoim Japonês Elma Chips",
  portionText: "25 g (1/4 xícara)",
  quantity: 25,
  unit: "g",
  servings: 1,
  estimatedGrams: 25,
  calories: 127,
  protein: 4.5,
  carbs: 9.8,
  fat: 7.8,
  confidence: 0.94,
  source: "hybrid" as const,
  resolution: {
    nutritionOrigin: "nutrition_label" as const,
    nutritionVerified: true,
    sourceEvidence: "Porção de 25 g: 127 kcal; proteínas 4,5 g; carboidratos 9,8 g; gorduras 7,8 g.",
    sourceVerifiedAt: "2026-09-22T10:55:00.000Z",
    sourceUrls: ["nutrition-label://amendoim-elma"],
    sourceConfidence: 0.94,
  },
};

describe("nutrition label provisional WhatsApp flow", () => {
  beforeEach(() => {
    getActivePendingOperationByTypeMock.mockReset();
    listActivePendingOperationsByTypeMock.mockReset();
    getActivePendingOperationMock.mockReset();
    createPendingOperationMock.mockReset();
    claimPendingOperationMock.mockReset();
    listUserMealsMock.mockReset();
    updateUserMealMock.mockReset();
    persistArtifactMock.mockReset();
    listArtifactsMock.mockReset();
    listArtifactsMock.mockResolvedValue([]);
    persistArtifactMock.mockResolvedValue({ id: 501 });
    getActivePendingOperationByTypeMock.mockResolvedValue(null);
    listActivePendingOperationsByTypeMock.mockResolvedValue([]);
    createPendingOperationMock.mockImplementation(async input => ({
      id: 701,
      userId: input.userId,
      type: input.type,
      target: input.target,
      origin: input.origin,
      state: "active",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + input.ttlMs),
      consumedAt: null,
    }));
  });

  it("persiste uma pendência com mealId e itemIndex para a estimativa provisória", async () => {
    const ids = await createProvisionalNutritionLabelPhotoRequests({
      userId: 42,
      mealId: 900,
      items: [provisionalItem],
    });

    expect(ids).toEqual([701]);
    expect(createPendingOperationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        type: "nutrition_label_photo_request",
        origin: "nutritionLabelCandidateService",
        target: expect.objectContaining({
          kind: "nutrition_label_photo_request",
          mealId: 900,
          itemIndex: 0,
          originalFoodName: "Amendoim Japonês Elma Chips",
        }),
      })
    );
    expect(
      isNutritionLabelPhotoRequestTarget(
        createPendingOperationMock.mock.calls[0][0].target
      )
    ).toBe(true);
  });

  it("não duplica a pendência do mesmo item ao repetir a confirmação", async () => {
    listActivePendingOperationsByTypeMock.mockResolvedValueOnce([
      {
      id: 702,
      target: {
        kind: "nutrition_label_photo_request",
        mealId: 900,
        itemIndex: 0,
        identityKey: "same",
        originalFoodName: "Amendoim Japonês Elma Chips",
        instructionText: "foto",
        actions: [{ id: "cancel", title: "Cancelar" }],
      },
      },
    ]);

    await expect(
      createProvisionalNutritionLabelPhotoRequests({
        userId: 42,
        mealId: 900,
        items: [provisionalItem],
      })
    ).resolves.toEqual([702]);
    expect(createPendingOperationMock).not.toHaveBeenCalled();
  });

  it("mantém uma pendência distinta para cada item provisório", async () => {
    const firstTarget = {
      kind: "nutrition_label_photo_request" as const,
      mealId: 900,
      itemIndex: 0,
      identityKey: "first",
      originalFoodName: "Amendoim",
      instructionText: "foto",
      actions: [{ id: "cancel" as const, title: "Cancelar" }],
    };
    listActivePendingOperationsByTypeMock.mockResolvedValueOnce([
      { id: 704, target: firstTarget },
    ]);

    await createProvisionalNutritionLabelPhotoRequests({
      userId: 42,
      mealId: 900,
      items: [provisionalItem, { ...provisionalItem, foodName: "Castanha" }],
    });

    expect(createPendingOperationMock).toHaveBeenCalledTimes(1);
    expect(createPendingOperationMock.mock.calls[0][0].target).toEqual(
      expect.objectContaining({ mealId: 900, itemIndex: 1 })
    );
  });

  it("reivindica a pendência de rótulo mesmo quando outra pendência é mais recente", async () => {
    const labelRequest = {
      id: 703,
      userId: 42,
      type: "nutrition_label_photo_request",
      target: {
        kind: "nutrition_label_photo_request",
        candidateId: 991,
        mealId: 900,
        itemIndex: 0,
        identityKey: "same",
        originalFoodName: "Amendoim Japonês Elma Chips",
        instructionText: "foto",
        actions: [{ id: "cancel", title: "Cancelar" }],
      },
      version: 1,
    };
    listActivePendingOperationsByTypeMock.mockResolvedValueOnce([labelRequest]);
    claimPendingOperationMock.mockResolvedValueOnce({ claimed: true });

    await expect(claimNutritionLabelPhotoRequest(42)).resolves.toEqual(
      labelRequest
    );
    expect(claimPendingOperationMock).toHaveBeenCalledWith({
      id: 703,
      expectedVersion: 1,
    });
    expect(getActivePendingOperationMock).not.toHaveBeenCalled();
  });

  it("não consome a pendência automática quando a imagem não contém rótulo legível", async () => {
    const automaticRequest = {
      id: 705,
      userId: 42,
      type: "nutrition_label_photo_request",
      target: {
        kind: "nutrition_label_photo_request",
        mealId: 900,
        itemIndex: 0,
        identityKey: "same",
        originalFoodName: "Amendoim Japonês Elma Chips",
        instructionText: "foto",
        actions: [{ id: "cancel", title: "Cancelar" }],
      },
      version: 1,
    };
    listActivePendingOperationsByTypeMock.mockResolvedValueOnce([
      automaticRequest,
    ]);

    await expect(claimNutritionLabelPhotoRequest(42)).resolves.toBeNull();
    expect(claimPendingOperationMock).not.toHaveBeenCalled();
  });

  it("substitui nutrientes proporcionalmente na refeição original e não cria refeição nova", async () => {
    const originalMeal = {
      id: 900,
      userId: 42,
      mealLabel: "Café da manhã",
      occurredAt: new Date("2026-09-22T10:54:00.000Z").getTime(),
      notes: "Amendoim",
      sourceText: "1 pacote de amendoim japonês",
      items: [provisionalItem],
    };
    listUserMealsMock.mockResolvedValue([originalMeal]);
    updateUserMealMock.mockImplementation(async input => ({
      ...originalMeal,
      ...input,
      items: input.items,
    }));

    const updated = await applyNutritionLabelPhotoToMeal({
      mealId: 900,
      itemIndex: 0,
      userId: 42,
      item: labelItem,
    });

    expect(updated?.items).toHaveLength(1);
    expect(updated?.items[0]).toEqual(
      expect.objectContaining({
        calories: 736.6,
        protein: 26.1,
        carbs: 56.8,
        fat: 45.2,
        estimatedGrams: 145,
        resolution: expect.objectContaining({
          nutritionOrigin: "nutrition_label",
          nutritionVerified: true,
        }),
      })
    );
    expect(updateUserMealMock).toHaveBeenCalledOnce();
    expect(updateUserMealMock.mock.calls[0][0].items).toHaveLength(1);
    expect(persistArtifactMock).toHaveBeenCalled();
  });
});
