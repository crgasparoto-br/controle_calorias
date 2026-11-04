/** Stable, media-aware identity for #1308 web draft retries. No model output enters this hash. */
import { createHash } from "node:crypto";
import type { FoodD1WebDraft } from "../../../shared/foodD1WebDraft";
import type { ProcessMealDraftInput } from "../meals/schemas";
import type { FoodD1WebDraftRecord } from "./publicWebDraftRepository";
import type { FoodOperationEnvelope } from "./schemas";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Hash raw submitted source, including its declared MIME and visual role. */
export function traceFoodD1WebSubmission(input: {
  operationKey: string;
  entrypoint: FoodD1WebDraft["entrypoint"];
  request: ProcessMealDraftInput;
}): string {
  const { request } = input;
  return "d1-trace-" + digest(JSON.stringify({
    operationKey: input.operationKey,
    entrypoint: input.entrypoint,
    text: request.text === undefined ? null : digest(request.text),
    audio: request.audio ? {
      mime: request.audio.mimeType,
      digest: digest(request.audio.base64),
    } : null,
    image: request.image ? {
      role: request.imageKind ?? null,
      mime: request.image.mimeType,
      digest: digest(request.image.base64),
    } : null,
  }));
}

/**
 * Durable replay: validate the immutable request, owner, exact timestamp and
 * pinned revisions against the stored draft. Do not re-transcribe/re-vision.
 */
export function checkedFoodD1WebReplay(input: {
  record: FoodD1WebDraftRecord;
  operationKey: string;
  traceId: string;
  entrypoint: FoodD1WebDraft["entrypoint"];
  ownerUserId: number;
  mealLabel: string;
  occurredAt: Date;
  timeZone: string;
  revisions: FoodOperationEnvelope["revisions"];
}): FoodD1WebDraft {
  if (input.record.status === "confirmed") {
    throw new Error("food-d1-web-draft-operation-already-confirmed");
  }
  const { draft, envelope, occurredAt } = input.record.payload;
  const versions = envelope.revisions;
  if (draft.resolver !== "food-v2" ||
      draft.operationKey !== input.operationKey ||
      draft.entrypoint !== input.entrypoint ||
      draft.mealLabel !== input.mealLabel ||
      envelope.idempotencyKey !== input.operationKey ||
      envelope.ownerUserId !== input.ownerUserId ||
      envelope.traceId !== input.traceId ||
      envelope.effectiveTimeZone !== input.timeZone ||
      occurredAt.getTime() !== input.occurredAt.getTime() ||
      (["code", "knowledge", "lexicon", "policy", "resolver"] as const)
        .some(key => versions[key] !== input.revisions[key])) {
    throw new Error("food-d1-public-web-draft-operation-scope-changed");
  }
  return draft;
}
