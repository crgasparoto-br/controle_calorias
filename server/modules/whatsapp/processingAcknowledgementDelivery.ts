import { safeLogDetail } from "../../privacy";
import {
  claimMetaWhatsAppOutboundUsageDispatch,
  finalizeMetaWhatsAppOutboundUsage,
  prepareMetaWhatsAppOutboundUsage,
  type MetaWhatsAppUsageReservation,
} from "../usageGovernance/providerUsage";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import { sendWhatsAppTextMessage, type WhatsAppProviderSendResult } from "./webhookUtils";

/**
 * Único adapter autorizado para acknowledgements de processamento.
 * Acknowledgements não são respostas funcionais e nunca gravam lifecycle.
 */
export async function sendWhatsAppProcessingAcknowledgement(to: string, body: string) {
  const sourceMessageId = getCurrentWhatsappInboundExternalMessageId();
  if (!sourceMessageId) return sendWhatsAppTextMessage(to, body);

  let reservation: MetaWhatsAppUsageReservation;
  try {
    const prepared = await prepareMetaWhatsAppOutboundUsage({
      recipientPhone: to,
      sourceMessageId,
      sequenceIndex: -1,
      messageType: "processing_acknowledgement",
      role: "auxiliary",
    });
    if (prepared.prepared === false) {
      console.error("[WhatsAppUsageMeter]", safeLogDetail({
        event: "processing_ack_usage_preparation_blocked",
        reason: prepared.reason,
      }));
      return {
        ok: false,
        detail: "Medição de consumo indisponível; acknowledgement não enviado para evitar efeito externo sem trilha auditável.",
      };
    }
    reservation = prepared;

    const claim = await claimMetaWhatsAppOutboundUsageDispatch(prepared);
    if (!claim.claimed) {
      if (claim.state === "success") {
        return { ok: true, detail: "Acknowledgement já concluído; chamada à Meta não repetida." };
      }
      return {
        ok: false,
        detail: "Acknowledgement anterior possui medição pendente ou terminal; chamada à Meta não repetida.",
      };
    }
  } catch (error) {
    console.error("[WhatsAppUsageMeter]", safeLogDetail({
      event: "processing_ack_usage_preparation_failed",
      errorCode: error instanceof Error ? error.message : "unknown",
    }));
    return {
      ok: false,
      detail: "Medição de consumo indisponível; acknowledgement não enviado para evitar efeito externo sem trilha auditável.",
    };
  }

  const result: WhatsAppProviderSendResult = await sendWhatsAppTextMessage(to, body);
  try {
    await finalizeMetaWhatsAppOutboundUsage({
      reservation,
      messageType: "processing_acknowledgement",
      role: "auxiliary",
      usedFallback: false,
      effectiveOk: result.ok,
      providerStatus: result.status,
      providerStatusText: result.statusText,
    });
  } catch (error) {
    // `provider_dispatch_started` remains durable and blocks duplicate provider
    // calls while the uncertain outcome is reconciled.
    console.error("[WhatsAppUsageMeter]", safeLogDetail({
      event: "processing_ack_usage_finalization_pending",
      errorCode: error instanceof Error ? error.message : "unknown",
    }));
  }
  return result;
}
