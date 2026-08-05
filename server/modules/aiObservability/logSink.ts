import { logInferenceEvent } from "../../db";
import {
  serializeAiInferenceEvent,
  setAiObservabilitySink,
  type AiInferenceEvent,
} from "../../_core/ai/observability";

function logOrigin(event: AiInferenceEvent): "web" | "whatsapp" | "admin" {
  if (event.origin === "whatsapp") return "whatsapp";
  if (event.origin === "admin") return "admin";
  return "web";
}

function logStatus(event: AiInferenceEvent): "success" | "warning" | "error" {
  if (event.outcome === "success") return "success";
  if (event.outcome === "invalid_configuration" || event.outcome === "safety_block") {
    return "error";
  }
  return "warning";
}

/**
 * Reuses the canonical inference log pipeline. The detail is a bounded,
 * schema-versioned JSON event containing only normalized metadata.
 */
export function configureAiObservabilityLogging(): void {
  setAiObservabilitySink(event => {
    logInferenceEvent({
      origin: logOrigin(event),
      status: logStatus(event),
      eventType: "ai.inference_call",
      detail: serializeAiInferenceEvent(event),
    });
  });
}
