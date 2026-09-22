import { beforeEach, describe, expect, it, vi } from "vitest";

const getActivePendingOperationByTypeMock = vi.hoisted(() => vi.fn());
const listActivePendingOperationsByTypeMock = vi.hoisted(() => vi.fn());
const getActivePendingOperationMock = vi.hoisted(() => vi.fn());
const createPendingOperationMock = vi.hoisted(() => vi.fn());
const claimPendingOperationMock = vi.hoisted(() => vi.fn());
const getPendingOperationByIdMock = vi.hoisted(() => vi.fn());
const cancelPendingOperationMock = vi.hoisted(() => vi.fn());
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
    getPendingOperationById: getPendingOperationByIdMock,
    cancelPendingOperation: cancelPendingOperationMock,
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
  buildCandidateIdentityKey,
  claimNutritionLabelPhotoRequest,
  createProvisionalNutritionLabelPhotoRequests,
  isNutritionLabelPhotoClarificationTarget,
  isNutritionLabelPhotoRequestTarget,
  resolveNutritionLabelPhotoClarificationText,
  resolveNutritionLabelPhotoEvidence,
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

const doriLabelItem = {
  ...labelItem,
  foodName: "Amendoim Japonês Dori",
  canonicalName: "Amendoim Japonês Dori",
  brand: "Dori",
};

const beerItem = {
  foodName: "Cerveja Original",
  canonicalName: "Cerveja Original",
  brand: "Original",
  portionText: "3 garrafas (600 ml)",
  quantity: 3,
  unit: "garrafa",
  servings: 3,
  estimatedGrams: 1800,
  calories: 756,
  protein: 0,
  carbs: 63,
  fat: 0,
  confidence: 0.7,
  source: "heuristic" as const,
  resolution: {
    nutritionOrigin: "provisional_estimate" as const,
    nutritionVerified: false,
    sourceEvidence: null,
  },
};

function pendingRequest(id: number, itemIndex: number, item: typeof provisionalItem | typeof beerItem) {
  return {
    id,
    userId: 42,
    type: "nutrition_label_photo_request",
    target: {
      kind: "nutrition_label_photo_request",
      mealId: 900,
      itemIndex,
      identityKey: buildCandidateIdentityKey(item),
      originalFoodName: item.foodName,
      originalCanonicalName: item.canonicalName,
      originalBrand: item.brand,
      originalProductVariant: null,
      instructionText: "foto",
      actions: [{ id: "cancel", title: "Cancelar" }],
    },
    origin: "nutritionLabelCandidateService",
    state: "active",
    version: 1,
    createdAt: new Date("2026-09-22T10:54:00.000Z"),
    updatedAt: new Date("2026-09-22T10:54:00.000Z"),
    expiresAt: new Date("2099-09-23T10:54:00.000Z"),
    consumedAt: null,
  };
}

function originalMeal(items = [provisionalItem]) {
  return {
    id: 900,
    userId: 42,
    mealLabel: "Café da manhã",
    occurredAt: new Date("2026-09-22T10:54:00.000Z").getTime(),
    notes: "Amendoim",
    sourceText: "1 pacote de amendoim japonês",
    items,
  };
}

describe("nutrition label provisional WhatsApp flow", () => {
  beforeEach(() => {
    getActivePendingOperationByTypeMock.mockReset();
    listActivePendingOperationsByTypeMock.mockReset();
    getActivePendingOperationMock.mockReset();
    createPendingOperationMock.mockReset();
    claimPendingOperationMock.mockReset();
    getPendingOperationByIdMock.mockReset();
    cancelPendingOperationMock.mockReset();
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
    const meal = originalMeal();
    listUserMealsMock.mockResolvedValue([meal]);
    updateUserMealMock.mockImplementation(async input => ({
      ...meal,
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
        foodName: "Amendoim Japonês Elma Chips",
        canonicalName: "Amendoim Japonês Elma Chips",
        brand: "Elma Chips",
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

  it("nunca troca a identidade Elma Chips por Dori ao aplicar nutrientes do rótulo", async () => {
    const meal = originalMeal();
    listUserMealsMock.mockResolvedValue([meal]);
    updateUserMealMock.mockImplementation(async input => ({
      ...meal,
      ...input,
      items: input.items,
    }));

    const updated = await applyNutritionLabelPhotoToMeal({
      mealId: 900,
      itemIndex: 0,
      userId: 42,
      item: doriLabelItem,
    });

    expect(updated?.items[0]).toEqual(
      expect.objectContaining({
        foodName: "Amendoim Japonês Elma Chips",
        canonicalName: "Amendoim Japonês Elma Chips",
        brand: "Elma Chips",
        calories: 736.6,
      })
    );
  });

  it("persiste conflito Dori versus Elma sem consumir a pendência original", async () => {
    const meal = originalMeal();
    const source = pendingRequest(801, 0, provisionalItem);
    listActivePendingOperationsByTypeMock.mockResolvedValue([source]);
    listUserMealsMock.mockResolvedValue([meal]);

    const result = await resolveNutritionLabelPhotoEvidence({
      userId: 42,
      item: doriLabelItem,
      captionText: "Amendoim",
      sourceText: "Amendoim",
      sourceMessageId: "wamid-label-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        action: "nutrition_label_photo_identity_confirmation_requested",
      })
    );
    expect(claimPendingOperationMock).not.toHaveBeenCalled();
    expect(updateUserMealMock).not.toHaveBeenCalled();
    const clarificationTarget = createPendingOperationMock.mock.calls.at(-1)?.[0]?.target;
    expect(isNutritionLabelPhotoClarificationTarget(clarificationTarget)).toBe(true);
    expect(clarificationTarget).toEqual(
      expect.objectContaining({
        sourceMessageId: "wamid-label-1",
        evidenceItem: expect.objectContaining({ brand: "Dori" }),
        candidates: [
          expect.objectContaining({
            sourcePendingOperationId: 801,
            originalBrand: "Elma Chips",
          }),
        ],
      })
    );
  });

  it("resposta Não é Dori, é Elma Chips retoma a foto persistida e atualiza uma única vez", async () => {
    const meal = originalMeal();
    const source = pendingRequest(802, 0, provisionalItem);
    listActivePendingOperationsByTypeMock.mockResolvedValue([source]);
    listUserMealsMock.mockResolvedValue([meal]);
    updateUserMealMock.mockImplementation(async input => ({
      ...meal,
      ...input,
      items: input.items,
    }));

    await resolveNutritionLabelPhotoEvidence({
      userId: 42,
      item: doriLabelItem,
      captionText: "Amendoim",
      sourceText: "Amendoim",
      sourceMessageId: "wamid-label-2",
    });
    const target = createPendingOperationMock.mock.calls.at(-1)?.[0]?.target;
    const clarification = {
      id: 901,
      userId: 42,
      type: "nutrition_label_photo_request",
      target,
      state: "active",
      version: 1,
    };
    getPendingOperationByIdMock.mockResolvedValue(source);
    claimPendingOperationMock.mockResolvedValue({ claimed: true });

    const result = await resolveNutritionLabelPhotoClarificationText({
      userId: 42,
      pendingOperation: clarification,
      text: "Não é Dori, é Elma Chips",
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "nutrition_label_photo_clarification_completed",
      })
    );
    expect(claimPendingOperationMock).toHaveBeenCalledTimes(2);
    expect(updateUserMealMock).toHaveBeenCalledOnce();
    expect(updateUserMealMock.mock.calls[0][0].items[0]).toEqual(
      expect.objectContaining({
        brand: "Elma Chips",
        calories: 736.6,
      })
    );
  });

  it("legenda Amendoim escolhe somente o amendoim quando há cerveja provisória", async () => {
    const meal = originalMeal([provisionalItem, beerItem]);
    const peanutRequest = pendingRequest(803, 0, provisionalItem);
    const beerRequest = pendingRequest(804, 1, beerItem);
    listActivePendingOperationsByTypeMock.mockResolvedValue([
      peanutRequest,
      beerRequest,
    ]);
    listUserMealsMock.mockResolvedValue([meal]);
    getPendingOperationByIdMock.mockResolvedValue(peanutRequest);
    claimPendingOperationMock.mockResolvedValue({ claimed: true });
    updateUserMealMock.mockImplementation(async input => ({
      ...meal,
      ...input,
      items: input.items,
    }));

    const result = await resolveNutritionLabelPhotoEvidence({
      userId: 42,
      item: labelItem,
      captionText: "Amendoim",
      sourceText: "Amendoim",
      sourceMessageId: "wamid-label-3",
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "nutrition_label_photo_applied",
      })
    );
    expect(updateUserMealMock).toHaveBeenCalledOnce();
    const savedItems = updateUserMealMock.mock.calls[0][0].items;
    expect(savedItems[0]).toEqual(
      expect.objectContaining({
        brand: "Elma Chips",
        calories: 736.6,
      })
    );
    expect(savedItems[1]).toEqual(beerItem);
  });

  it("rótulo ambíguo entre dois itens pede seleção e reutiliza a mesma evidência", async () => {
    const meal = originalMeal([provisionalItem, beerItem]);
    const peanutRequest = pendingRequest(805, 0, provisionalItem);
    const beerRequest = pendingRequest(806, 1, beerItem);
    const ambiguousLabel = {
      ...labelItem,
      foodName: "Produto embalado",
      canonicalName: "Produto embalado",
      brand: null,
    };
    listActivePendingOperationsByTypeMock.mockResolvedValue([
      peanutRequest,
      beerRequest,
    ]);
    listUserMealsMock.mockResolvedValue([meal]);

    const first = await resolveNutritionLabelPhotoEvidence({
      userId: 42,
      item: ambiguousLabel,
      sourceText: "Rótulo",
      sourceMessageId: "wamid-label-4",
    });

    expect(first).toEqual(
      expect.objectContaining({
        action: "nutrition_label_photo_selection_requested",
      })
    );
    expect(updateUserMealMock).not.toHaveBeenCalled();
    const target = createPendingOperationMock.mock.calls.at(-1)?.[0]?.target;
    expect(target).toEqual(
      expect.objectContaining({
        sourceMessageId: "wamid-label-4",
        candidates: expect.arrayContaining([
          expect.objectContaining({ originalBrand: "Elma Chips" }),
          expect.objectContaining({ originalBrand: "Original" }),
        ]),
      })
    );

    const clarification = {
      id: 902,
      userId: 42,
      type: "nutrition_label_photo_request",
      target,
      state: "active",
      version: 1,
    };
    getPendingOperationByIdMock.mockResolvedValue(peanutRequest);
    claimPendingOperationMock.mockResolvedValue({ claimed: true });
    updateUserMealMock.mockImplementation(async input => ({
      ...meal,
      ...input,
      items: input.items,
    }));

    const resumed = await resolveNutritionLabelPhotoClarificationText({
      userId: 42,
      pendingOperation: clarification,
      text: "Amendoim",
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        action: "nutrition_label_photo_clarification_completed",
      })
    );
    expect(updateUserMealMock).toHaveBeenCalledOnce();
    expect(updateUserMealMock.mock.calls[0][0].items[0]).toEqual(
      expect.objectContaining({
        foodName: "Amendoim Japonês Elma Chips",
        brand: "Elma Chips",
        calories: 736.6,
      })
    );
    expect(updateUserMealMock.mock.calls[0][0].items[1]).toEqual(beerItem);
  });

  it("claim concorrente perdido bloqueia atualização duplicada", async () => {
    const meal = originalMeal();
    const source = pendingRequest(807, 0, provisionalItem);
    listActivePendingOperationsByTypeMock.mockResolvedValue([source]);
    listUserMealsMock.mockResolvedValue([meal]);
    getPendingOperationByIdMock.mockResolvedValue(source);
    claimPendingOperationMock.mockResolvedValue({ claimed: false });

    const result = await resolveNutritionLabelPhotoEvidence({
      userId: 42,
      item: labelItem,
      captionText: "Amendoim Elma Chips",
      sourceMessageId: "wamid-label-5",
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "nutrition_label_photo_concurrent_or_stale",
      })
    );
    expect(updateUserMealMock).not.toHaveBeenCalled();
  });
});
