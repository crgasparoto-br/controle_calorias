import { afterEach, describe, expect, it, vi } from "vitest";
import { createFoodD1PublicWhatsAppRegistration } from "./publicWhatsAppRegistration";
import type { runFoodD1Migration } from "./entrypointRunner";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";

const sha = "c".repeat(40);
const approval: AuthorizedD1SimulationContext = {
  expectedAuditedBaseSha: sha,
  approval: { status: "approved", auditedBaseSha: sha,
    gateAReference: "approved-gate-a-fixture", rolloutReference: "approved-canary-fixture" },
  revisions: { code: sha, knowledge: "k1", lexicon: "l1", policy: "p1", resolver: "r1" },
};
const receivedAt = new Date("2026-11-03T15:00:00Z");
const createInput = (modality: "text" | "audio_transcript" = "text") => ({
  userId: 7, externalMessageId: "wamid.original-004", modality,
  originalText: "Adicionar ao almoço 100 g de arroz", receivedAt,
  timeZone: "America/Sao_Paulo",
});
const parsed = () => ({
  intent: "add_items_to_meal" as const,
  mealType: "Almoço", date: receivedAt,
  items: [{ foodName: "arroz", brand: null, quantity: 100, unit: "g",
    confidence: 1, missingFields: [] }],
  confidence: 1, missingFields: [],
});
const meal = () => ({
  id: 55, userId: 7, mealLabel: "Almoço", occurredAt: receivedAt,
  items: [{ foodName: "Arroz", canonicalName: "Arroz", portionText: "100 g",
    quantity: 100, unit: "g", servings: 1, estimatedGrams: 100,
    calories: 130, protein: 2.5, carbs: 28, fat: 0.3 }],
});

const savedGlobal = process.env.FOOD_V2_D1_ENABLED;
const savedSelected = process.env.FOOD_V2_D1_ENTRYPOINTS;
afterEach(() => {
  if (savedGlobal === undefined) delete process.env.FOOD_V2_D1_ENABLED;
  else process.env.FOOD_V2_D1_ENABLED = savedGlobal;
  if (savedSelected === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
  else process.env.FOOD_V2_D1_ENTRYPOINTS = savedSelected;
});
describe("#1308 trusted WhatsApp text/transcription V2 public boundary", () => {
  it("does not read gates, pending state or meal on an unselected entrypoint", async () => {
    process.env.FOOD_V2_D1_ENABLED = "false";
    const readAuthorizedContext = vi.fn(async () => null);
    const readActivePending = vi.fn(async () => false);
    const service = createFoodD1PublicWhatsAppRegistration({
      readAuthorizedContext, readActivePending,
    });
    expect(await service(createInput())).toBeNull();
    expect(readAuthorizedContext).not.toHaveBeenCalled();
    expect(readActivePending).not.toHaveBeenCalled();
  });
  it("stops at Gate A before parsing text or consulting the database", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const readActivePending = vi.fn(async () => false);
    const parseOperation = vi.fn(() => parsed());
    const service = createFoodD1PublicWhatsAppRegistration({
      readAuthorizedContext: async () => null, readActivePending, parseOperation,
    });
    await expect(service(createInput())).rejects
      .toThrow("food-d1-whatsapp-public-gate-unavailable");
    expect(readActivePending).not.toHaveBeenCalled();
    expect(parseOperation).not.toHaveBeenCalled();
  });
  it("requires a persisted external ID and blocks legacy pending states", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const parseOperation = vi.fn(() => parsed());
    const service = createFoodD1PublicWhatsAppRegistration({
      readAuthorizedContext: async () => approval,
      readActivePending: async () => true, parseOperation,
    });
    await expect(service(createInput())).rejects
      .toThrow("food-d1-whatsapp-public-legacy-pending-active");
    expect(parseOperation).not.toHaveBeenCalled();
    await expect(service({ ...createInput(), externalMessageId: null })).rejects
      .toThrow("food-d1-whatsapp-public-stable-message-required");
  });
  it("rejects ambiguous meal operation before inference or mutation", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const runner = vi.fn();
    const service = createFoodD1PublicWhatsAppRegistration({
      readAuthorizedContext: async () => approval,
      readActivePending: async () => false,
      parseOperation: () => ({ ...parsed(), mealType: null }),
      run: runner as unknown as typeof runFoodD1Migration,
    });
    await expect(service(createInput())).rejects
      .toThrow("food-d1-whatsapp-public-meal-operation-unresolved");
    expect(runner).not.toHaveBeenCalled();
  });
  it.each(["text", "audio_transcript"] as const)(
    "uses one native runner and stored meal for %s without any V1 re-inference",
    async modality => {
      process.env.FOOD_V2_D1_ENABLED = "true";
      process.env.FOOD_V2_D1_ENTRYPOINTS = "text,audio_transcript";
      const readMeal = vi.fn(async () => meal() as never);
      const run = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
        expect(args.request.entrypoint).toBe(modality);
        expect(args.request.evidence).toMatchObject({
          kind: "surface", modality, rawText: createInput().originalText,
        });
        expect(args.request.envelope.mealOperation)
          .toMatchObject({ action: "add", targetMeal: "Almoço", date: "2026-11-03" });
        expect(args.request.envelope.ownerUserId).toBe(7);
        expect(args.request.envelope.idempotencyKey).toMatch(/^d1-whatsapp-/);
        expect(args.request.envelope.traceId).toMatch(/^d1-trace-/);
        expect(args.request.envelope.revisions.code).toBe(sha);
        expect(args.request.envelope.contextSources.previousMessage.status).toBe("unavailable");
        args.beforeCommit?.({ items: [{ disposition: "ready" }], readyCount: 1 } as never);
        await expect(args.legacy()).rejects
          .toThrow("food-d1-whatsapp-public-cannot-replay-v1");
        return { committed: true, mealId: 55, operationKey: "key",
          recordedItemIds: [501], skipped: [] };
      });
      const service = createFoodD1PublicWhatsAppRegistration({
        readAuthorizedContext: async () => approval,
        readActivePending: async () => false,
        parseOperation: () => parsed(),
        readMeal, run: run as unknown as typeof runFoodD1Migration,
      });
      const result = await service(createInput(modality));
      expect(result).toMatchObject({
        action: "meal_item_added",
        data: { mealId: 55, resolverVersion: "v2", skippedItemCount: 0 },
      });
      expect(result?.reply).toContain("Arroz");
      expect(result?.reply).toContain("130");
      expect(readMeal).toHaveBeenCalledWith(7, 55);
      expect(run).toHaveBeenCalledOnce();
      const second = await service(createInput(modality));
      expect(second?.data?.mealId).toBe(55);
      const firstKey = (run.mock.calls[0][0] as Parameters<typeof runFoodD1Migration>[0])
        .request.envelope.idempotencyKey;
      const secondKey = (run.mock.calls[1][0] as Parameters<typeof runFoodD1Migration>[0])
        .request.envelope.idempotencyKey;
      expect(secondKey).toBe(firstKey);
    },
  );
  it("pins one external message ID while rejecting mutated text through changed trace scope", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const captured: Array<{ key: string; trace: string }> = [];
    const run = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
      captured.push({ key: args.request.envelope.idempotencyKey,
        trace: args.request.envelope.traceId });
      return { committed: true, mealId: 55, recordedItemIds: [501], skipped: [] };
    });
    const service = createFoodD1PublicWhatsAppRegistration({
      readAuthorizedContext: async () => approval,
      readActivePending: async () => false, parseOperation: () => parsed(),
      readMeal: async () => meal() as never,
      run: run as unknown as typeof runFoodD1Migration,
    });
    await service(createInput());
    await service({ ...createInput(), externalMessageId: " wamid.original-004 " });
    await service({ ...createInput(), originalText: "Adicionar ao almoço 99 g de arroz" });
    expect(captured[0].key).toBe(captured[1].key);
    expect(captured[1].trace).toBe(captured[0].trace);
    expect(captured[2].key).toBe(captured[0].key);
    expect(captured[2].trace).not.toBe(captured[0].trace);
    // The real route rejects that changed hash under the same pinned key;
    // this test proves the boundary supplies its discriminant.
  });
  it("reports unresolved siblings explicitly and never commits a zero-ready batch", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const run = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
      args.beforeCommit?.({ items: [{ disposition: "ready" },
        { disposition: "deferred" }], readyCount: 1 } as never);
      return { committed: true, mealId: 55, recordedItemIds: [501],
        skipped: [{ observationId: "pending-sibling" }] };
    });
    const service = createFoodD1PublicWhatsAppRegistration({
      readAuthorizedContext: async () => approval,
      readActivePending: async () => false, parseOperation: () => parsed(),
      readMeal: async () => meal() as never,
      run: run as unknown as typeof runFoodD1Migration,
    });
    const result = await service(createInput());
    expect(result?.data?.skippedItemCount).toBe(1);
    expect(result?.reply).toContain("Item não registrado");
    expect(result?.reply).toContain("Item 1");
    const blocked = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
      args.beforeCommit?.({ items: [{ disposition: "deferred" }],
        readyCount: 0 } as never);
      throw new Error("unexpected-effect");
    });
    const blockedService = createFoodD1PublicWhatsAppRegistration({
      readAuthorizedContext: async () => approval,
      readActivePending: async () => false, parseOperation: () => parsed(),
      run: blocked as unknown as typeof runFoodD1Migration,
    });
    await expect(blockedService(createInput())).rejects
      .toThrow("food-d1-whatsapp-public-needs-clarification");
  });
});
