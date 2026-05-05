import {
  getAdminSnapshot,
  getAdminWhatsAppTokenStatus,
  logInferenceEvent,
  upsertAdminWhatsAppAccessToken,
} from "../../db";
import { UpdateWhatsappTokenInput } from "./schemas";

export async function getAdminOverview() {
  return getAdminSnapshot();
}

export async function getWhatsappTokenStatus() {
  return getAdminWhatsAppTokenStatus();
}

export async function updateWhatsappToken(userId: number, input: UpdateWhatsappTokenInput) {
  const status = await upsertAdminWhatsAppAccessToken({
    value: input.accessToken,
    updatedByUserId: userId,
  });

  logInferenceEvent({
    userId,
    origin: "admin",
    status: "success",
    eventType: "whatsapp.access_token_updated",
    detail: `Token de acesso do WhatsApp atualizado via painel administrativo com origem ${status.source}.`,
  });

  return status;
}
