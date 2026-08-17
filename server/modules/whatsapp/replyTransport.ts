/**
 * Transporte central da resposta lógica do WhatsApp (issue #781, epic #779;
 * fallback textual central ampliado na issue #859).
 *
 * Único ponto que converte o contrato (`replyContract.ts`) em chamadas às
 * funções de envio da Cloud API concentradas em `webhookUtils.ts`, envia a
 * sequência na ordem definida e integra com o `messageLifecycle` para gravar
 * a resposta funcional exatamente uma vez por ação lógica.
 *
 * Fallback (issue #859): quando o envio original de `buttons` ou `list`
 * falha (rejeição da Meta, rede, configuração ou validação local com
 * conteúdo suficiente), o transporte deriva um fallback textual da mesma
 * `WhatsAppOutboundMessage` (via `buildWhatsAppOutboundFallbackText`) e tenta
 * enviá-lo uma única vez, na mesma posição física da sequência. A mesma
 * política cobre `buttons`, `list` e `cta_url`.
 * Handlers não enviam fallback diretamente e não montam versões paralelas.
 */
import { safeLogDetail } from "../../privacy";
import { recordMetaWhatsAppOutboundUsage } from "../usageGovernance/providerUsage";
import {
  sendWhatsAppImageBufferMessage,
  sendWhatsAppImageMessage,
  sendWhatsAppInteractiveButtonsMessage,
  sendWhatsAppInteractiveListMessage,
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppTextMessage,
  type WhatsAppProviderSendResult,
} from "./webhookUtils";
import {
  buildWhatsAppOutboundFallbackText,
  resolveWhatsAppLogicalReplyRecordText,
  validateWhatsAppOutboundMessage,
  type WhatsAppLogicalReply,
  type WhatsAppOutboundMessage,
} from "./replyContract";
import type { MessageLifecycleHandle } from "./messageLifecycle";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";

export type WhatsAppOutboundRole = "primary" | "auxiliary";
export type WhatsAppOutboundFailureCategory = "validation" | "config" | "network" | "provider" | "none";

export type WhatsAppOutboundSendResult = {
  message: WhatsAppOutboundMessage;
  role: WhatsAppOutboundRole;
  originalOk: boolean;
  usedFallback: boolean;
  fallbackOk?: boolean;
  effectiveOk: boolean;
  category: WhatsAppOutboundFailureCategory;
  sequenceDecision: "continue" | "stop" | "complete";
  providerStatus?: number;
  providerStatusText?: string;
  traceId?: string;
  ok: boolean;
  detail: string;
};

export type WhatsAppLogicalReplySendResult = {
  ok: boolean;
  primaryOk: boolean;
  primaryEffectiveOk: boolean;
  sends: WhatsAppOutboundSendResult[];
  recorded: boolean;
};

const URL_IN_DETAIL_PATTERN = /https?:\/\/[^\s)\]}]+/gi;

function sanitizeTransportDetail(detail: string) {
  return safeLogDetail(detail.replace(URL_IN_DETAIL_PATTERN, "[url_redacted]"));
}

function classifyFailure(detail: string): WhatsAppOutboundFailureCategory {
  if (/credenciais|configura/i.test(detail)) return "config";
  if (/validação do contrato/i.test(detail)) return "validation";
  if (/Meta retornou/i.test(detail)) return "provider";
  return "network";
}

async function sendRawOutboundMessage(to: string, message: WhatsAppOutboundMessage): Promise<WhatsAppProviderSendResult> {
  switch (message.type) {
    case "text":
      return sendWhatsAppTextMessage(to, message.body);
    case "cta_url":
      return sendWhatsAppInteractiveUrlButtonMessage(to, message.bodyText, message.buttonText, message.url);
    case "buttons":
      return sendWhatsAppInteractiveButtonsMessage(to, message.bodyText, message.buttons);
    case "list":
      return sendWhatsAppInteractiveListMessage(to, message.bodyText, message.buttonText, message.sections);
    case "image_url":
      return sendWhatsAppImageMessage(to, message.url, message.caption);
    case "image_buffer":
      return sendWhatsAppImageBufferMessage(
        to,
        { buffer: message.buffer, mimeType: message.mimeType, fileName: message.fileName },
        message.caption,
      );
  }
}

function buildSendResult(input: {
  message: WhatsAppOutboundMessage;
  role: WhatsAppOutboundRole;
  origin?: string;
  category: WhatsAppOutboundFailureCategory;
  originalOk: boolean;
  usedFallback: boolean;
  fallbackOk?: boolean;
  effectiveOk: boolean;
  detail: string;
  providerStatus?: number;
  providerStatusText?: string;
  traceId?: string;
}): Omit<WhatsAppOutboundSendResult, "sequenceDecision"> {
  const detail = sanitizeTransportDetail(input.detail);
  return {
    message: input.message,
    role: input.role,
    originalOk: input.originalOk,
    usedFallback: input.usedFallback,
    fallbackOk: input.fallbackOk,
    effectiveOk: input.effectiveOk,
    category: input.category,
    providerStatus: input.providerStatus,
    providerStatusText: input.providerStatusText,
    traceId: input.traceId,
    ok: input.effectiveOk,
    detail,
  };
}

async function sendOutboundMessageWithFallback(
  to: string,
  message: WhatsAppOutboundMessage,
  role: WhatsAppOutboundRole,
  origin?: string,
  traceId?: string,
): Promise<Omit<WhatsAppOutboundSendResult, "sequenceDecision">> {
  const validationErrors = validateWhatsAppOutboundMessage(message);
  const localValidationFailed = validationErrors.length > 0;
  const original: WhatsAppProviderSendResult = localValidationFailed
    ? { ok: false, detail: `Mensagem rejeitada por validação do contrato: ${validationErrors.map(error => error.detail).join(" ")}` }
    : await sendRawOutboundMessage(to, message);

  if (original.ok) {
    return buildSendResult({
      message,
      role,
      origin,
      category: "none",
      originalOk: true,
      usedFallback: false,
      effectiveOk: true,
      detail: original.detail,
      providerStatus: original.status,
      providerStatusText: original.statusText,
      traceId,
    });
  }

  const category = original.failureCategory ?? classifyFailure(original.detail);
  const fallbackText = buildWhatsAppOutboundFallbackText(message);
  if (!fallbackText) {
    return buildSendResult({
      message,
      role,
      origin,
      category,
      originalOk: false,
      usedFallback: false,
      effectiveOk: false,
      detail: original.detail,
      providerStatus: original.status,
      providerStatusText: original.statusText,
      traceId,
    });
  }

  const fallback = await sendWhatsAppTextMessage(to, fallbackText);
  const detail = fallback.ok
    ? `Envio original falhou (${original.detail}); fallback textual entregue com sucesso.`
    : `Envio original falhou (${original.detail}); fallback textual também falhou (${fallback.detail}).`;
  return buildSendResult({
    message,
    role,
    origin,
    category,
    originalOk: false,
    usedFallback: true,
    fallbackOk: fallback.ok,
    effectiveOk: fallback.ok,
    detail,
    providerStatus: original.status,
    providerStatusText: original.statusText,
    traceId,
  });
}

export type WhatsAppLogicalReplyLifecycleInput = {
  handle: MessageLifecycleHandle;
  userId: number;
};

export async function sendWhatsAppLogicalReply(
  to: string,
  reply: WhatsAppLogicalReply,
  lifecycle?: WhatsAppLogicalReplyLifecycleInput,
  options?: { origin?: string; traceId?: string },
): Promise<WhatsAppLogicalReplySendResult> {
  const sends: WhatsAppOutboundSendResult[] = [];
  const traceId = options?.traceId ?? getCurrentWhatsappInboundExternalMessageId() ?? undefined;
  const stableSourceMessageId = traceId
    ?? (lifecycle?.handle ? `lifecycle:${lifecycle.handle.messageId}` : undefined);

  for (let index = 0; index < reply.messages.length; index++) {
    const role: WhatsAppOutboundRole = index === 0 ? "primary" : "auxiliary";
    const baseResult = await sendOutboundMessageWithFallback(to, reply.messages[index], role, options?.origin, traceId);

    if (baseResult.effectiveOk && stableSourceMessageId) {
      try {
        await recordMetaWhatsAppOutboundUsage({
          userId: lifecycle?.userId,
          recipientPhone: to,
          sourceMessageId: stableSourceMessageId,
          sequenceIndex: index,
          messageType: baseResult.usedFallback ? "text_fallback" : reply.messages[index].type,
          role,
          usedFallback: baseResult.usedFallback,
        });
      } catch (error) {
        console.error("[WhatsAppUsageMeter]", safeLogDetail({
          event: "provider_usage_persistence_failed",
          messageType: reply.messages[index].type,
          role,
          traceId,
          errorCode: error instanceof Error ? error.message : "unknown",
        }));
      }
    }

    const sequenceDecision = role === "primary" && !baseResult.effectiveOk
      ? "stop"
      : index === reply.messages.length - 1
        ? "complete"
        : "continue";
    const result: WhatsAppOutboundSendResult = { ...baseResult, sequenceDecision };
    sends.push(result);
    console.info("[WhatsAppReplyTransport]", safeLogDetail({
      type: result.message.type,
      role,
      origin: options?.origin,
      category: result.category,
      originalOk: result.originalOk,
      usedFallback: result.usedFallback,
      fallbackOk: result.fallbackOk,
      effectiveOk: result.effectiveOk,
      providerStatus: result.providerStatus,
      providerStatusText: result.providerStatusText,
      traceId,
      sequenceDecision,
      detail: result.detail,
    }));
    if (role === "primary" && !result.effectiveOk) break;
  }

  const primaryEffectiveOk = sends.length > 0 && sends[0].effectiveOk;
  let recorded = false;
  if (reply.kind === "functional" && primaryEffectiveOk && lifecycle) {
    const recordText = resolveWhatsAppLogicalReplyRecordText(reply);
    if (recordText) {
      const { recordOutboundReply } = await import("./messageLifecycle");
      await recordOutboundReply(lifecycle.handle, { userId: lifecycle.userId, text: recordText });
      recorded = true;
    }
  }

  return {
    ok: sends.every(send => send.effectiveOk),
    primaryOk: primaryEffectiveOk,
    primaryEffectiveOk,
    sends,
    recorded,
  };
}
