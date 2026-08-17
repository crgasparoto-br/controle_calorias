import { buildWhatsAppCallbackId } from "./interactiveCallback";
import { buttonsReply, listReply, type WhatsAppLogicalReply } from "./replyContract";

export const WHATSAPP_MAX_BUTTON_ACTIONS = 3;
const MAX_BUTTON_TITLE_LENGTH = 20;
const MAX_LIST_ROW_TITLE_LENGTH = 24;

export type WhatsappInteractionAction = {
  id: string;
  label: string;
  effect: string;
  description?: string;
};

export type WhatsappInteractionComponent = "text" | "buttons" | "list";

function truncateTitle(title: string, maxLength: number) {
  return title.length > maxLength ? `${title.slice(0, maxLength - 1)}…` : title;
}

export function selectWhatsappInteractionComponent(
  classification: "open" | "closed",
  totalActionCount: number,
): WhatsappInteractionComponent {
  if (classification === "open") return "text";
  return totalActionCount <= WHATSAPP_MAX_BUTTON_ACTIONS ? "buttons" : "list";
}

export function buildWhatsappClosedDecisionReply(input: {
  bodyText: string;
  pendingOperationId: number;
  actions: WhatsappInteractionAction[];
  listButtonText?: string;
}): WhatsAppLogicalReply {
  const component = selectWhatsappInteractionComponent("closed", input.actions.length);
  if (component === "buttons") {
    return buttonsReply(input.bodyText, input.actions.map(action => ({
      id: buildWhatsAppCallbackId(input.pendingOperationId, action.id),
      title: truncateTitle(action.label, MAX_BUTTON_TITLE_LENGTH),
    })));
  }

  return listReply(input.bodyText, input.listButtonText ?? "Ver opções", [{
    rows: input.actions.map(action => ({
      id: buildWhatsAppCallbackId(input.pendingOperationId, action.id),
      title: truncateTitle(action.label, MAX_LIST_ROW_TITLE_LENGTH),
      ...(action.description ? { description: action.description } : {}),
    })),
  }]);
}

export function buildWhatsappInteractionTelemetry(input: {
  interactionId: string;
  origin: string;
  classification: "open" | "closed";
  actions: readonly WhatsappInteractionAction[];
  lifecycle: "created" | "represented" | "cancelled" | "consumed" | "blocked";
  invalidResponseReason?: string | null;
}) {
  return {
    interactionId: input.interactionId,
    interactionOrigin: input.origin,
    interactionClassification: input.classification,
    interactionComponent: selectWhatsappInteractionComponent(input.classification, input.actions.length),
    interactionActionCount: input.actions.length,
    interactionLifecycle: input.lifecycle,
    invalidResponseReason: input.invalidResponseReason ?? null,
  };
}
