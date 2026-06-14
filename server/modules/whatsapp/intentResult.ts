export type WhatsAppIntentLogStatus = "success" | "warning";

const WARNING_INTENT_ACTIONS = new Set([
  "clarification_needed",
  "record_adjustment_confirmation_needed",
  "record_adjustment_selection_needed",
  "record_adjustment_clarification_needed",
]);

export function getWhatsAppIntentLogStatus(action: string): WhatsAppIntentLogStatus {
  return WARNING_INTENT_ACTIONS.has(action) ? "warning" : "success";
}
