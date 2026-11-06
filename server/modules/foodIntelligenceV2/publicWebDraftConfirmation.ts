
/** #1308 D1: owner-scoped, fail-closed web review and native V2 commit. */
import { createHash } from "node:crypto";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type { ConfirmFoodD1WebDraftInput } from "../meals/schemas";
import { createFoodV2KnowledgeRepository } from "./repository";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";
import { comprehendFoodLanguage } from "./linguisticComprehension";
import { isCurrentFoodD1GateApproval } from "./entrypointRouting";
import { runFoodD1Migration } from "./entrypointRunner";
import {
  FoodD1NeedsClarificationError,
  type FoodD1Result,
  type FoodD1Request,
} from "./entrypointMigration";
import type { FoodObservation } from "./schemas";
import {
  getFoodD1WebDraft,
  isConfirmedFoodD1WebDraft,
  type FoodD1WebDraftRecord,
} from "./publicWebDraftRepository";
import {
  FoodD1NativeWebDraftNotPendingError,
  type FoodD1CommitResult,
} from "./entrypointPersistenceRepository";
import { buildDependencies } from "./publicWebDraftSupport";
import { foodD1WebCorrectionSourceRef, preserveFoodD1ReviewProvenance } from "./publicWebDraftProvenance";
import type { PublicD1WebDraftDependencies } from "./publicWebDraft";
import {
  FOOD_QUANTITY_UNIT_EVIDENCE_FIELD,
  FOOD_TEXT_INPUT_TYPE,
} from "./contracts";

export class FoodD1WebDraftNotFoundError extends Error {
  constructor() {
    super("Rascunho V2 não encontrado ou expirado.");
    this.name = "FoodD1WebDraftNotFoundError";
  }
}

export function hashFoodD1WebDraftConfirmation(input: {
  userId: number;
  timeZone: string;
  occurredAt: Date;
  request: ConfirmFoodD1WebDraftInput;
}): string {
  return createHash("sha256").update(JSON.stringify({
    userId: input.userId,
    timeZone: input.timeZone,
    draftId: input.request.draftId,
    mealLabel: input.request.mealLabel,
    occurredAt: input.occurredAt.toISOString(),
    notes: input.request.notes?.trim() || null,
    items: [...input.request.items]
      .sort((left, right) => left.observationId.localeCompare(right.observationId))
      .map(({ observationId, foodName, quantity, unit }) => ({
        observationId, foodName, quantity, unit,
      })),
  })).digest("hex");
}

function sameReviewItem(
  current: { name: string; quantity: number | null; unit: string | null },
  original: { name: string; quantity: number | null; unit: string | null },
): boolean {
  return current.name === original.name &&
    current.quantity === original.quantity &&
    current.unit === original.unit;
}

function assertReviewMeasurement(
  current: { quantity: number | null; unit: string | null },
  originalUnit: string | null,
): void {
  if (current.quantity !== null && !current.unit) {
    throw new Error("food-d1-public-web-draft-quantity-unit-required");
  }
  if (current.quantity === null && current.unit !== originalUnit) {
    throw new Error("food-d1-public-web-draft-quantity-required-for-unit-change");
  }
}

export function createFoodD1PublicWebDraftConfirmation(deps: PublicD1WebDraftDependencies) {
  const comprehend = deps.comprehend ?? comprehendFoodLanguage;
  return async function confirmPublicWebDraft(input: {
    userId: number;
    request: ConfirmFoodD1WebDraftInput;
    timeZone: string;
    occurredAt: Date;
  }): Promise<FoodD1CommitResult> {
    const confirmationHash = hashFoodD1WebDraftConfirmation(input);
    const record = await (deps.readDraft ?? getFoodD1WebDraft)({
      draftId: input.request.draftId,
      ownerUserId: input.userId,
    });
    if (!record) throw new FoodD1WebDraftNotFoundError();
    if (isConfirmedFoodD1WebDraft(record)) {
      if (record.confirmationHash !== confirmationHash) {
        throw new Error("food-d1-web-draft-confirmation-conflict");
      }
      return record.result;
    }
    const { draft, envelope, observations, occurredAt: pinnedOccurredAt } = record.payload;
    // The review and its authorized operation are anchored to the original
    // instant/timezone, not merely the same civil day. A changed hour or
    // timezone would silently move the committed meal on a reused draft ID.
    if (draft.mealLabel !== input.request.mealLabel ||
        input.timeZone !== envelope.effectiveTimeZone ||
        input.occurredAt.getTime() !== pinnedOccurredAt.getTime() ||
        draft.occurredAt !== pinnedOccurredAt.toISOString() ||
        getDateKeyInTimeZone(input.occurredAt, envelope.effectiveTimeZone) !==
          envelope.mealOperation?.date) {
      throw new Error("food-d1-public-web-draft-operation-scope-changed");
    }
    if (input.request.items.length !== draft.items.length) {
      throw new Error("food-d1-public-web-draft-item-set-changed");
    }
    const originalById = new Map(draft.items.map(item => [item.observationId, item]));
    const observationById = new Map(observations.map(item => [item.observationId, item]));
    const submittedIds = new Set<string>();
    const lexicon = deps.lexicon ?? governedLinguisticLexiconStore;
    const resolvedObservations: FoodObservation[] = [];
    for (const item of input.request.items) {
      const original = originalById.get(item.observationId);
      const originalObservation = observationById.get(item.observationId);
      if (!original || !originalObservation || submittedIds.has(item.observationId)) {
        throw new Error("food-d1-public-web-draft-item-scope-mismatch");
      }
      submittedIds.add(item.observationId);
      const unchanged = sameReviewItem(
        { name: item.foodName, quantity: item.quantity, unit: item.unit },
        { name: original.foodName, quantity: original.quantity, unit: original.unit },
      );
      if (unchanged) {
        resolvedObservations.push(originalObservation);
        continue;
      }
      assertReviewMeasurement(item, original.unit);
      const quantitySurface = item.quantity === null
        ? ""
        : `${item.quantity} ${item.unit} de `;
      const surface = `${quantitySurface}${item.foodName}`.trim();
      const corrected = await comprehend({
        rawText: surface,
        sourceRef: foodD1WebCorrectionSourceRef(draft.operationKey, item.observationId),
        modality: FOOD_TEXT_INPUT_TYPE,
        ownerUserId: input.userId,
        lexiconRevision: envelope.revisions.lexicon,
        locale: "pt-BR",
        now: new Date(),
      }, lexicon);
      if (corrected.length !== 1) {
        throw new Error("food-d1-public-web-draft-correction-ambiguous");
      }
      let correctedObservation = {
        ...corrected[0],
        observationId: item.observationId,
      };
      if (item.quantity === null && item.unit !== null) {
        correctedObservation.quantityHints = {
          ...correctedObservation.quantityHints,
          unit: item.unit,
        };
        correctedObservation.evidence = [
          ...correctedObservation.evidence.filter(item =>
            item.field !== FOOD_QUANTITY_UNIT_EVIDENCE_FIELD),
          ...originalObservation.evidence.filter(item =>
            item.field === FOOD_QUANTITY_UNIT_EVIDENCE_FIELD),
        ];
      }
      // Corrections arrive as text but must not erase the original
      // transcription or image. The server-owned draft supplies provenance.
      correctedObservation = preserveFoodD1ReviewProvenance(
        correctedObservation, originalObservation,
      );
      resolvedObservations.push(correctedObservation);
    }
    if (submittedIds.size !== draft.items.length) {
      throw new Error("food-d1-public-web-draft-item-set-changed");
    }
    const context = await deps.readAuthorizedContext();
    if (!context || !isCurrentFoodD1GateApproval(
      context.approval, context.expectedAuditedBaseSha,
    ) || context.revisions.code !== context.expectedAuditedBaseSha) {
      throw new Error("food-d1-public-web-draft-gate-unavailable");
    }
    const evidence = { kind: "structured" as const, observations: resolvedObservations };
    const request: FoodD1Request = {
      authenticatedUserId: input.userId,
      entrypoint: draft.entrypoint,
      envelope,
      evidence,
      now: new Date(),
    };
    let result: FoodD1CommitResult | FoodD1Result | null;
    try {
      result = await (deps.run ?? runFoodD1Migration)({
        request,
        source: "web",
        occurredAt: input.occurredAt,
        notes: input.request.notes,
        draftId: input.request.draftId,
        draftConfirmationHash: confirmationHash,
        dependencies: buildDependencies({
          userId: input.userId,
          entrypoint: draft.entrypoint,
          evidence,
          lexicon,
          knowledge: deps.knowledge ?? createFoodV2KnowledgeRepository(),
        }),
        legacy: async () => {
          throw new Error("food-d1-public-web-draft-cannot-replay-v1");
        },
        expectedAuditedBaseSha: context.expectedAuditedBaseSha,
        verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
        beforeCommit: plan => {
          if (plan.items.length !== draft.items.length ||
              plan.items.some(item => item.disposition !== "ready")) {
            throw new FoodD1NeedsClarificationError(
              "food-d1-public-web-draft-needs-clarification",
            );
          }
        },
      });
    } catch (error) {
      if (!(error instanceof FoodD1NativeWebDraftNotPendingError)) throw error;
      const latest = await (deps.readDraft ?? getFoodD1WebDraft)({
        draftId: input.request.draftId,
        ownerUserId: input.userId,
      });
      if (isConfirmedFoodD1WebDraft(latest) &&
          latest.confirmationHash === confirmationHash) {
        return latest.result;
      }
      if (isConfirmedFoodD1WebDraft(latest)) {
        throw new Error("food-d1-web-draft-confirmation-conflict");
      }
      throw error;
    }
    if (!result || typeof result !== "object" || !("committed" in result) ||
        result.committed !== true || !("recordedItemIds" in result)) {
      throw new Error("food-d1-public-web-draft-commit-unavailable");
    }
    return result;
  }


}
