/** #1308: short-lived, tenant-scoped V2 web review state; no raw evidence is stored. */
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import {
  foodD1WebDraftSchema,
  type FoodD1WebDraft,
} from "../../../shared/foodD1WebDraft";
import { foodD1OperationEffects, foodD1OperationRoutes, foodD1WebDrafts } from "../../../drizzle/food-intelligence-v2-schema";
import { getDb } from "../../db";
import {
  parseFoodOperationEnvelope,
  foodOperationEnvelopeSchema,
  type FoodOperationEnvelope,
} from "./schemas";
import { foodObservationSchema, type FoodObservation } from "./observationSchemas";
import type { FoodD1CommitResult } from "./entrypointPersistenceRepository";

export const FOOD_D1_WEB_DRAFT_TTL_MS = 30 * 60 * 1000;
export const FOOD_D1_WEB_DRAFT_CLEANUP_INTERVAL_MS = 60 * 1000;

const payloadSchema = z.strictObject({
  draft: foodD1WebDraftSchema.omit({ draftId: true, expiresAt: true }),
  envelope: foodOperationEnvelopeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  observations: z.array(foodObservationSchema.refine(
    observation => observation.rawInput === null && observation.normalizedInput === null,
  )).min(1).max(80),
});

const confirmationSchema = foodD1WebDraftSchema.pick({
  draftId: true,
  operationKey: true,
}).extend({
  confirmationHash: z.string().regex(/^[a-f0-9]{64}$/),
  committed: z.boolean(),
  replayed: z.boolean(),
  mealId: z.number().int().positive().nullable(),
  recordedItemIds: z.array(z.number().int().positive()).max(80),
  skipped: z.array(z.object({
    observationId: z.string().min(1).max(200),
    reasonCodes: z.array(z.string().min(1).max(80)).max(20),
  }).strict()).max(80),
}).strict();

export type FoodD1WebDraftPayload = {
  draft: FoodD1WebDraft;
  envelope: FoodOperationEnvelope;
  occurredAt: Date;
  observations: FoodObservation[];
};

export type FoodD1WebDraftRecord =
  | { status: "pending"; payload: FoodD1WebDraftPayload }
  | {
      status: "confirmed";
      draftId: string;
      operationKey: string;
      expiresAt: Date;
      confirmationHash: string;
      result: FoodD1CommitResult;
    };

function isConfirmedDraftRow(row: {
  status: "pending" | "confirmed";
  confirmationJson: string | null;
  payloadJson: string | null;
}): row is typeof row & { status: "confirmed"; confirmationJson: string } {
  return row.status === "confirmed" && row.confirmationJson !== null;
}

function isPendingDraftRow(row: {
  status: "pending" | "confirmed";
  payloadJson: string | null;
  confirmationJson: string | null;
}): row is typeof row & { status: "pending"; payloadJson: string } {
  return row.status === "pending" && row.payloadJson !== null;
}

function parseJson(value: string, errorCode: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(errorCode);
  }
}

function decodePayload(
  payloadJson: string,
  draftId: string,
  operationKey: string,
  expiresAt: Date,
): FoodD1WebDraftPayload {
  const parsed = payloadSchema.safeParse(parseJson(payloadJson, "food-d1-web-draft-corrupt-payload"));
  if (!parsed.success) throw new Error("food-d1-web-draft-corrupt-payload");
  const envelope = parseFoodOperationEnvelope(parsed.data.envelope);
  if (!envelope.ok || envelope.value.idempotencyKey !== operationKey ||
      parsed.data.draft.operationKey !== operationKey ||
      parsed.data.draft.mealLabel !== envelope.value.mealOperation?.targetMeal ||
      getDateKeyInTimeZone(new Date(parsed.data.occurredAt), envelope.value.effectiveTimeZone) !==
        envelope.value.mealOperation?.date ||
      parsed.data.observations.length !== parsed.data.draft.items.length ||
      parsed.data.observations.some((observation, index) =>
        observation.observationId !== parsed.data.draft.items[index]?.observationId ||
        observation.rawInput !== null || observation.normalizedInput !== null) ||
      !Number.isFinite(expiresAt.getTime())) {
    throw new Error("food-d1-web-draft-scope-mismatch");
  }
  const draft = foodD1WebDraftSchema.safeParse({
    ...parsed.data.draft,
    draftId,
    expiresAt: expiresAt.toISOString(),
  });
  if (!draft.success) throw new Error("food-d1-web-draft-corrupt-payload");
  return {
    draft: draft.data,
    envelope: envelope.value,
    occurredAt: new Date(parsed.data.occurredAt),
    observations: parsed.data.observations,
  };
}

function decodeConfirmation(
  confirmationJson: string,
  draftId: string,
  operationKey: string,
  replayed = false,
): { result: FoodD1CommitResult; confirmationHash: string } {
  const parsed = confirmationSchema.safeParse(
    parseJson(confirmationJson, "food-d1-web-draft-corrupt-confirmation"),
  );
  if (!parsed.success || parsed.data.draftId !== draftId ||
      parsed.data.operationKey !== operationKey || !parsed.data.committed) {
    throw new Error("food-d1-web-draft-corrupt-confirmation");
  }
  return {
    confirmationHash: parsed.data.confirmationHash,
    result: {
      committed: parsed.data.committed,
      replayed: replayed || parsed.data.replayed,
      operationKey: parsed.data.operationKey,
      mealId: parsed.data.mealId,
      recordedItemIds: parsed.data.recordedItemIds,
      skipped: parsed.data.skipped,
    },
  };
}

function assertPayloadScope(input: {
  ownerUserId: number;
  operationKey: string;
  payload: Omit<FoodD1WebDraftPayload, "draft"> & { draft: Omit<FoodD1WebDraft, "draftId" | "expiresAt"> };
}): void {
  const parsed = parseFoodOperationEnvelope(input.payload.envelope);
  if (!parsed.ok || parsed.value.ownerUserId !== input.ownerUserId ||
      parsed.value.idempotencyKey !== input.operationKey ||
      parsed.value.mealOperation?.action !== "add" ||
      parsed.value.mealOperation.targetMeal !== input.payload.draft.mealLabel ||
      getDateKeyInTimeZone(input.payload.occurredAt, parsed.value.effectiveTimeZone) !==
        parsed.value.mealOperation.date ||
      input.payload.observations.length !== input.payload.draft.items.length ||
      input.payload.observations.some((observation, index) =>
        observation.observationId !== input.payload.draft.items[index]?.observationId ||
        observation.rawInput !== null || observation.normalizedInput !== null)) {
    throw new Error("food-d1-web-draft-scope-mismatch");
  }
}

/** Reject a racing submission reusing the operation key with different intent. */
function assertMatchingConcurrentWebDraft(
  existing: FoodD1WebDraftPayload,
  incoming: Omit<FoodD1WebDraftPayload, "draft"> & {
    draft: Omit<FoodD1WebDraft, "draftId" | "expiresAt">;
  },
): void {
  const a = existing.envelope, b = incoming.envelope;
  if (existing.draft.operationKey !== incoming.draft.operationKey ||
      existing.draft.entrypoint !== incoming.draft.entrypoint ||
      existing.draft.mealLabel !== incoming.draft.mealLabel ||
      existing.occurredAt.getTime() !== incoming.occurredAt.getTime() ||
      a.ownerUserId !== b.ownerUserId ||
      a.traceId !== b.traceId ||
      a.effectiveTimeZone !== b.effectiveTimeZone ||
      JSON.stringify(a.mealOperation) !== JSON.stringify(b.mealOperation) ||
      (["code", "knowledge", "lexicon", "policy", "resolver"] as const)
        .some(key => a.revisions[key] !== b.revisions[key])) {
    throw new Error("food-d1-public-web-draft-operation-scope-changed");
  }
}

export async function saveFoodD1WebDraft(input: {
  draftId: string;
  ownerUserId: number;
  operationKey: string;
  payload: Omit<FoodD1WebDraftPayload, "draft"> & {
    draft: Omit<FoodD1WebDraft, "draftId" | "expiresAt">;
  };
  now?: Date;
}): Promise<FoodD1WebDraftRecord> {
  const now = input.now ?? new Date();
  if (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0 ||
      !input.draftId.trim() || input.draftId.length > 80 ||
      !input.operationKey.trim() || input.operationKey.length > 200 ||
      !Number.isFinite(now.getTime())) {
    throw new Error("food-d1-web-draft-invalid-input");
  }
  assertPayloadScope(input);
  const expiresAt = new Date(now.getTime() + FOOD_D1_WEB_DRAFT_TTL_MS);
  const payloadJson = JSON.stringify({
    ...input.payload,
    occurredAt: input.payload.occurredAt.toISOString(),
  });
  const db = await getDb();
  if (!db || typeof db.transaction !== "function") {
    throw new Error("food-d1-web-draft-store-unavailable");
  }
  return db.transaction(async tx => {
    // Native writes serialize on the pinned route before creating effects.
    // Lock that SAME row here so a recently committed operation cannot be
    // resurrected after its short-lived review payload is purged.
    const [pinned] = await tx.select({ resolver: foodD1OperationRoutes.resolver })
      .from(foodD1OperationRoutes)
      .where(and(eq(foodD1OperationRoutes.ownerUserId, input.ownerUserId),
        eq(foodD1OperationRoutes.operationKey, input.operationKey)))
      .for("update").limit(1);
    if (!pinned || pinned.resolver !== "v2") {
      throw new Error("food-d1-web-draft-pinned-v2-route-required");
    }
    const [committed] = await tx.select({ observationId: foodD1OperationEffects.observationId })
      .from(foodD1OperationEffects)
      .where(and(eq(foodD1OperationEffects.ownerUserId, input.ownerUserId),
        eq(foodD1OperationEffects.operationKey, input.operationKey))).limit(1);
    if (committed) throw new Error("food-d1-web-draft-operation-already-committed");

    await tx.insert(foodD1WebDrafts).values({
      draftId: input.draftId,
      ownerUserId: input.ownerUserId,
      operationKey: input.operationKey,
      status: "pending",
      payloadJson,
      confirmationJson: null,
      expiresAt,
    }).onDuplicateKeyUpdate({ set: { operationKey: sql.raw("operation_key") } });

    const [existing] = await tx.select().from(foodD1WebDrafts)
      .where(and(eq(foodD1WebDrafts.ownerUserId, input.ownerUserId),
        eq(foodD1WebDrafts.operationKey, input.operationKey)))
      .for("update").limit(1);
    if (!existing) throw new Error("food-d1-web-draft-upsert-failed");
    if (existing.expiresAt.getTime() > now.getTime()) {
      if (isConfirmedDraftRow(existing)) {
        const confirmation = decodeConfirmation(
          existing.confirmationJson, existing.draftId, existing.operationKey, true,
        );
        return {
          status: "confirmed",
          draftId: existing.draftId,
          operationKey: existing.operationKey,
          expiresAt: existing.expiresAt,
          ...confirmation,
        };
      }
      if (isPendingDraftRow(existing)) {
        const stored = decodePayload(existing.payloadJson, existing.draftId,
          existing.operationKey, existing.expiresAt);
        // A second caller may have seen no draft before it was inserted.
        // Return the winning draft only when both callers have the same
        // immutable operation identity. Different provider observations for
        // the same input do not permit a second physical meal.
        assertMatchingConcurrentWebDraft(stored, input.payload);
        return { status: "pending", payload: stored };
      }
      throw new Error("food-d1-web-draft-corrupt-row");
    }

    await tx.delete(foodD1WebDrafts)
      .where(and(eq(foodD1WebDrafts.ownerUserId, input.ownerUserId),
        eq(foodD1WebDrafts.operationKey, input.operationKey)));
    await tx.insert(foodD1WebDrafts).values({
      draftId: input.draftId,
      ownerUserId: input.ownerUserId,
      operationKey: input.operationKey,
      status: "pending",
      payloadJson,
      confirmationJson: null,
      expiresAt,
    });
    const [created] = await tx.select().from(foodD1WebDrafts)
      .where(and(eq(foodD1WebDrafts.ownerUserId, input.ownerUserId),
        eq(foodD1WebDrafts.operationKey, input.operationKey)))
      .for("update").limit(1);
    if (!created || created.status !== "pending" || !created.payloadJson) {
      throw new Error("food-d1-web-draft-create-failed");
    }
    return {
      status: "pending",
      payload: decodePayload(created.payloadJson, created.draftId,
        created.operationKey, created.expiresAt),
    };
  });
}

/** Rehydrate an already pinned operation after restart without re-invoking AI. */
export async function getFoodD1WebDraftByOperationKey(input: {
  ownerUserId: number;
  operationKey: string;
  now?: Date;
}): Promise<FoodD1WebDraftRecord | null> {
  const now = input.now ?? new Date();
  if (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0 ||
      !input.operationKey.trim() || input.operationKey.length > 200 ||
      !Number.isFinite(now.getTime())) {
    throw new Error("food-d1-web-draft-invalid-operation-lookup");
  }
  const db = await getDb();
  if (!db) throw new Error("food-d1-web-draft-store-unavailable");
  const [row] = await db.select().from(foodD1WebDrafts)
    .where(and(eq(foodD1WebDrafts.ownerUserId, input.ownerUserId),
      eq(foodD1WebDrafts.operationKey, input.operationKey))).limit(1);
  if (!row || row.expiresAt.getTime() <= now.getTime()) {
    // A cleaned-up confirmed draft is not a new operation. The irreversible
    // effect receipts outlive the review TTL and must block AI reprocessing.
    const [committed] = await db.select({ observationId: foodD1OperationEffects.observationId })
      .from(foodD1OperationEffects)
      .where(and(eq(foodD1OperationEffects.ownerUserId, input.ownerUserId),
        eq(foodD1OperationEffects.operationKey, input.operationKey))).limit(1);
    if (committed) throw new Error("food-d1-web-draft-operation-already-committed");
    return null;
  }
  if (isPendingDraftRow(row)) {
    return {
      status: "pending",
      payload: decodePayload(row.payloadJson, row.draftId,
        row.operationKey, row.expiresAt),
    };
  }
  if (isConfirmedDraftRow(row)) {
    return {
      status: "confirmed",
      draftId: row.draftId,
      operationKey: row.operationKey,
      expiresAt: row.expiresAt,
      ...decodeConfirmation(row.confirmationJson, row.draftId,
        row.operationKey, true),
    };
  }
  throw new Error("food-d1-web-draft-corrupt-row");
}

export async function getFoodD1WebDraft(input: {
  draftId: string;
  ownerUserId: number;
  now?: Date;
}): Promise<FoodD1WebDraftRecord | null> {
  const now = input.now ?? new Date();
  if (!input.draftId.trim() || !Number.isSafeInteger(input.ownerUserId) ||
      input.ownerUserId <= 0 || !Number.isFinite(now.getTime())) {
    throw new Error("food-d1-web-draft-invalid-lookup");
  }
  const db = await getDb();
  if (!db) throw new Error("food-d1-web-draft-store-unavailable");
  const [row] = await db.select().from(foodD1WebDrafts)
    .where(and(eq(foodD1WebDrafts.draftId, input.draftId),
      eq(foodD1WebDrafts.ownerUserId, input.ownerUserId))).limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(foodD1WebDrafts)
      .where(and(eq(foodD1WebDrafts.draftId, input.draftId),
        eq(foodD1WebDrafts.ownerUserId, input.ownerUserId),
        lte(foodD1WebDrafts.expiresAt, now)));
    return null;
  }
  if (isPendingDraftRow(row)) {
    return {
      status: "pending",
      payload: decodePayload(row.payloadJson, row.draftId, row.operationKey, row.expiresAt),
    };
  }
  if (isConfirmedDraftRow(row)) {
    const confirmation = decodeConfirmation(
      row.confirmationJson, row.draftId, row.operationKey, true,
    );
    return {
      status: "confirmed",
      draftId: row.draftId,
      operationKey: row.operationKey,
      expiresAt: row.expiresAt,
      ...confirmation,
    };
  }
  throw new Error("food-d1-web-draft-corrupt-row");
}

export async function deleteExpiredFoodD1WebDrafts(now = new Date()): Promise<number> {
  if (!Number.isFinite(now.getTime())) throw new Error("food-d1-web-draft-invalid-cleanup-time");
  const db = await getDb();
  if (!db) throw new Error("food-d1-web-draft-store-unavailable");
  const result = await db.delete(foodD1WebDrafts)
    .where(lte(foodD1WebDrafts.expiresAt, now));
  const affectedRows = Number((result as { rowsAffected?: unknown }).rowsAffected ?? 0);
  return Number.isSafeInteger(affectedRows) && affectedRows >= 0 ? affectedRows : 0;
}
