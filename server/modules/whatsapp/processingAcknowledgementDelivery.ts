import { safeLogDetail } from "../../privacy";
import { recordMetaWhatsAppOutboundUsage } from "../usageGovernance/providerUsage";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import { sendWhatsAppTextMessage } from "./webhookUtils";

/**
 * Único adapter autorizado para acknowledgements de processamento.
 * Acknowledgements não são respostas funcionais e nunca gravam lifecycle.
 */
export async function sendWhatsAppProcessingAcknowledgement(to: string, body: string) {
  const result = await sendWhatsAppTextMessage(to, body);
  const sourceMessageId = getCurrentWhatsappInboundExternalMessageId();
  if (result.ok && sourceMessageId) {
    try {
      await recordMetaWhatsAppOutboundUsage({
        recipientPhone: to,
        sourceMessageId,
        sequenceIndex: -1,
        messageType: "processing_acknowledgement",
        role: "auxiliary",
        usedFallback: false,
      });
    } catch (error) {
      console.error("[WhatsAppUsageMeter]", safeLogDetail({
        event: "processing_ack_usage_persistence_failed",
        errorCode: error instanceof Error ? error.message : "unknown",
      }));
    }
  }
  return result;
}
