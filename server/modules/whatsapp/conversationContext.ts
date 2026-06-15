type WhatsappConversationPendingKind = "selection" | "confirmation";

type WhatsappConversationOption = {
  id: string;
  label: string;
  value: Record<string, unknown>;
};

type WhatsappContextSourceResult = {
  action: string;
  reply: string;
  data?: Record<string, unknown>;
};

type WhatsappConversationPendingContext = {
  id: string;
  kind: WhatsappConversationPendingKind;
  userId: number;
  sourceAction: string;
  sourceMessage: string;
  createdAt: number;
  expiresAt: number;
  options: WhatsappConversationOption[];
  target: Record<string, unknown> | null;
};

type WhatsappConversationContextResult = {
  handled: true;
  action:
    | "conversation_context_option_selected"
    | "conversation_context_confirmation_accepted"
    | "conversation_context_confirmation_rejected"
    | "conversation_context_cancelled"
    | "conversation_context_clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
};

type WhatsappConversationContextInput = {
  text?: string | null;
  receivedAt?: Date;
};

const DEFAULT_PENDING_TTL_MS = 15 * 60 * 1000;
const pendingByUser = new Map<number, WhatsappConversationPendingContext>();

function nowMs(receivedAt?: Date) {
  return receivedAt?.getTime() ?? Date.now();
}

function normalizeText(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function isAffirmative(text: string) {
  return /^(?:s|sim|ok|confirmo|confirmar|pode|pode sim|isso|certo)$/.test(text);
}

function isNegative(text: string) {
  return /^(?:n|nao|não|negativo|cancela|cancelar|nao confirma|não confirma)$/.test(text);
}

function isCancel(text: string) {
  return /^(?:cancela|cancelar|cancelar isso|cancela isso|deixa pra la|deixa pra lá|ignora|ignora isso)$/.test(text);
}

function parseSelectionIndex(text: string) {
  const numberMatch = text.match(/^(?:opcao\s*)?(\d+)$/);
  if (numberMatch) return Number(numberMatch[1]) - 1;
  if (/^(?:a\s+)?primeira(?:\s+opcao)?$/.test(text)) return 0;
  if (/^(?:a\s+)?segunda(?:\s+opcao)?$/.test(text)) return 1;
  if (/^(?:a\s+)?terceira(?:\s+opcao)?$/.test(text)) return 2;
  return null;
}

function isContextDependentText(text: string) {
  return /^(?:isso|esse|essa|o ultimo|a ultima|ultimo|ultima|o mesmo|a mesma|a anterior|o anterior)$/.test(text)
    || /^(?:troca|trocar|corrige|corrigir|coloca|somar|some|remove|remover|apaga|apagar)\b/.test(text)
    || /^(?:na verdade|era|não|nao)\b/.test(text)
    || parseSelectionIndex(text) !== null
    || isAffirmative(text)
    || isNegative(text)
    || isCancel(text);
}

function buildContextResult(input: {
  action: WhatsappConversationContextResult["action"];
  reply: string;
  detail: string;
  data: Record<string, unknown>;
}): WhatsappConversationContextResult {
  return {
    handled: true,
    action: input.action,
    reply: input.reply,
    eventType: `whatsapp.context.${input.action}`,
    detail: input.detail,
    data: input.data,
  };
}

function buildPendingId(userId: number, createdAt: number, sourceAction: string) {
  return `${userId}:${sourceAction}:${createdAt}`;
}

function getPending(userId: number, receivedAt?: Date) {
  const pending = pendingByUser.get(userId);
  if (!pending) return null;
  if (pending.expiresAt <= nowMs(receivedAt)) {
    pendingByUser.delete(userId);
    return "expired" as const;
  }
  return pending;
}

export function clearWhatsappConversationContext(userId?: number) {
  if (typeof userId === "number") {
    pendingByUser.delete(userId);
    return;
  }
  pendingByUser.clear();
}

export function getWhatsappConversationPendingContext(userId: number, receivedAt?: Date) {
  const pending = getPending(userId, receivedAt);
  return pending === "expired" ? null : pending;
}

export function registerWhatsappConversationPendingContext(
  userId: number,
  source: WhatsappContextSourceResult,
  input: { text?: string | null; receivedAt?: Date; ttlMs?: number } = {},
) {
  const createdAt = nowMs(input.receivedAt);
  const ttlMs = input.ttlMs ?? DEFAULT_PENDING_TTL_MS;
  const data = source.data ?? {};
  const options = Array.isArray(data.options)
    ? data.options.filter((option): option is WhatsappConversationOption => {
        const candidate = option as Partial<WhatsappConversationOption>;
        return typeof candidate.id === "string"
          && typeof candidate.label === "string"
          && Boolean(candidate.value)
          && typeof candidate.value === "object";
      })
    : [];

  const kind: WhatsappConversationPendingKind | null = source.action === "record_adjustment_selection_needed"
    ? "selection"
    : source.action === "record_adjustment_confirmation_needed" || source.action === "conversation_context_option_selected"
      ? "confirmation"
      : null;
  if (!kind) return null;

  const target = kind === "confirmation"
    ? {
        ...data,
        options: undefined,
        nextPendingContext: undefined,
      }
    : null;

  const pending: WhatsappConversationPendingContext = {
    id: buildPendingId(userId, createdAt, source.action),
    kind,
    userId,
    sourceAction: source.action,
    sourceMessage: input.text?.trim() || source.reply,
    createdAt,
    expiresAt: createdAt + ttlMs,
    options,
    target,
  };
  pendingByUser.set(userId, pending);
  return pending;
}

export function resolveWhatsappConversationContext(
  userId: number,
  input: WhatsappConversationContextInput,
): WhatsappConversationContextResult | null {
  const text = normalizeText(input.text);
  if (!text) return null;

  const pending = getPending(userId, input.receivedAt);
  if (pending === "expired") {
    if (!isContextDependentText(text)) return null;
    return buildContextResult({
      action: "conversation_context_clarification_needed",
      reply: "A pendência anterior expirou. Envie novamente o item, a opção ou o ajuste completo para eu continuar com segurança.",
      detail: "Mensagem dependente de contexto chegou depois da expiracao da pendencia.",
      data: { contextUsed: false, pendingExpired: true },
    });
  }

  if (!pending) {
    if (!isContextDependentText(text)) return null;
    return buildContextResult({
      action: "conversation_context_clarification_needed",
      reply: "Não encontrei uma pendência ativa para essa resposta. Envie o alimento, ajuste ou opção completa.",
      detail: "Mensagem curta ou referencial sem contexto ativo foi bloqueada antes do fallback alimentar.",
      data: { contextUsed: false, pendingConsumed: false },
    });
  }

  if (isCancel(text)) {
    pendingByUser.delete(userId);
    return buildContextResult({
      action: "conversation_context_cancelled",
      reply: "Pendência cancelada. Não alterei nenhum registro.",
      detail: "Usuario cancelou pendencia conversacional ativa.",
      data: { contextUsed: true, pendingConsumed: true, pendingId: pending.id, pendingKind: pending.kind },
    });
  }

  if (pending.kind === "selection") {
    const optionIndex = parseSelectionIndex(text);
    if (optionIndex === null) {
      return buildContextResult({
        action: "conversation_context_clarification_needed",
        reply: "Tenho uma lista pendente. Responda com o número da opção ou envie 'cancela'.",
        detail: "Pendencia de selecao recebeu resposta sem opcao valida.",
        data: { contextUsed: true, pendingConsumed: false, pendingId: pending.id, pendingKind: pending.kind },
      });
    }

    const option = pending.options[optionIndex];
    if (!option) {
      return buildContextResult({
        action: "conversation_context_clarification_needed",
        reply: `Essa opção não está na lista. Responda de 1 a ${pending.options.length}, ou envie 'cancela'.`,
        detail: "Pendencia de selecao recebeu indice fora das opcoes validas.",
        data: { contextUsed: true, pendingConsumed: false, pendingId: pending.id, pendingKind: pending.kind, optionIndex: optionIndex + 1 },
      });
    }

    pendingByUser.delete(userId);
    return buildContextResult({
      action: "conversation_context_option_selected",
      reply: `Você escolheu: ${option.label}. Confirme com 'sim' para continuar ou 'cancela' para não alterar nada.`,
      detail: "Opcao de pendencia conversacional selecionada e convertida em confirmacao.",
      data: {
        contextUsed: true,
        pendingConsumed: true,
        pendingId: pending.id,
        pendingKind: pending.kind,
        selectedOption: option,
        nextPendingContext: {
          kind: "confirmation",
          target: option.value,
        },
      },
    });
  }

  if (pending.kind === "confirmation") {
    if (isAffirmative(text)) {
      pendingByUser.delete(userId);
      return buildContextResult({
        action: "conversation_context_confirmation_accepted",
        reply: "Confirmação recebida. Mantive a ação em modo seguro; a alteração definitiva será aplicada quando o fluxo de execução de pendências estiver disponível.",
        detail: "Confirmacao de pendencia conversacional consumida sem acionar fallback alimentar.",
        data: { contextUsed: true, pendingConsumed: true, pendingId: pending.id, pendingKind: pending.kind, target: pending.target },
      });
    }

    if (isNegative(text)) {
      pendingByUser.delete(userId);
      return buildContextResult({
        action: "conversation_context_confirmation_rejected",
        reply: "Tudo bem, não alterei nenhum registro.",
        detail: "Usuario rejeitou pendencia conversacional ativa.",
        data: { contextUsed: true, pendingConsumed: true, pendingId: pending.id, pendingKind: pending.kind, target: pending.target },
      });
    }

    return buildContextResult({
      action: "conversation_context_clarification_needed",
      reply: "Tenho uma confirmação pendente. Responda com 'sim', 'não' ou 'cancela'.",
      detail: "Pendencia de confirmacao recebeu resposta sem confirmacao valida.",
      data: { contextUsed: true, pendingConsumed: false, pendingId: pending.id, pendingKind: pending.kind },
    });
  }

  return null;
}
