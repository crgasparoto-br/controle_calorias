import { afterEach, describe, expect, it, vi } from "vitest";
import { foodD1WebDraftSchema, type FoodD1WebDraft } from "../../../shared/foodD1WebDraft";
import { createFoodD1PublicPhotoAnalysis } from "./publicPhotoRoute";
import type { tryRunFoodD1PublicWebDraft } from "./publicWebDraft";

const image = { base64: "cGljdHVyZQ==", mimeType: "image/jpeg" };
const original = {
  userId: 7, readTimeZone: vi.fn(async () => "America/Sao_Paulo"),
  input: {
    image, imageKind: "plate_image" as const,
    d1OperationId: "submission-00001234",
    mealLabel: "almoço", occurredAt: "2026-11-04T12:00",
  },
};
const draft: FoodD1WebDraft = {
  resolver: "food-v2", draftId: "draft-physical",
  operationKey: "d1-web-7:submission-00001234",
  entrypoint: "plate_image", mealLabel: "almoço",
  occurredAt: "2026-11-04T15:00:00.000Z",
  expiresAt: "2026-11-04T15:30:00.000Z",
  items: [{
    observationId: "obs-1", foodName: "Arroz", quantity: 100, unit: "g",
    disposition: "ready", reasonCodes: [],
    nutrition: {
      verified: true, calories: 130, protein: 3, carbs: 28, fat: 1,
    },
  }],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("#1308 existing foodPhotoAnalysis.analyze public V2 bridge", () => {
  it("leaves the legacy photo route intact while no rollout nor D1 operation is supplied", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    const run = vi.fn(async () => draft);
    const readTimeZone = vi.fn(async () => "UTC");
    const result = await createFoodD1PublicPhotoAnalysis(run)({
      ...original, input: { image }, readTimeZone,
    });
    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(readTimeZone).not.toHaveBeenCalled();
  });

  it.each(["plate_image", "packaging"] as const)(
    "routes selected %s into the same durable V2 web review without new meal inference",
    async kind => {
      vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
      vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", kind);
      const run = vi.fn(async (_request: Parameters<typeof tryRunFoodD1PublicWebDraft>[0]) => ({
        ...draft, entrypoint: kind,
      }));
      const service = createFoodD1PublicPhotoAnalysis(run);
      const first = await service({ ...original, input: { ...original.input, imageKind: kind } });
      const second = await service({ ...original, input: { ...original.input, imageKind: kind } });
      expect(foodD1WebDraftSchema.safeParse(first).success).toBe(true);
      expect(second?.draftId).toBe(first?.draftId);
      expect(run).toHaveBeenCalledTimes(2);
      const [request] = run.mock.calls[0];
      expect(request).toMatchObject({
        userId: 7, timeZone: "America/Sao_Paulo",
        request: {
          source: "web", image, imageKind: kind,
          d1OperationId: "submission-00001234",
          mealLabel: "almoço", occurredAt: "2026-11-04T12:00",
        },
      });
      expect(run.mock.calls[1][0].request.d1OperationId)
        .toBe(request.request.d1OperationId);
    },
  );

  it("blocks missing image role, wrong rollout and incomplete operation before calling V2", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image");
    const run = vi.fn(async () => draft);
    const service = createFoodD1PublicPhotoAnalysis(run);
    await expect(service({ ...original, input: {
      ...original.input, imageKind: undefined,
    } })).rejects.toThrow("food-d1-public-photo-explicit-kind-required");
    await expect(service({ ...original, input: {
      ...original.input, imageKind: "packaging",
    } })).rejects.toThrow("food-d1-public-photo-explicit-kind-required");
    await expect(service({ ...original, input: {
      ...original.input, d1OperationId: undefined,
    } })).rejects.toThrow("food-d1-public-photo-operation-required");
    await expect(service({ ...original, input: {
      ...original.input, occurredAt: undefined,
    } })).rejects.toThrow("food-d1-public-photo-operation-required");
    expect(run).not.toHaveBeenCalled();
  });

  it("denies label-as-new-meal even with all flags OFF and does not read timezone or provider", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    const run = vi.fn(async () => draft);
    const readTimeZone = vi.fn(async () => "UTC");
    await expect(createFoodD1PublicPhotoAnalysis(run)({
      ...original, readTimeZone,
      input: { ...original.input, imageKind: "nutrition_label" },
    })).rejects.toThrow("food-d1-new-meal-label-requires-existing-item");
    expect(run).not.toHaveBeenCalled();
    expect(readTimeZone).not.toHaveBeenCalled();
  });

  it("keeps the original operation guard alive under rollback, never falling through to V1", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    const run = vi.fn(async () => {
      throw new Error("food-d1-operation-paused-by-rollback");
    });
    await expect(createFoodD1PublicPhotoAnalysis(
      run as unknown as typeof tryRunFoodD1PublicWebDraft,
    )(original)).rejects.toThrow("food-d1-operation-paused-by-rollback");
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not run the V1 photo route after V2 returns no or mismatched draft", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image");
    const empty = createFoodD1PublicPhotoAnalysis(vi.fn(async () => null));
    await expect(empty(original)).rejects.toThrow("food-d1-public-photo-draft-unavailable");
    const mismatched = createFoodD1PublicPhotoAnalysis(vi.fn(async () => ({
      ...draft, entrypoint: "packaging" as const,
    })));
    await expect(mismatched(original)).rejects.toThrow("food-d1-public-photo-draft-unavailable");
  });
});
