import { sendWhatsAppTextMessage } from "./webhookUtils";

/**
 * Único adapter autorizado para acknowledgements de processamento.
 * Acknowledgements não são respostas funcionais e nunca gravam lifecycle.
 */
export async function sendWhatsAppProcessingAcknowledgement(to: string, body: string) {
  return sendWhatsAppTextMessage(to, body);
}
