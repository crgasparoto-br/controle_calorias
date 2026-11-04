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
import type { LinguisticRequest } from "./linguisticComprehension";
import {
  parseFoodOperationEnvelope,
  type FoodOperationEnvelope,
} from "./schemas";
import type { ConfirmFoodD1WebDraftInput } from "../meals/schemas";
import type { FoodD1Request, FoodD1Result } from "./entrypointMigration";
import type { FoodD1RouteStore } from "./entrypointRouting";
import type {
  FoodD1CommitResult,
} from "./entrypointPersistenceRepository";
import type {
  FoodD1WebDraftPayload,
  FoodD1WebDraftRecord,
} from "./publicWebDraftRepository";
import { saveFoodD1WebDraft } from "./publicWebDraftRepository";

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
    return [buildFoodObservationFixture({
      observationId: `obs-${observations.length}`,
      modality: request.modality,
      rawInput: request.rawText,
      normalizedInput: request.rawText,
      surfaceSpan: {
        sourceRef: request.sourceRef,
        span: { start: 0, end: request.rawText.length },
        region: null,
      },
    })];
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
  const saveDraft = vi.fn(async (draftInput: Parameters<typeof saveFoodD1WebDraft>[0]) => ({
    status: "pending" as const,
    payload: {
      ...draftInput.payload,
      draft: {
        ...draftInput.payload.draft,
        draftId: draftInput.draftId,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    },
  }));
  const transcribe = vi.fn(async () => ({
    task: "transcribe" as const,
    text: "1,5 fatias de mortadela",
    provider: "openai" as const,
    model: "test-transcription",
    execution: { source: "primary" as const, attempts: 1, usedFallback: false },
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
    transcribe,
  });
  return { service, comprehend, buildPlan, saveDraft, transcribe };
}

describe("public Food D1 web draft confirmation", () => {
  it.each([
    ["text", { text: "  1,5 fatias de mortadela  " }, "text", 1],
    ["audio", { audio: { base64: "dGVzdA==", mimeType: "audio/webm" } }, "audio_transcript", 1],
    ["combined", {
      text: "1,5 fatias de mortadela",
      audio: { base64: "dGVzdA==", mimeType: "audio/webm" },
    }, "multimodal", 2],
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
    expect(comprehend).toHaveBeenCalledTimes(expectedItems);
    const stored = saveDraft.mock.calls[0]?.[0];
    expect(stored?.payload.observations.every(observation =>
      observation.rawInput === null && observation.normalizedInput === null)).toBe(true);
    expect(JSON.stringify(stored?.payload)).not.toContain("dGVzdA==");
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
      throw new Error("food-d1-native-web-draft-not-pending");
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
