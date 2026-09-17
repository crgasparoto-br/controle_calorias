import type { Response } from "express";

export const WHATSAPP_WEBHOOK_OUTCOME_HEADER = "x-whatsapp-processing-outcome";

export type WhatsAppWebhookOutcome =
  | "meal_registered"
  | "duplicate_ignored"
  | "clarification_pending"
  | "handled_without_meal";

/**
 * Exposes only a fixed, non-content outcome for operational smoke correlation.
 * Never pass provider, food, phone, message, URL, or error data through this header.
 */
export function setWhatsAppWebhookOutcome(
  response: Response,
  outcome: WhatsAppWebhookOutcome
) {
  if (typeof response.setHeader === "function") {
    response.setHeader(WHATSAPP_WEBHOOK_OUTCOME_HEADER, outcome);
  }
}
