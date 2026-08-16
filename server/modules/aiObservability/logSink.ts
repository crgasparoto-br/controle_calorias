import { logInferenceEvent } from "../../db";
import {
  serializeAiInferenceEvent,
  setAiObservabilitySink,
  type AiInferenceEvent,
} from "../../_core/ai/observability";
import { recordAiEconomicUsage } from "../usageGovernance/service";

function logOrigin(event: AiInferenceEvent): "web" | "whatsapp" | "admin" {
  if (event.origin === "whatsapp") return "whatsapp";
  if (event.origin === "web") return "web";
  return "admin";
}

function logStatus(event: AiInferenceEvent): "success" | "warning" | "error" {
  if (event.outcome === "success") return "success";
  if (event.outcome === "invalid_configuration" || event.outcome === "safety_block") return "error";
  return "warning";
}

function attributedUserId(event: AiInferenceEvent) {
  const value = event.correlation?.userId;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Operational logs and the durable economic ledger intentionally remain
 * separate. Both consume the same sanitized/versioned inference event, so no
 * prompt, response, media or raw conversation identifier is copied for usage
 * measurement. Economic persistence is best-effort for product availability;
 * failures stay observable through a bounded warning and never create a
 * retroactive charge.
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
    try {
      await recordAiEconomicUsage(event);
    } catch (error) {
      console.warn("[Usage governance] Economic usage persistence failed", {
        capability: event.capability,
        origin: event.origin,
        outcome: event.outcome,
        errorType: error instanceof Error ? error.name : "unknown",
      });
    }
  });
}
