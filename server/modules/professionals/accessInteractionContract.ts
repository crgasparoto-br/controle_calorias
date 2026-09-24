import type { WhatsappInteractionAction } from "../whatsapp/interactionPresentation";

export const PROFESSIONAL_ACCESS_AUTHORIZE_ACTION = "authorize";
export const PROFESSIONAL_ACCESS_REJECT_ACTION = "reject";
export const PROFESSIONAL_ACCESS_CANCEL_ACTION = "cancel";

export function buildProfessionalAccessActions(): WhatsappInteractionAction[] {
  return [
    {
      id: PROFESSIONAL_ACCESS_AUTHORIZE_ACTION,
      label: "Autorizar",
      effect: "grant_access",
    },
    {
      id: PROFESSIONAL_ACCESS_REJECT_ACTION,
      label: "Recusar",
      effect: "reject_access",
    },
    {
      id: PROFESSIONAL_ACCESS_CANCEL_ACTION,
      label: "Cancelar",
      effect: "cancel_without_persistence",
    },
  ];
}
