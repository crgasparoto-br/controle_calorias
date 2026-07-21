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
 * enviá-lo uma única vez, na mesma posição física da sequência. `cta_url` já
 * resolve o próprio fallback dentro do adapter (`webhookUtils.ts`); aqui o
 * resultado é apenas refletido de forma coerente com os demais tipos.
 * Handlers não enviam fallback diretamente e não montam versões paralelas.
 */
import { safeLogDetail } from "../../privacy";
import {
  sendWhatsAppImageBufferMessage,
  sendWhatsAppImageMessage,
  sendWhatsAppInteractiveButtonsMessage,
  sendWhatsAppInteractiveListMessage,
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppTextMessage,
} from "./webhookUtils";
import {
  buildWhatsAppOutboundFallbackText,
  resolveWhatsAppLogicalReplyRecordText,
  validateWhatsAppOutboundMessage,
  type WhatsAppLogicalReply,
  type WhatsAppOutboundMessage,
} from "./replyContract";
import type { MessageLifecycleHandle } from "./messageLifecycle";

/** Papel físico da mensagem na resposta lógica: a primeira é sempre primária. */
export type WhatsAppOutboundRole = "primary" | "auxiliary";

/** Categoria da falha original, para observabilidade e decisão de fallback. */
export type WhatsAppOutboundFailureCategory = "validation" | "config" | "network" | "provider" | "none";

export type WhatsAppOutboundSendResult = {
  message: WhatsAppOutboundMessage;
  role: WhatsAppOutboundRole;
  /** Tentativa original (payload interativo/CTA nativo) foi aceita. */
  originalOk: boolean;
  /** Um fallback textual foi tentado para esta posição. */
  usedFallback: boolean;
  /** Resultado do fallback, quando tentado. */
  fallbackOk?: boolean;
  /** Sucesso efetivo desta posição: original OU fallback entregue. */
  effectiveOk: boolean;
  category: WhatsAppOutboundFailureCategory;
  /** Compatibilidade com o contrato anterior (issue #781): alias de `effectiveOk`. */
  ok: boolean;
  detail: string;
};

export type WhatsAppLogicalReplySendResult = {
  /** Sucesso efetivo de todas as posições da sequência. */
  ok: boolean;
  /** Alias mantido por compatibilidade: sucesso efetivo da posição primária. */
  primaryOk: boolean;
  /** Sucesso efetivo da posição primária (original ou fallback entregue). */
  primaryEffectiveOk: boolean;
  sends: WhatsAppOutboundSendResult[];
  recorded: boolean;
};

function classifyFailure(detail: string): WhatsAppOutboundFailureCategory {
  if (/credenciais|configura/i.test(detail)) return "config";
  if (/validação do contrato/i.test(detail)) return "validation";
  if (/Meta retornou/i.test(detail)) return "provider";
  return "network";
}

async function sendRawOutboundMessage(to: string, message: WhatsAppOutboundMessage): Promise<{ ok: boolean; detail: string }> {
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

/** `cta_url` já possui fallback textual nativo dentro do próprio adapter (issue #781). */
function transportHandlesOwnFallback(message: WhatsAppOutboundMessage) {
  return message.type === "cta_url";
}

function logOutboundAttempt(input: {
  role: WhatsAppOutboundRole;
  type: WhatsAppOutboundMessage["type"];
  origin?: string;
  category: WhatsAppOutboundFailureCategory;
  originalOk: boolean;
  usedFallback: boolean;
  fallbackOk?: boolean;
  effectiveOk: boolean;
  detail: string;
}) {
  console.info(
    "[WhatsAppReplyTransport]",
    safeLogDetail({
      type: input.type,
      role: input.role,
      origin: input.origin,
      category: input.category,
      originalOk: input.originalOk,
      usedFallback: input.usedFallback,
      fallbackOk: input.fallbackOk,
      effectiveOk: input.effectiveOk,
      detail: input.detail,
    }),
  );
}

/**
 * Envia uma mensagem física com fallback textual central quando aplicável
 * (issue #859). O fallback é tentado no máximo uma vez, derivado da própria
 * mensagem via `buildWhatsAppOutboundFallbackText`; nunca há retry síncrono
 * indefinido. IDs de callback nunca são incluídos no texto do fallback.
 */
async function sendOutboundMessageWithFallback(
  to: string,
  message: WhatsAppOutboundMessage,
  role: WhatsAppOutboundRole,
  origin?: string,
): Promise<WhatsAppOutboundSendResult> {
  const validationErrors = validateWhatsAppOutboundMessage(message);
  const localValidationFailed = validationErrors.length > 0;
  const original = localValidationFailed
    ? { ok: false, detail: `Mensagem rejeitada por validação do contrato: ${validationErrors.map(error => error.detail).join(" ")}` }
    : await sendRawOutboundMessage(to, message);

  if (original.ok || transportHandlesOwnFallback(message)) {
    const usedFallback = transportHandlesOwnFallback(message) && /fallback textual/i.test(original.detail);
    const category = original.ok ? "none" : classifyFailure(original.detail);
    const result: WhatsAppOutboundSendResult = {
      message,
      role,
      originalOk: original.ok && !usedFallback,
      usedFallback,
      fallbackOk: usedFallback ? original.ok : undefined,
      effectiveOk: original.ok,
      category,
      ok: original.ok,
      detail: original.detail,
    };
    logOutboundAttempt({ role, type: message.type, origin, category, originalOk: result.originalOk, usedFallback, fallbackOk: result.fallbackOk, effectiveOk: result.effectiveOk, detail: original.detail });
    return result;
  }

  const category = classifyFailure(original.detail);
  const fallbackText = buildWhatsAppOutboundFallbackText(message);
  if (!fallbackText) {
    logOutboundAttempt({ role, type: message.type, origin, category, originalOk: false, usedFallback: false, effectiveOk: false, detail: original.detail });
    return {
      message,
      role,
      originalOk: false,
      usedFallback: false,
      effectiveOk: false,
      category,
      ok: false,
      detail: original.detail,
    };
  }

  const fallback = await sendWhatsAppTextMessage(to, fallbackText);
  const detail = fallback.ok
    ? `Envio original falhou (${original.detail}); fallback textual entregue com sucesso.`
    : `Envio original falhou (${original.detail}); fallback textual também falhou (${fallback.detail}).`;
  logOutboundAttempt({ role, type: message.type, origin, category, originalOk: false, usedFallback: true, fallbackOk: fallback.ok, effectiveOk: fallback.ok, detail });
  return {
    message,
    role,
    originalOk: false,
    usedFallback: true,
    fallbackOk: fallback.ok,
    effectiveOk: fallback.ok,
    category,
    ok: fallback.ok,
    detail,
  };
}

export type WhatsAppLogicalReplyLifecycleInput = {
  handle: MessageLifecycleHandle;
  userId: number;
};

/**
 * Envia a resposta lógica completa. Todas as posições são tentadas de forma
 * independente (issue #859): a falha efetiva de uma mensagem auxiliar não
 * impede a tentativa de auxiliares posteriores independentes, e a falha
 * efetiva da mensagem primária não interrompe o envio de auxiliares — apenas
 * impede o registro da resposta funcional no lifecycle. Dependências reais
 * entre mensagens devem ser declaradas no contrato/plano de entrega, não
 * inferidas pela posição. Nenhuma mutação de domínio é reexecutada aqui.
 */
export async function sendWhatsAppLogicalReply(
  to: string,
  reply: WhatsAppLogicalReply,
  lifecycle?: WhatsAppLogicalReplyLifecycleInput,
  options?: { origin?: string },
): Promise<WhatsAppLogicalReplySendResult> {
  const sends: WhatsAppOutboundSendResult[] = [];
  for (let index = 0; index < reply.messages.length; index++) {
    const role: WhatsAppOutboundRole = index === 0 ? "primary" : "auxiliary";
    const result = await sendOutboundMessageWithFallback(to, reply.messages[index], role, options?.origin);
    sends.push(result);
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
