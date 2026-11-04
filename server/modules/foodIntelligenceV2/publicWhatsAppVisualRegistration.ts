/** #1308: image surfaces from a verified transport -> one native WhatsApp D1 runner.
 * The caption provides an explicit visual purpose and meal destination only.
 * It is NEVER proof of the image contents, product identity or nutrition.
 */
import { createHash } from "node:crypto";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type { WhatsappIntentResult } from "../whatsapp/intent/types";
import { comprehendFoodLanguage, type LinguisticRequest } from "./linguisticComprehension";
import { extractD1VisualSurfaces, type FoodD1VisualKind } from "./publicVisualSurfaces";
import { coalesceEquivalentMultimodalEvidence } from "./multimodalEvidence";
import { isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested } from "./entrypointRouting";
import type { FoodObservation, FoodOperationEnvelope } from "./schemas";
import type { FoodD1Dependencies, FoodD1Request } from "./entrypointMigration";
import type { runFoodD1Migration } from "./entrypointRunner";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import type { FoodD1CommitResult } from "./entrypointPersistenceRepository";

/** Command syntax is a user declaration of a ROLE, not a food classifier.
 * A free caption, OCR, inferred role or nutrition label never grants one.
 */
const mealDestinations = {
  almoco: "almoço", jantar: "jantar", lanche: "lanche", ceia: "ceia",
  cafe: "café da manhã",
} as const;
export function parseExplicitD1WhatsAppVisualIntent(caption: string | null | undefined) {
  if (!caption || caption.length > 600) return null;
  const match = /^(#prato|#embalagem)\s+@(almoco|jantar|lanche|ceia|cafe)(?:\n([^]*))?$/u.exec(caption);
  if (!match) return null;
  const text = match[3]?.trim();
  if (text && text.length > 400) return null;
  return {
    kind: match[1] === "#prato" ? "plate_image" as const : "packaging" as const,
    mealLabel: mealDestinations[match[2] as keyof typeof mealDestinations],
    description: text || null,
  };
}

/** A WhatsApp Media API download is already normalized to a data URL.
 * Derive the actual MIME from the trusted normalized bytes, never the caption.
 */
export function fromTrustedD1WhatsAppMediaDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl);
  if (!match) throw new Error("food-d1-whatsapp-visual-normalized-media-required");
  return { base64: match[2], mimeType: match[1] };
}

/** Used before decoding image media so V1 remains untouched when flags are OFF. */
export function isAnyD1WhatsAppVisualEntrypointSelected(): boolean {
  return (["plate_image", "packaging", "multimodal"] as const)
    .some(isFoodD1EntrypointCutoverRequested);
}

export type PublicD1WhatsAppVisualInput = {
  userId: number;
  externalMessageId: string | null;
  /** Normalized image from the trusted WhatsApp Media API, not a user URL. */
  image: { base64: string; mimeType: string };
  caption: string | null | undefined;
  transcript?: string | null;
  receivedAt: Date;
  timeZone: string;
};

export type PublicD1WhatsAppVisualDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  readActivePending: (ownerUserId: number, now: Date) => Promise<boolean>;
  extract: typeof extractD1VisualSurfaces;
  comprehend: typeof comprehendFoodLanguage;
  lexicon: FoodD1Dependencies["lexicon"];
  knowledge: FoodD1Dependencies["knowledge"];
  run: typeof runFoodD1Migration;
  renderCommittedMeal: (input: {
    userId: number; mealId: number; registeredAt: Date; timeZone: string;
    skipped: FoodD1CommitResult["skipped"];
    recordedItemIds: readonly number[];
  }) => Promise<string>;
};

export function createFoodD1PublicWhatsAppVisualRegistration(
  deps: PublicD1WhatsAppVisualDependencies,
) {
  return async (input: PublicD1WhatsAppVisualInput): Promise<WhatsappIntentResult | null> => {
    // An unknown role is NOT permission to run legacy if any visual D1 mode
    // was selected. The channel must ask the user to declare a new operation.
    const selected = isAnyD1WhatsAppVisualEntrypointSelected();
    if (!selected) return null;
    const selectedRole = parseExplicitD1WhatsAppVisualIntent(input.caption);
    if (!selectedRole ||
        !isFoodD1EntrypointCutoverRequested(selectedRole.kind) ||
        (input.transcript?.trim() && !isFoodD1EntrypointCutoverRequested("multimodal"))) {
      throw new Error("food-d1-whatsapp-visual-explicit-role-required");
    }
    const entrypoint = selectedRole.description || input.transcript?.trim()
      ? "multimodal" as const : selectedRole.kind;
    if (entrypoint === "multimodal" &&
        !isFoodD1EntrypointCutoverRequested(entrypoint)) {
      throw new Error("food-d1-whatsapp-visual-multimodal-not-enabled");
    }
    // Gate A is checked before any provider or DB call.
    const context = await deps.readAuthorizedContext();
    if (!context || !isCurrentFoodD1GateApproval(
      context.approval, context.expectedAuditedBaseSha,
    ) || context.revisions.code !== context.expectedAuditedBaseSha) {
      throw new Error("food-d1-whatsapp-visual-gate-unavailable");
    }
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0 ||
        !input.externalMessageId?.trim() || input.externalMessageId.length > 200 ||
        !input.image?.base64 || !input.image?.mimeType ||
        !(input.receivedAt instanceof Date) || !Number.isFinite(input.receivedAt.getTime()) ||
        !input.timeZone?.trim()) {
      throw new Error("food-d1-whatsapp-visual-stable-input-required");
    }
    let pending: boolean;
    try { pending = await deps.readActivePending(input.userId, new Date()); }
    catch { throw new Error("food-d1-whatsapp-visual-pending-state-unavailable"); }
    if (pending) throw new Error("food-d1-whatsapp-visual-legacy-pending-active");

    const stableMessageId = input.externalMessageId.trim();
    const digest = createHash("sha256").update(JSON.stringify([
      input.userId, stableMessageId,
    ])).digest("hex");
    const key = "d1-whatsapp-" + digest;
    const visual = await deps.extract({ image: input.image, kind: selectedRole.kind });
    if (!visual || !/^[a-f0-9]{64}$/u.test(visual.contentDigest) ||
        !Array.isArray(visual.surfaces) || !visual.surfaces.length ||
        visual.surfaces.length > 30 || visual.surfaces.some(surface =>
          typeof surface !== "string" || !surface.trim() || surface.length > 240)) {
      throw new Error("food-d1-whatsapp-visual-evidence-invalid");
    }
    const traceDigest = createHash("sha256").update(JSON.stringify([
      input.userId, stableMessageId, selectedRole, visual.contentDigest, input.transcript ?? null,
    ])).digest("hex");
    const unavailable = {
      status: "unavailable" as const,
      reason: "whatsapp_d1_visual_context_not_materialized", sourceRef: null,
    };
    const envelope: FoodOperationEnvelope = {
      schemaVersion: 2, traceId: "d1-trace-" + traceDigest,
      idempotencyKey: key, ownerUserId: input.userId,
      conversationRef: null, turnRef: null,
      effectiveTimeZone: input.timeZone,
      mealOperation: {
        action: "add", targetMeal: selectedRole.mealLabel,
        date: getDateKeyInTimeZone(input.receivedAt, input.timeZone),
      },
      contextSources: {
        previousMessage: { ...unavailable },
        preferences: { ...unavailable }, recentHistory: { ...unavailable },
      },
      revisions: { ...context.revisions },
    };
    const now = new Date();
    const parse = async (rawText: string, sourceRef: string,
      modality: LinguisticRequest["modality"],
      imageRegionRole?: LinguisticRequest["imageRegionRole"]) =>
      deps.comprehend({
        rawText, sourceRef, modality,
        ...(imageRegionRole ? { imageRegionRole } : {}),
        ownerUserId: input.userId, lexiconRevision: context.revisions.lexicon,
        locale: "pt-BR", now,
      }, deps.lexicon);
    const imageObservations: FoodObservation[] = [];
    for (const [i, surface] of visual.surfaces.entries()) {
      imageObservations.push(...await parse(
        surface, `d1-image:${visual.contentDigest}:${i}`, "image",
        selectedRole.kind === "plate_image" ? "caption" : "front_identity",
      ));
    }
    const textObservations = selectedRole.description
      ? await parse(selectedRole.description, key + ":caption", "text") : [];
    const audioObservations = input.transcript?.trim()
      ? await parse(input.transcript, key + ":audio", "audio_transcript") : [];
    let observations: FoodObservation[] = [...imageObservations];
    if (entrypoint === "multimodal") {
      const companion = textObservations.length && audioObservations.length
        ? coalesceEquivalentMultimodalEvidence(textObservations, audioObservations)
        : [...textObservations, ...audioObservations];
      observations = coalesceEquivalentMultimodalEvidence(companion, imageObservations);
    }
    if (!observations.length || observations.length > 80) {
      throw new Error("food-d1-whatsapp-visual-no-observations");
    }
    const evidence = { kind: "structured" as const, observations };
    const request: FoodD1Request = {
      authenticatedUserId: input.userId, entrypoint, envelope,
      evidence, now: input.receivedAt,
    };
    const response = await deps.run({
      request, source: "whatsapp", occurredAt: input.receivedAt,
      dependencies: {
        lexicon: deps.lexicon, knowledge: deps.knowledge,
        authorizeEvidence: async candidate => candidate.ownerUserId === input.userId &&
          candidate.entrypoint === entrypoint && candidate.evidence === evidence,
        authorizeExistingItem: async () => false,
      },
      legacy: async () => {
        throw new Error("food-d1-whatsapp-visual-cannot-replay-v1");
      },
      expectedAuditedBaseSha: context.expectedAuditedBaseSha,
      verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
      beforeCommit: plan => {
        if (plan.items.length !== observations.length ||
            plan.readyCount !== observations.length ||
            plan.items.some(item => item.disposition !== "ready")) {
          throw new Error("food-d1-whatsapp-visual-needs-clarification");
        }
      },
    });
    if (!response || typeof response !== "object" ||
        !("committed" in response) || response.committed !== true ||
        !("mealId" in response) || typeof response.mealId !== "number" ||
        !("recordedItemIds" in response) ||
        !Array.isArray(response.recordedItemIds) ||
        response.recordedItemIds.length !== observations.length ||
        new Set(response.recordedItemIds).size !== observations.length ||
        !("skipped" in response) || !Array.isArray(response.skipped) ||
        response.skipped.length !== 0) {
      throw new Error("food-d1-whatsapp-visual-commit-incomplete");
    }
    const receipt = response as FoodD1CommitResult;
    const reply = await deps.renderCommittedMeal({
      userId: input.userId, mealId: receipt.mealId!,
      registeredAt: input.receivedAt, timeZone: input.timeZone,
      skipped: receipt.skipped, recordedItemIds: receipt.recordedItemIds,
    });
    if (!reply?.trim()) throw new Error("food-d1-whatsapp-visual-readback-unavailable");
    return {
      handled: true, action: "meal_item_added", reply,
      eventType: "whatsapp.meal_intent_decision.v2_visual_registered",
      detail: "Foto confirmada por evidências V2 e recibo transacional WhatsApp.",
      data: {
        mealId: receipt.mealId!, resolverVersion: "v2",
        skippedItemCount: 0, originalTextPreserved: true,
      },
    };
  };
}
