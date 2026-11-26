import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  choose: vi.fn(async () => ({ step: "continue_pipeline" })),
  pending: vi.fn(async (input: { type: string; target: unknown }) => ({ id: 23, ...input })),
  extract: vi.fn(async () => null),
  catalogCache: vi.fn(() => []),
  catalogCountable: vi.fn(),
  householdLookup: vi.fn(async () => null),
  semanticLookup: vi.fn(async () => null),
  fallback: vi.fn(),
  getHabits: vi.fn(async () => []),
  createDraft: vi.fn(() => { throw new Error("fixture stop before any write"); }),
  confirm: vi.fn(async () => { throw new Error("fixture does not confirm a meal"); }),
}));

vi.mock("./modules/whatsapp/messageRouter", () => ({
  resolveWhatsAppPrecedenceGate: doubles.choose,
}));
vi.mock("./repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: () => ({ createPendingOperation: doubles.pending }),
}));
vi.mock("./mealAiExtraction", () => ({ extractWithAi: doubles.extract }));
vi.mock("./catalogSemanticSearch", () => ({ findCatalogFoodSemantic: doubles.semanticLookup }));
vi.mock("./catalogRuntime", async importOriginal => ({
  ...(await importOriginal<typeof import("./catalogRuntime")>()), getCatalogCache: doubles.catalogCache,
}));
vi.mock("./foodItemResolution", async importOriginal => {
  const actual = await importOriginal<typeof import("./foodItemResolution")>();
  return {
    ...actual,
    findCountableCatalogReference: (...args: Parameters<typeof actual.findCountableCatalogReference>) => {
      doubles.catalogCountable();
      return actual.findCountableCatalogReference(...args);
    },
    resolveCanonicalFoodQuantity: doubles.householdLookup,
  };
});
vi.mock("./mealItemCleanup", async importOriginal => {
  const actual = await importOriginal<typeof import("./mealItemCleanup")>();
  return { ...actual, fallbackFromText: (...args: Parameters<typeof actual.fallbackFromText>) => {
    doubles.fallback();
    return actual.fallbackFromText(...args);
  } };
});

const historical = "Café com 1 colher de chá de açúcar e leite com mais um pouco e mais um pouco.";
const discourse = "café com 1 colher de chá de açúcar e talvez com mais um pouco";
const negatives = [historical, discourse,
  "Café com uma colher de sopa de açúcar, talvez com um pouquinho mais; 150 g de arroz.",
  "150 g de arroz; café com 1/2 colher de chá de açúcar, mais um pouco.",
];
const now = new Date("2026-11-25T12:00:00.000Z");
const userTimezone = "America/Sao_Paulo";
const userId = 17;
let engine: typeof import("./nutritionEngine");
let parsing: typeof import("./mealTextParsing");
let intent: typeof import("./modules/whatsapp/intentActions");
let preflight: typeof import("./modules/whatsapp/countableFoodRegistrationGate");
let confirmed: ReturnType<typeof import("./modules/whatsapp/confirmedMealRegistration").createConfirmedMealRegistrationService>;
beforeAll(async () => {
  intent = await import("./modules/whatsapp/intentActions");
  parsing = await import("./mealTextParsing");
  engine = await import("./nutritionEngine");
  preflight = await import("./modules/whatsapp/countableFoodRegistrationGate");
  const { createConfirmedMealRegistrationService } = await import("./modules/whatsapp/confirmedMealRegistration");
  confirmed = createConfirmedMealRegistrationService({
    getHabits: doubles.getHabits,
    createDraft: doubles.createDraft,
    confirmMeal: doubles.confirm,
  });
});

function assertNoNutritionOrSaveEffects() {
  expect(doubles.catalogCache).not.toHaveBeenCalled();
  expect(doubles.catalogCountable).not.toHaveBeenCalled();
  expect(doubles.householdLookup).not.toHaveBeenCalled();
  expect(doubles.semanticLookup).not.toHaveBeenCalled();
  expect(doubles.extract).not.toHaveBeenCalled();
  expect(doubles.fallback).not.toHaveBeenCalled();
  expect(doubles.getHabits).not.toHaveBeenCalled();
  expect(doubles.createDraft).not.toHaveBeenCalled();
  expect(doubles.confirm).not.toHaveBeenCalled();
}

function assertOwnerNeutral(prompt: string) {
  expect(prompt).toContain("Informe o alimento e a medida exata");
  expect(prompt).toContain("descrição completa");
  expect(prompt).not.toMatch(/açúcar|leite/iu);
}

beforeEach(() => vi.clearAllMocks());

describe("A-133915: an ownerless quantity never becomes a default food serving", () => {
  it.each([historical, discourse])("initial intent preserves the input and only offers the chooser: %s", async text => {
    const result = await intent.executeWhatsappTextIntent(userId, { text, receivedAt: now, userTimezone, messageId: "fixture-chooser" });
    expect(result?.eventType).toBe("whatsapp.meal_intent_decision.requested");
    expect(doubles.pending).toHaveBeenCalledTimes(1);
    expect(doubles.pending).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ originalText: text }),
    }));
    assertNoNutritionOrSaveEffects();
  });

  it.each(negatives)("real engine clarifies before any nutrition side effect: %s", async text => {
    const error = await engine.processMealInput({ text, userId, occurredAt: now, timeZone: userTimezone })
      .then(() => null, (failure: unknown) => failure);
    expect(error).toBeInstanceOf(engine.MealInferenceError);
    if (!(error instanceof engine.MealInferenceError)) throw new Error("expected clarified quantity");
    expect(error.context).toEqual({ originalText: text });
    assertOwnerNeutral(error.message);
    assertNoNutritionOrSaveEffects();
    expect(doubles.pending).not.toHaveBeenCalled();
  });

  it.each(negatives)("confirmed registration stops before lookup, inference or first-save fence: %s", async text => {
    const outcome = await confirmed({
      userId, originalText: text, registrationText: text,
      occurredAt: now, receivedAt: now, userTimezone, inboundMessageId: "fixture-registrar",
    });
    expect(outcome).toMatchObject({ status: "clarification_requested", result: {
      action: "clarification_needed", data: { retryRequiresFullMessage: true, consumptionPersisted: false },
    } });
    if (outcome.status !== "clarification_requested") throw new Error("expected clarified quantity");
    assertOwnerNeutral(outcome.result.reply);
    assertNoNutritionOrSaveEffects();
    expect(doubles.pending).not.toHaveBeenCalled();
  });

  it("a legacy newline handoff and skipCountablePreflight cannot reintroduce a portion", async () => {
    const registrationText = parsing.splitFoodTextSegments(historical).join("\n");
    expect(registrationText).not.toEqual(historical);
    const outcome = await confirmed({
      userId, originalText: historical, registrationText, occurredAt: now, userTimezone,
      skipCountablePreflight: true,
    });
    expect(outcome.status).toBe("clarification_requested");
    assertNoNutritionOrSaveEffects();
  });

  it.each([
    "Café com 1 colher de chá de açúcar e leite com mais um pouco",
    "Café com 1 colher de chá de açúcar e 100 ml de leite com mais um pouco",
    "Café com 1 colher de chá de açúcar, 100 ml de leite; 150 g de arroz.",
  ])("does not intercept an attached or explicitly separate item: %s", async text => {
    const prepared = await preflight.prepareWhatsappCountableFoodRegistration({ userId, userTimezone, text, receivedAt: now });
    expect(prepared.kind).toBe("ready");
    const result = await engine.processMealInput({ text, userId, occurredAt: now, timeZone: userTimezone });
    expect(doubles.extract).toHaveBeenCalledOnce();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every(item => !/^mais um pouco$/iu.test(item.foodName))).toBe(true);
    expect(doubles.createDraft).not.toHaveBeenCalled();
    expect(doubles.confirm).not.toHaveBeenCalled();
  });
});
