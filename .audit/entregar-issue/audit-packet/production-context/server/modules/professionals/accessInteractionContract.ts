import type { WhatsappInteractionAction } from "../whatsapp/interactionPresentation";

export const PROFESSIONAL_ACCESS_AUTHORIZE_ACTION = "authorize";
export const PROFESSIONAL_ACCESS_REJECT_ACTION = "reject";

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
  ];
}
