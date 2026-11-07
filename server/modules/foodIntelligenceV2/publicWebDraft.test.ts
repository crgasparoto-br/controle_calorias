import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFoodResolutionDecisionFixture,
  buildFoodObservationFixture,
  buildFoodOperationEnvelopeFixture,
} from "./fixtures";
import {
  createFoodD1PublicWebDraft,
  hashFoodD1WebDraftConfirmation,
} from "./publicWebDraft";
import {
  preserveFoodD1ReviewProvenance,
  foodD1WebCorrectionSourceRef,
} from "./publicWebDraftProvenance";
import type { LinguisticRequest } from "./linguisticComprehension";
import {
  parseFoodOperationEnvelope,
  type FoodOperationEnvelope,
} from "./schemas";
import type { ConfirmFoodD1WebDraftInput, ProcessMealDraftInput } from "../meals/schemas";
import type { FoodD1Request, FoodD1Result } from "./entrypointMigration";
import { FoodD1NativeWebDraftNotPendingError } from "./entrypointPersistenceRepository";
import type { FoodD1RouteStore } from "./entrypointRouting";
import type {
  FoodD1CommitResult,
} from "./entrypointPersistenceRepository";
import type {
  FoodD1WebDraftPayload,
  FoodD1WebDraftRecord,
} from "./publicWebDraftRepository";
import { saveFoodD1WebDraft } from "./publicWebDraftRepository";
import { foodD1WebDraftSchema } from "../../../shared/foodD1WebDraft";
import { traceFoodD1WebSubmission } from "./publicWebDraftIdentity";

const userId = 7;
const timeZone = "America/Sao_Paulo";
const occurredAt = new Date("2026-11-02T15:00:00.000Z");
const auditedSha = "a".repeat(40);
const result: FoodD1CommitResult = {
  committed: true,
  replayed: false,
  operationKey: "d1-web-7:submission-12345678",
  mealId: 55,
  recordedItemIds: [56],
  skipped: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function confirmationRequest(overrides: Partial<ConfirmFoodD1WebDraftInput> = {}): ConfirmFoodD1WebDraftInput {
  return {
    draftId: "draft-1",
    mealLabel: "jantar",
    occurredAt: "2026-11-02T12:00",
    notes: "comi em casa",
    items: [{
      observationId: "obs-1",
      foodName: "mortadela",
      quantity: 1.5,
      unit: "fatia",
    }],
    ...overrides,
  };
}

function buildEnvelope(): FoodOperationEnvelope {
  const parsed = parseFoodOperationEnvelope(buildFoodOperationEnvelopeFixture({
    traceId: "trace-web-draft",
    idempotencyKey: result.operationKey,
    ownerUserId: userId,
    effectiveTimeZone: timeZone,
    mealOperation: { action: "add", targetMeal: "jantar", date: "2026-11-02" },
    revisions: { code: auditedSha },
  }));
  if (!parsed.ok) throw new Error("invalid synthetic operation envelope");
  return parsed.value;
}

function buildPendingRecord(): FoodD1WebDraftRecord {
  const envelope = buildEnvelope();
  const observation = buildFoodObservationFixture({
    observationId: "obs-1",
    modality: "text",
    rawInput: null,
    normalizedInput: null,
  });
  const draft: FoodD1WebDraftPayload["draft"] = {
    resolver: "food-v2",
    draftId: "draft-1",
    operationKey: result.operationKey,
    entrypoint: "text",
    mealLabel: "jantar",
    occurredAt: occurredAt.toISOString(),
    expiresAt: new Date("2026-11-02T15:30:00.000Z").toISOString(),
    items: [{
      observationId: "obs-1",
      foodName: "mortadela",
      quantity: 1.5,
      unit: "fatia",
      disposition: "ready",
      reasonCodes: [],
      nutrition: {
        verified: false,
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
      },
    }],
  };
  return {
    status: "pending",
    payload: {
      draft,
      envelope,
      occurredAt,
      observations: [observation],
    },
  };
}

function createService(
  readDraft: (input: { draftId: string; ownerUserId: number }) => Promise<FoodD1WebDraftRecord | null>,
  run = vi.fn(async () => result),
) {
  return {
    run,
    service: createFoodD1PublicWebDraft({
      readAuthorizedContext: async () => ({
        approval: {
          status: "approved",
          gateAReference: "gate-a:test-approval",
          rolloutReference: "rollout:test-approval",
          auditedBaseSha: auditedSha,
        },
        expectedAuditedBaseSha: auditedSha,
        revisions: buildEnvelope().revisions,
      }),
      readDraft,
      run,
    }),
  };
}

function webDraftDependencies(input: { withApproval?: boolean } = {}) {
  vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
  vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,audio_transcript,multimodal");
  const pinnedRoutes = new Map<string, Awaited<ReturnType<FoodD1RouteStore["readPinnedRoute"]>>>();
  const routeStore: FoodD1RouteStore = {
    readPinnedRoute: async (operationKey, ownerUserId) =>
      pinnedRoutes.get(`${ownerUserId}:${operationKey}`) ?? null,
    bindPinnedRoute: async candidate => {
      pinnedRoutes.set(`${candidate.ownerUserId}:${candidate.operationKey}`, candidate);
      return candidate;
    },
  };
  const observations: string[] = [];
  const comprehend = vi.fn(async (request: LinguisticRequest) => {
    observations.push(request.rawText);
    const item = buildFoodObservationFixture({
      observationId: `obs-${observations.length}`,
      modality: request.modality,
      rawInput: request.rawText,
      normalizedInput: request.rawText,
      ...(request.modality === "image" ? {
        quantityHints: { value: null, unit: null, servingText: null },
      } : {}),
      surfaceSpan: {
        sourceRef: request.sourceRef,
        span: { start: 0, end: request.rawText.length },
        region: null,
      },
    });
    return [{
      ...item,
      evidence: item.evidence.filter(evidence =>
        request.modality !== "image" || !evidence.field.startsWith("quantity."),
      ).map(evidence => ({
        ...evidence,
        origin: request.modality === "audio_transcript" ? "transcription" as const
          : request.modality === "image"
            ? request.imageRegionRole === "caption" ? "vision" as const : "ocr" as const
            : "text" as const,
        anchor: { ...evidence.anchor, sourceRef: request.sourceRef },
      })),
    }];
  });
  const buildPlan = vi.fn(async (request: FoodD1Request) => {
    const items = request.evidence.kind === "structured"
      ? request.evidence.observations.map(observation => ({
          observationId: observation.observationId,
          mealItemId: null,
          decision: buildFoodResolutionDecisionFixture({
            observationIds: [observation.observationId],
            traceId: request.envelope.traceId,
            identity: { canonicalName: observation.identityHints.foodName ?? "mortadela" },
            quantity: {
              value: observation.quantityHints.value ?? 1,
              unit: observation.quantityHints.unit ?? "fatia",
            },
          }),
          disposition: "ready" as const,
          reasonCodes: [],
        }))
      : [];
    return {
      schemaVersion: 2,
      operationKey: request.envelope.idempotencyKey,
      traceId: request.envelope.traceId,
      entrypoint: request.entrypoint,
      committed: false,
      items,
      registeredCount: 0,
      readyCount: items.length,
      skippedCount: 0,
    } satisfies FoodD1Result;
  });
  const persistedDrafts = new Map<string, FoodD1WebDraftRecord>();
  const saveDraft = vi.fn(async (draftInput: Parameters<typeof saveFoodD1WebDraft>[0]) => {
    const record: FoodD1WebDraftRecord = {
      status: "pending",
      payload: {
        ...draftInput.payload,
        draft: {
          ...draftInput.payload.draft,
          draftId: draftInput.draftId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
      },
    };
    persistedDrafts.set(draftInput.operationKey, record);
    return record;
  });
  const readDraftByOperationKey = vi.fn(async (input: { operationKey: string; ownerUserId: number }) =>
    persistedDrafts.get(input.operationKey) ?? null);
  const transcribe = vi.fn(async () => ({
    task: "transcribe" as const,
    text: "1,5 fatias de mortadela",
    provider: "openai" as const,
    model: "test-transcription",
    execution: { source: "primary" as const, attempts: 1, usedFallback: false },
  }));
  const extractVisualSurfaces = vi.fn(async () => ({
    surfaces: ["1,5 fatias de mortadela"],
    contentDigest: "b".repeat(64),
  }));
  const service = createFoodD1PublicWebDraft({
    readAuthorizedContext: async () => input.withApproval === false ? null : ({
      approval: {
        status: "approved",
        gateAReference: "gate-a:test-approval",
        rolloutReference: "rollout:test-approval",
        auditedBaseSha: auditedSha,
      },
      expectedAuditedBaseSha: auditedSha,
      revisions: { ...buildEnvelope().revisions, code: auditedSha },
    }),
    lexicon: { load: async () => [] },
    knowledge: {
      readLocal: async () => ({ kind: "miss", reason: "not_found" }),
      readPendingEvidence: async () => null,
      stagePendingEvidence: async () => { throw new Error("draft generation must not stage evidence"); },
    },
    comprehend,
    buildPlan,
    routeStore,
    saveDraft,
    readDraftByOperationKey,
    transcribe,
    extractVisualSurfaces,
  });
  return { service, comprehend, buildPlan, saveDraft, readDraftByOperationKey, transcribe, extractVisualSurfaces, routeStore };
}

describe("public Food D1 web draft confirmation", () => {
  it.each([
    ["text", { text: "  1,5 fatias de mortadela  " }, "text", 1],
    ["audio", { audio: { base64: "dGVzdA==", mimeType: "audio/webm" } }, "audio_transcript", 1],
    ["combined", {
      text: "1,5 fatias de mortadela",
      audio: { base64: "dGVzdA==", mimeType: "audio/webm" },
    }, "multimodal", 1],
  ] as const)("creates a short-lived %s review without retaining raw inputs", async (_name, media, entrypoint, expectedItems) => {
    const { service, comprehend, buildPlan, saveDraft, transcribe } = webDraftDependencies();
    const draft = await service.tryRunFoodD1PublicWebDraft({
      userId,
      timeZone,
      request: {
        source: "web",
        d1OperationId: "submission-12345678",
        mealLabel: "jantar",
        occurredAt: "2026-11-02T12:00",
        ...media,
      },
    });

    expect(draft?.entrypoint).toBe(entrypoint);
    expect(draft?.items).toHaveLength(expectedItems);
    expect(buildPlan).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(entrypoint === "text" ? 0 : 1);
    expect(comprehend).toHaveBeenCalledTimes(entrypoint === "multimodal" ? 2 : expectedItems);
    const stored = saveDraft.mock.calls[0]?.[0];
    if (entrypoint === "multimodal") {
      expect(stored?.payload.observations[0]?.modality).toBe("multimodal");
      expect(new Set(stored?.payload.observations[0]?.evidence.map(item => item.origin)))
        .toEqual(new Set(["text", "transcription"]));
    }
    expect(stored?.payload.observations.every(observation =>
      observation.rawInput === null && observation.normalizedInput === null)).toBe(true);
    expect(JSON.stringify(stored?.payload)).not.toContain("dGVzdA==");
  });

  it.each([
    ["plate_image", "vision"],
    ["packaging", "ocr"],
  ] as const)("routes a genuine %s image to the canonical V2 draft with %s provenance", async (imageKind, origin) => {
    const { service, buildPlan, saveDraft, extractVisualSurfaces } = webDraftDependencies();
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,audio_transcript,multimodal,plate_image,packaging");
    const draft = await service.tryRunFoodD1PublicWebDraft({
      userId, timeZone,
      request: {
        source: "web", d1OperationId: "visual-sample-12345678",
        mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
        image: { base64: "fixture-image", mimeType: "image/jpeg" }, imageKind,
      },
    });
    expect(draft?.entrypoint).toBe(imageKind);
    expect(draft?.items).toHaveLength(1);
    expect(foodD1WebDraftSchema.safeParse(draft).success).toBe(true);
    expect(extractVisualSurfaces).toHaveBeenCalledWith(expect.objectContaining({ kind: imageKind }));
    expect(buildPlan).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    const obs = saveDraft.mock.calls[0]?.[0]?.payload.observations[0];
    expect(obs?.modality).toBe("image");
    expect(obs?.evidence.some(item => item.origin === origin)).toBe(true);
    expect(obs?.surfaceSpan.sourceRef).toBe(`d1-image:${"b".repeat(64)}:0`);
    expect(obs?.rawInput).toBeNull();
    expect(JSON.stringify(saveDraft.mock.calls[0]?.[0]?.payload))
      .not.toContain("fixture-image");
  });

  it("disallows a standalone label or continuation masquerading as a new-meal draft", async () => {
    const { service } = webDraftDependencies();
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image,packaging");
    const draft = await service.tryRunFoodD1PublicWebDraft({
      userId, timeZone,
      request: {
        source: "web", d1OperationId: "plain-photo-sample",
        mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
        image: { base64: "fixture-image", mimeType: "image/png" },
        imageKind: "plate_image",
      },
    });
    expect(foodD1WebDraftSchema.safeParse({ ...draft, entrypoint: "nutrition_label" }).success)
      .toBe(false);
    expect(foodD1WebDraftSchema.safeParse({ ...draft, entrypoint: "continuation" }).success)
      .toBe(false);
  });

  it("coalesces independent image and text evidence before a single meal draft", async () => {
    const { service, saveDraft, buildPlan } = webDraftDependencies();
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,audio_transcript,multimodal,plate_image");
    const draft = await service.tryRunFoodD1PublicWebDraft({
      userId, timeZone,
      request: {
        source: "web", d1OperationId: "mixed-visual-sample",
        mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
        text: "1,5 fatias de mortadela",
        image: { base64: "fixture-image", mimeType: "image/jpeg" },
        imageKind: "plate_image",
      },
    });
    expect(draft?.entrypoint).toBe("multimodal");
    expect(draft?.items).toHaveLength(1);
    const stored = saveDraft.mock.calls[0]?.[0]?.payload.observations;
    expect(stored).toHaveLength(1);
    expect(stored?.[0]?.modality).toBe("multimodal");
    expect(new Set(stored?.[0]?.evidence.map(item => item.origin)))
      .toEqual(new Set(["text", "vision"]));
    expect(buildPlan).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed visual role under the same pinned multimodal operation", async () => {
    const { service, buildPlan, saveDraft } = webDraftDependencies();
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,multimodal,plate_image,packaging");
    const base: ProcessMealDraftInput = {
      source: "web", d1OperationId: "role-pinned-123456",
      mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
      text: "1,5 fatias de mortadela",
      image: { base64: "fixture-image", mimeType: "image/jpeg" },
      imageKind: "plate_image",
    };
    await expect(service.tryRunFoodD1PublicWebDraft({ userId, timeZone, request: base }))
      .resolves.toMatchObject({ entrypoint: "multimodal" });
    await expect(service.tryRunFoodD1PublicWebDraft({
      userId, timeZone, request: { ...base, imageKind: "packaging" },
    })).rejects.toThrow("food-d1-public-web-draft-operation-scope-changed");
    expect(buildPlan).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it("never runs visual extraction when the approval is missing or label lacks an existing item", async () => {
    const { service, extractVisualSurfaces, buildPlan } = webDraftDependencies({ withApproval: false });
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image,packaging,nutrition_label,multimodal");
    const base = {
      source: "web" as const, d1OperationId: "image-not-approved",
      mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
      image: { base64: "fixture-image", mimeType: "image/jpeg" },
    };
    await expect(service.tryRunFoodD1PublicWebDraft({
      userId, timeZone, request: { ...base, imageKind: "plate_image" },
    })).rejects.toThrow("food-d1-public-web-draft-gate-unavailable");
    await expect(service.tryRunFoodD1PublicWebDraft({
      userId, timeZone, request: { ...base, imageKind: "nutrition_label" },
    })).rejects.toThrow("food-d1-public-web-image-role-required");
    expect(extractVisualSurfaces).not.toHaveBeenCalled();
    expect(buildPlan).not.toHaveBeenCalled();
  });

  it.each(["audio", "image"] as const)(
    "recovers a pinned %s draft without rerunning provider or resolver", async kind => {
      const { service, transcribe, extractVisualSurfaces, buildPlan, saveDraft } = webDraftDependencies();
      vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,audio_transcript,multimodal,plate_image,packaging");
      const request: ProcessMealDraftInput = {
        source: "web", d1OperationId: "restart-safe-draft",
        mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
        ...(kind === "audio"
          ? { audio: { base64: "ZGF0YQ==", mimeType: "audio/webm" } }
          : { image: { base64: "fixture-image", mimeType: "image/jpeg" }, imageKind: "plate_image" }),
      };
      const first = await service.tryRunFoodD1PublicWebDraft({ userId, timeZone, request });
      const replay = await service.tryRunFoodD1PublicWebDraft({ userId, timeZone, request });
      expect(replay).toEqual(first);
      expect(buildPlan).toHaveBeenCalledTimes(1);
      expect(saveDraft).toHaveBeenCalledTimes(1);
      expect(transcribe).toHaveBeenCalledTimes(kind === "audio" ? 1 : 0);
      expect(extractVisualSurfaces).toHaveBeenCalledTimes(kind === "image" ? 1 : 0);

      const swapped = kind === "audio"
        ? { ...request, audio: { ...request.audio!, base64: "b3RoZXI=" } }
        : { ...request, image: { ...request.image!, base64: "other-image" } };
      await expect(service.tryRunFoodD1PublicWebDraft({
        userId, timeZone, request: swapped,
      })).rejects.toThrow("food-d1-public-web-draft-operation-scope-changed");
      expect(buildPlan).toHaveBeenCalledTimes(1);
    });

  it("rejects a change to the exact meal timestamp on a pinned retry", async () => {
    const { service, transcribe } = webDraftDependencies();
    const request: ProcessMealDraftInput = {
      source: "web", d1OperationId: "same-day-new-time",
      mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
      audio: { base64: "ZGF0YQ==", mimeType: "audio/webm" },
    };
    await service.tryRunFoodD1PublicWebDraft({ userId, timeZone, request });
    await expect(service.tryRunFoodD1PublicWebDraft({
      userId, timeZone,
      request: { ...request, occurredAt: "2026-11-02T13:00" },
    })).rejects.toThrow("food-d1-public-web-draft-operation-scope-changed");
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("fingerprints raw voice bytes, visual role and typed text, not a model transcript", () => {
    const base: ProcessMealDraftInput = {
      source: "web", d1OperationId: "fingerprint-12345678",
      mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
      text: "1 fatia de queijo",
      audio: { base64: "ZGF0YQ==", mimeType: "audio/webm" },
      image: { base64: "opaque-image", mimeType: "image/jpeg" },
      imageKind: "plate_image",
    };
    const sign = (request: ProcessMealDraftInput) =>
      traceFoodD1WebSubmission({ request, operationKey: "d1-web-7:fingerprint-12345678", entrypoint: "multimodal" });
    expect(sign(base)).toBe(sign({ ...base }));
    expect(sign(base)).not.toBe(sign({ ...base, imageKind: "packaging" }));
    expect(sign(base)).not.toBe(sign({ ...base, text: "2 fatias de queijo" }));
    expect(sign(base)).not.toBe(sign({ ...base, audio: { ...base.audio!, base64: "b3RoZXI=" } }));
  });

  it("pauses a V2-pinned web submission on rollback before V1 inference", async () => {
    const { service, buildPlan, saveDraft, routeStore } = webDraftDependencies();
    const request: ProcessMealDraftInput = {
      source: "web", d1OperationId: "rollback-submission",
      mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
      text: "1,5 fatias de mortadela",
    };
    await service.tryRunFoodD1PublicWebDraft({ userId, timeZone, request });
    expect(await routeStore.readPinnedRoute(
      `d1-web-${userId}:rollback-submission`, userId,
    )).toMatchObject({ resolver: "v2", originEntrypoint: "text" });

    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    await expect(service.tryRunFoodD1PublicWebDraft({
      userId, timeZone, request,
    })).rejects.toThrow("food-d1-operation-paused-by-rollback");
    expect(buildPlan).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledTimes(1);

    // A new, unrelated legacy submission remains on the ordinary V1 path.
    await expect(service.tryRunFoodD1PublicWebDraft({
      userId, timeZone,
      request: { ...request, d1OperationId: "another-submission" },
    })).resolves.toBeNull();
  });

  it("refuses switching a V2-pinned web operation to image or audio", async () => {
    const { service, buildPlan } = webDraftDependencies();
    const original: ProcessMealDraftInput = {
      source: "web", d1OperationId: "modality-submission",
      mealLabel: "jantar", occurredAt: "2026-11-02T12:00",
      text: "1,5 fatias de mortadela",
    };
    await service.tryRunFoodD1PublicWebDraft({ userId, timeZone, request: original });
    for (const conflicting of [
      { ...original, text: undefined, audio: { base64: "dGVzdA==", mimeType: "audio/webm" } },
      { ...original, text: undefined, image: { base64: "dGVzdA==", mimeType: "image/jpeg" } },
    ]) {
      await expect(service.tryRunFoodD1PublicWebDraft({
        userId, timeZone, request: conflicting,
      })).rejects.toThrow("food-d1-entrypoint-changed-during-operation");
    }
    expect(buildPlan).toHaveBeenCalledTimes(1);
  });

  it("fails closed before transcription or persistence when approval is unavailable", async () => {
    const { service, comprehend, saveDraft, transcribe } = webDraftDependencies({
      withApproval: false,
    });

    await expect(service.tryRunFoodD1PublicWebDraft({
      userId,
      timeZone,
      request: {
        source: "web",
        d1OperationId: "submission-12345678",
        mealLabel: "jantar",
        occurredAt: "2026-11-02T12:00",
        audio: { base64: "dGVzdA==", mimeType: "audio/webm" },
      },
    })).rejects.toThrow("food-d1-public-web-draft-gate-unavailable");
    expect(transcribe).not.toHaveBeenCalled();
    expect(comprehend).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("rejects changed time or timezone on pending review before any D1 resolver/write", async () => {
    const readDraft = vi.fn(async () => buildPendingRecord());
    const { run, service } = createService(readDraft);
    const request = confirmationRequest();
    await expect(service.confirmFoodD1PublicWebDraft({
      userId, request, timeZone,
      occurredAt: new Date("2026-11-02T16:00:00.000Z"),
    })).rejects.toThrow("food-d1-public-web-draft-operation-scope-changed");
    await expect(service.confirmFoodD1PublicWebDraft({
      userId, request, timeZone: "UTC", occurredAt,
    })).rejects.toThrow("food-d1-public-web-draft-operation-scope-changed");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a corrupted stored draft timestamp even with the original user timestamp", async () => {
    const corrupted = buildPendingRecord();
    if (corrupted.status !== "pending") throw new Error("invalid test fixture");
    corrupted.payload.draft.occurredAt = new Date("2026-11-02T16:00:00.000Z").toISOString();
    const { run, service } = createService(vi.fn(async () => corrupted));
    await expect(service.confirmFoodD1PublicWebDraft({
      userId, request: confirmationRequest(), timeZone, occurredAt,
    })).rejects.toThrow("food-d1-public-web-draft-operation-scope-changed");
    expect(run).not.toHaveBeenCalled();
  });

  it("binds idempotent retries to the exact confirmed review", async () => {
    const request = confirmationRequest();
    const confirmationHash = hashFoodD1WebDraftConfirmation({
      userId, timeZone, occurredAt, request,
    });
    const confirmed: FoodD1WebDraftRecord = {
      status: "confirmed",
      draftId: request.draftId,
      operationKey: result.operationKey,
      expiresAt: new Date("2026-11-02T15:30:00.000Z"),
      confirmationHash,
      result: { ...result, replayed: true },
    };
    const readDraft = vi.fn(async () => confirmed);
    const { run, service } = createService(readDraft);

    await expect(service.confirmFoodD1PublicWebDraft({
      userId, request, timeZone, occurredAt,
    })).resolves.toEqual({ ...result, replayed: true });
    await expect(service.confirmFoodD1PublicWebDraft({
      userId,
      request: { ...request, notes: "observação alterada" },
      timeZone,
      occurredAt,
    })).rejects.toThrow("food-d1-web-draft-confirmation-conflict");
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the persisted receipt when concurrent identical confirmations race", async () => {
    const request = confirmationRequest();
    const confirmationHash = hashFoodD1WebDraftConfirmation({
      userId, timeZone, occurredAt, request,
    });
    const pending = buildPendingRecord();
    const confirmed: FoodD1WebDraftRecord = {
      status: "confirmed",
      draftId: request.draftId,
      operationKey: result.operationKey,
      expiresAt: new Date("2026-11-02T15:30:00.000Z"),
      confirmationHash,
      result: { ...result, replayed: true },
    };
    const readDraft = vi.fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(confirmed);
    const run = vi.fn(async () => {
      throw new FoodD1NativeWebDraftNotPendingError();
    });
    const { service } = createService(readDraft, run);

    await expect(service.confirmFoodD1PublicWebDraft({
      userId, request, timeZone, occurredAt,
    })).resolves.toEqual({ ...result, replayed: true });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      draftConfirmationHash: confirmationHash,
    }));
    expect(readDraft).toHaveBeenCalledTimes(2);
  });

  it("bounds correction source refs independently of long operation and observation IDs", () => {
    const a = foodD1WebCorrectionSourceRef("o".repeat(190), "x".repeat(200));
    const b = foodD1WebCorrectionSourceRef("o".repeat(190), "y".repeat(200));
    expect(a).toMatch(/^d1-review:[a-f0-9]{64}$/u);
    expect(a.length).toBeLessThan(145);
    expect(a).not.toBe(b);
    expect(foodD1WebCorrectionSourceRef("o".repeat(190), "x".repeat(200))).toBe(a);
  });

  it("preserves original audio and vision provenance after explicit text correction", () => {
    const corrected = buildFoodObservationFixture({
      observationId: "obs-1", modality: "text",
      identityHints: { foodName: "mortadela corrigida" },
    });
    const original = buildFoodObservationFixture({
      observationId: "obs-1", modality: "multimodal", rawInput: null, normalizedInput: null,
      evidence: [{
        evidenceId: "ev-photo", field: "identity.foodName",
        origin: "vision", verified: false, value: "mortadela",
        unit: null, confidence: null, sourceId: null,
        anchor: { sourceRef: "image:1", span: null, region: null },
      }, {
        evidenceId: "ev-audio", field: "identity.foodName",
        origin: "transcription", verified: false, value: "mortadela",
        unit: null, confidence: null, sourceId: null,
        anchor: { sourceRef: "audio:1", span: null, region: null },
      }],
    });
    const resolved = preserveFoodD1ReviewProvenance(corrected, original);
    expect(resolved.modality).toBe("multimodal");
    expect(resolved.identityHints.foodName).toBe("mortadela corrigida");
    expect(new Set(resolved.evidence.map(item => item.origin)))
      .toEqual(new Set(["text", "vision", "transcription"]));
    expect(new Set(resolved.evidence.map(item => item.anchor.sourceRef)))
      .toEqual(new Set(["turn:1:text", "image:1", "audio:1"]));
    expect(new Set(resolved.evidence.map(item => item.evidenceId)).size)
      .toBe(resolved.evidence.length);
  });

  it("rejects changing a unit without supplying its quantity", async () => {
    const readDraft = vi.fn(async () => buildPendingRecord());
    const { run, service } = createService(readDraft);

    await expect(service.confirmFoodD1PublicWebDraft({
      userId,
      request: confirmationRequest({
        items: [{
          observationId: "obs-1",
          foodName: "mortadela",
          quantity: null,
          unit: "g",
        }],
      }),
      timeZone,
      occurredAt,
    })).rejects.toThrow("food-d1-public-web-draft-quantity-required-for-unit-change");
    expect(run).not.toHaveBeenCalled();
  });
});
