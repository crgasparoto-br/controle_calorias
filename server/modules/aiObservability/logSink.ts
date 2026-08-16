import { logInferenceEvent } from "../../db";
import {
  serializeAiInferenceEvent,
  setAiObservabilitySink,
  type AiInferenceEvent,
} from "../../_core/ai/observability";

function logOrigin(event: AiInferenceEvent): "web" | "whatsapp" | "admin" {
  if (event.origin === "whatsapp") return "whatsapp";
  if (event.origin === "web") return "web";
  return "admin";
}

function logStatus(event: AiInferenceEvent): "success" | "warning" | "error" {
  if (event.outcome === "success") return "success";
  if (event.outcome === "invalid_configuration" || event.outcome === "safety_block") {
    return "error";
  }
  return "warning";
}

function attributedUserId(event: AiInferenceEvent) {
  const value = event.correlation?.userId;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/**
 * Reuses the canonical inference log pipeline. The detail is a bounded,
 * schema-versioned JSON event containing only normalized metadata. When the
 * caller supplied a safe internal user attribution, it is also stored in the
 * indexed inferenceLogs.userId column for economic aggregation and retention.
 */
export function configureAiObservabilityLogging(): void {
  setAiObservabilitySink(async event => {
    await logInferenceEvent({
      userId: attributedUserId(event),
      origin: logOrigin(event),
      status: logStatus(event),
      eventType: "ai.inference_call",
      detail: serializeAiInferenceEvent(event),
    });
  });
}
