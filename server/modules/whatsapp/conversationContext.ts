import { parseWhatsappClarificationSelection, type WhatsappClarificationOption } from "./clarificationOptions";

type WhatsappConversationContextKind = "selection" | "confirmation";

type WhatsappConversationContext = {
  id: string;
  userId: number;
  kind: WhatsappConversationContextKind;
  createdAt: string;
  expiresAt: string;
  originalText: string | null;
  options: WhatsappClarificationOption[];
  metadata?: Record<string, unknown>;
};

type WhatsappContextResult = {
  handled: true;
  action:
    | "conversation_context_selection_received"
    | "conversation_context_confirmation_received"
    | "conversation_context_cancelled"
    | "conversation_context_expired"
    | "conversation_context_clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

type IntentLikeResult = {
  action: string;
  reply?: string;
  data?: Record<string, unknown>;
};

const DEFAULT_CONTEXT_TTL_MS = 10 * 60 * 1000;
const MAX_CONTEXTS = 500;
const contexts: WhatsappConversationContext[] = [];
let nextContextId = 1;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAffirmative(normalized: string) {
  return /^(sim|s|ok|okay|confirmo|confirmar|isso|pode|pode sim)$/.test(normalized);
}

function isNegativeOrCancel(normalized: string) {
  return /^(nao|n|não|cancelar|cancela|negativo|nenhuma|nenhum)$/.test(normalized);
}

function pruneExpired(now: Date) {
  const timestamp = now.getTime();
  for (let index = contexts.length - 1; index >= 0; index -= 1) {
    if (new Date(contexts[index].expiresAt).getTime() <= timestamp) {
      contexts.splice(index, 1);
    }
  }
}

function removeContext(contextId: string) {
  const index = contexts.findIndex(context => context.id === contextId);
  if (index >= 0) contexts.splice(index, 1);
}

function isContextualShortMessage(text: string) {
  const normalized = normalizeText(text);
  return Boolean(
    /^\d+$/.test(normalized)
      || isAffirmative(normalized)
      || isNegativeOrCancel(normalized)
      || /^(?:a |o )?(primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto|quinta|quinto|ultima)(?: opcao)?$/.test(normalized)
      || /^(isso|esse|essa|este|esta|o mesmo|a mesma|ultimo|ultima)$/.test(normalized),
  );
}

function normalizeOptions(value: unknown, optionCount: number): WhatsappClarificationOption[] {
  if (Array.isArray(value)) {
    const options = value
      .map((option, index): WhatsappClarificationOption | null => {
        if (!option || typeof option !== "object") return null;
        const candidate = option as { id?: unknown; label?: unknown; value?: unknown };
        if (typeof candidate.label !== "string" || !candidate.label.trim()) return null;
        const normalizedOption: WhatsappClarificationOption = {
          id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : String(index + 1),
          label: candidate.label.trim(),
          ...(candidate.value == null ? {} : { value: candidate.value }),
        };
        return normalizedOption;
      })
      .filter((option): option is WhatsappClarificationOption => Boolean(option));
    if (options.length) return options.slice(0, 10);
  }

  return Array.from({ length: Math.max(0, Math.min(10, optionCount)) }, (_, index) => ({
    id: String(index + 1),
    label: `Opção ${index + 1}`,
  }));
}

function buildResult(context: WhatsappConversationContext, result: Omit<WhatsappContextResult, "handled" | "eventType" | "data"> & { data?: Record<string, unknown> }): WhatsappContextResult {
  return {
    handled: true,
    eventType: `whatsapp.context.${result.action.replace(/^conversation_context_/, "")}`,
    ...result,
    data: {
      contextId: context.id,
      contextKind: context.kind,
      expiresAt: context.expiresAt,
      ...result.data,
    },
  };
}

export function createWhatsappConversationContext(input: {
  userId: number;
  kind: WhatsappConversationContextKind;
  originalText?: string | null;
  options?: WhatsappClarificationOption[];
  metadata?: Record<string, unknown>;
  now?: Date;
  ttlMs?: number;
}) {
  const now = input.now ?? new Date();
  pruneExpired(now);
  const context: WhatsappConversationContext = {
    id: `whatsapp-context-${nextContextId}`,
    userId: input.userId,
    kind: input.kind,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_CONTEXT_TTL_MS)).toISOString(),
    originalText: input.originalText ?? null,
    options: input.options ?? [],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
  nextContextId += 1;
  contexts.push(context);
  if (contexts.length > MAX_CONTEXTS) {
    contexts.splice(0, contexts.length - MAX_CONTEXTS);
  }
  return context;
}

export function getActiveWhatsappConversationContext(userId: number, now = new Date()) {
  pruneExpired(now);
  return [...contexts]
    .filter(context => context.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
}

export function resolveWhatsappConversationContext(userId: number, input: { text: string; receivedAt?: Date }): WhatsappContextResult | null {
  const receivedAt = input.receivedAt ?? new Date();
  const active = [...contexts]
    .filter(context => context.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  if (!active) return null;

  const normalized = normalizeText(input.text);
  const expired = new Date(active.expiresAt).getTime() <= receivedAt.getTime();
  if (expired) {
    removeContext(active.id);
    if (!isContextualShortMessage(input.text)) return null;
    return buildResult(active, {
      action: "conversation_context_expired",
      reply: "Essa pendência expirou. Me diga novamente qual refeição ou item devo ajustar.",
      detail: "Mensagem curta dependia de pendência expirada e foi bloqueada antes do parser nutricional.",
    });
  }

  if (isNegativeOrCancel(normalized)) {
    removeContext(active.id);
    return buildResult(active, {
      action: "conversation_context_cancelled",
      reply: "Certo, cancelei essa pendência. Nada foi alterado.",
      detail: "Pendência conversacional cancelada por resposta curta do usuário.",
    });
  }

  if (active.kind === "confirmation" && isAffirmative(normalized)) {
    removeContext(active.id);
    return buildResult(active, {
      action: "conversation_context_confirmation_received",
      reply: "Recebi sua confirmação. Vou encaminhar essa ação para o fluxo seguro correspondente.",
      detail: "Confirmação de pendência conversacional recebida sem criar registro alimentar.",
    });
  }

  if (active.kind === "selection") {
    const selection = parseWhatsappClarificationSelection(input.text, active.options);
    if (selection?.kind === "cancelled") {
      removeContext(active.id);
      return buildResult(active, {
        action: "conversation_context_cancelled",
        reply: "Certo, cancelei essa seleção. Nada foi alterado.",
        detail: "Seleção pendente cancelada pelo usuário.",
      });
    }
    if (selection?.kind === "out_of_range") {
      return buildResult(active, {
        action: "conversation_context_clarification_needed",
        reply: `Escolha uma opção entre 1 e ${active.options.length}, ou escreva cancelar.`,
        detail: "Usuário respondeu uma opção fora da faixa da pendência ativa.",
        data: { selectedNumber: selection.selectedNumber, optionCount: selection.optionCount },
      });
    }
    if (selection?.kind === "selected") {
      removeContext(active.id);
      return buildResult(active, {
        action: "conversation_context_selection_received",
        reply: `Recebi a opção ${selection.selectedNumber}: ${selection.option.label}. Vou usar essa escolha no contexto pendente.`,
        detail: "Seleção de opção pendente recebida sem cair no parser nutricional.",
        data: {
          selectedNumber: selection.selectedNumber,
          selectedOptionId: selection.option.id,
          selectedOptionLabel: selection.option.label,
          selectedOptionValue: selection.option.value ?? null,
        },
      });
    }
    if (!isContextualShortMessage(input.text)) return null;
    return buildResult(active, {
      action: "conversation_context_clarification_needed",
      reply: `Escolha uma opção entre 1 e ${active.options.length}, ou escreva cancelar.`,
      detail: "Mensagem curta não indicou uma opção válida para a seleção ativa.",
      data: { optionCount: active.options.length },
    });
  }

  if (isContextualShortMessage(input.text)) {
    return buildResult(active, {
      action: "conversation_context_clarification_needed",
      reply: "Ainda preciso de uma resposta compatível com a pendência atual.",
      detail: "Mensagem curta não correspondeu ao tipo da pendência ativa.",
    });
  }

  return null;
}

export function registerWhatsappConversationContextFromResult(userId: number, input: {
  text: string;
  result: IntentLikeResult | null | undefined;
  receivedAt?: Date;
}) {
  if (!input.result) return null;

  if (input.result.action.endsWith("_selection_needed")) {
    const optionCount = typeof input.result.data?.optionCount === "number" ? input.result.data.optionCount : 0;
    const options = normalizeOptions(input.result.data?.options, optionCount);
    if (!options.length) return null;
    return createWhatsappConversationContext({
      userId,
      kind: "selection",
      originalText: input.text,
      options,
      metadata: {
        action: input.result.action,
        receivedAt: (input.receivedAt ?? new Date()).toISOString(),
      },
    });
  }

  if (input.result.action.endsWith("_confirmation_needed")) {
    return createWhatsappConversationContext({
      userId,
      kind: "confirmation",
      originalText: input.text,
      metadata: {
        action: input.result.action,
        receivedAt: (input.receivedAt ?? new Date()).toISOString(),
      },
    });
  }

  return null;
}

export function __resetWhatsappConversationContextsForTests() {
  contexts.length = 0;
  nextContextId = 1;
}
