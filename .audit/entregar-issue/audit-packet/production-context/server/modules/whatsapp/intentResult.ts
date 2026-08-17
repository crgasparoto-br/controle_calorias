export type WhatsAppIntentLogStatus = "success" | "warning";

const WARNING_INTENT_ACTIONS = new Set(["clarification_needed"]);

export function getWhatsAppIntentLogStatus(action: string): WhatsAppIntentLogStatus {
  return WARNING_INTENT_ACTIONS.has(action) ? "warning" : "success";
}
