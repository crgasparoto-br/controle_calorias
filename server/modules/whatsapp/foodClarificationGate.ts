import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { executeWhatsappDeleteIntent, PENDING_DELETE_TYPE } from "./deleteIntent";
import {
  handleWhatsappFoodClarification,
  PENDING_FOOD_CLARIFICATION_TYPE,
} from "./foodClarification";
import { isCompleteWhatsappCommand } from "./foodClarificationContract";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import {
  createWhatsappIntentClarificationInteraction,
  parseIntentClarificationTextAction,
  PENDING_INTENT_CLARIFICATION_TYPE,
  resolveWhatsappIntentClarificationText,
} from "./intentClarificationInteraction";
import {
  claimWhatsAppTextPendingOperation,
} from "./interactiveCallback";
import {
  findWhatsappRegisteredInteraction,
  rebuildWhatsappRegisteredInteraction,
} from "./interactionRegistry";
import {
  PENDING_MEAL_ITEM_SELECTION_TYPE,
  resolveTextMealItemSelection,
} from "./mealItemSelectionCallback";
import {
  completeWhatsappPeriodReportCallback,
  PENDING_PERIOD_REPORT_TYPE,
  WHATSAPP_PERIOD_REPORT_OPTIONS,
} from "./periodReportClarification";
import {
  isStandaloneWhatsappCancellationWord,
  isStandaloneWhatsappCommandWord,
  isStandaloneWhatsappConfirmationWord,
} from "./standaloneCommandWords";
import {
  handlePendingWhatsAppConfirmation,
  PENDING_CONFIRMATION_TYPE,
} from "./webhookTextCommands";
import { normalizeWhatsAppShortCommandText, type WhatsAppWebhookMessage } from "./webhookUtils";

const PENDING_PROFESSIONAL_ACCESS_TYPE = "professional_access";

type PendingInteractionResult = {
  handled: true;
  action?: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: import("./replyContract").WhatsAppLogicalReply;
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function parseBareIndex(text: string) {
  const normalized = normalizeWhatsAppShortCommandText(text);
  const ordinalWords: Record<string, number> = {
    primeiro: 0,
    primeira: 0,
    segundo: 1,
    segunda: 1,
    terceiro: 2,
    terceira: 2,
    quarto: 3,
    quarta: 3,
    quinto: 4,
    quinta: 4,
  };
  if (normalized in ordinalWords) return ordinalWords[normalized];
  const match = normalized.match(/^(?:opcao\s*)?(\d{1,2})$/);
  return match ? Number(match[1]) - 1 : null;
}

function parsePeriodAction(text: string) {
  const normalized = normalizeWhatsAppShortCommandText(text);
  if (isStandaloneWhatsappCancellationWord(normalized)) return "cancel";
  return WHATSAPP_PERIOD_REPORT_OPTIONS.find(option => {
    const token = option.action.replace("period:", "");
    return normalized === token
      || normalized === option.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      || normalized.includes(token);
  })?.action ?? null;
}

function parseScopeAction(text: string) {
  const normalized = normalizeWhatsAppShortCommandText(text);
  if (isStandaloneWhatsappCancellationWord(normalized)) return "cancel";
  if (/^(?:apenas|somente|so)(?:\s+compativeis)?$/.test(normalized) || normalized === "1") return "confirm";
  if (/^(?:todos|todas)(?:\s+recentes)?$/.test(normalized) || normalized === "2") return "confirm_all";
  return null;
}

function shouldCreateGenericIntentClarification(text?: string | null) {
  const normalized = normalizeWhatsAppShortCommandText(text ?? "");
  return ["registrar", "registre", "registra", "corrigir", "corrija", "corrige", "consultar", "consulte", "consulta"]
    .includes(normalized);
}

function classifyPendingText(
  pending: WhatsAppPendingOperationRecord,
  text?: string | null,
): "resolve" | "invalid" | "new_command" {
  const raw = text?.trim() ?? "";
  const normalized = normalizeWhatsAppShortCommandText(raw);

  if (isCompleteWhatsappCommand(raw)) return "new_command";

  if (pending.type === PENDING_DELETE_TYPE) {
    const target = pending.target as { kind?: string; candidates?: unknown[] };
    if (isStandaloneWhatsappCancellationWord(normalized)) return "resolve";
    if (target?.kind === "selection") {
      const index = parseBareIndex(raw);
      if (index !== null && index >= 0 && index < (target.candidates?.length ?? 0)) return "resolve";
      return "invalid";
    }
    return isStandaloneWhatsappConfirmationWord(normalized) ? "resolve" : "invalid";
  }

  if (pending.type === PENDING_MEAL_ITEM_SELECTION_TYPE) {
    const target = pending.target as { candidates?: unknown[] };
    if (isStandaloneWhatsappCancellationWord(normalized)) return "resolve";
    const index = parseBareIndex(raw);
    if (index !== null && index >= 0 && index < (target.candidates?.length ?? 0)) return "resolve";
    return "invalid";
  }

  if (pending.type === PENDING_CONFIRMATION_TYPE) {
    const target = pending.target as { decision?: string };
    if (target?.decision === "reclassify_scope") return parseScopeAction(raw) ? "resolve" : "invalid";
    return isStandaloneWhatsappConfirmationWord(normalized) || isStandaloneWhatsappCancellationWord(normalized)
      ? "resolve"
      : "invalid";
  }

  if (pending.type === PENDING_PERIOD_REPORT_TYPE) return parsePeriodAction(raw) ? "resolve" : "invalid";
  if (pending.type === PENDING_INTENT_CLARIFICATION_TYPE) return parseIntentClarificationTextAction(raw) ? "resolve" : "invalid";

  if (pending.type === PENDING_PROFESSIONAL_ACCESS_TYPE) {
    const normalizedDecision = normalized.toUpperCase();
    if (/\b(?:AUTORIZAR|AUTORIZO|APROVAR|APROVO|ACEITAR|ACEITO|NEGAR|NEGO|RECUSAR|RECUSO)\b/.test(normalizedDecision)) {
      return "resolve";
    }
    return "invalid";
  }

  return "invalid";
}

async function resolveRegisteredText(input: {
  userId: number;
  pending: WhatsAppPendingOperationRecord;
  text?: string | null;
  receivedAt?: Date;
  userTimezone: string;
}): Promise<PendingInteractionResult | null> {
  if (input.pending.type === PENDING_DELETE_TYPE) {
    return executeWhatsappDeleteIntent(input.userId, {
      text: input.text,
      receivedAt: input.receivedAt,
      timeZone: input.userTimezone,
      entrypoint: "pendingInteractionGate",
    });
  }

  if (input.pending.type === PENDING_MEAL_ITEM_SELECTION_TYPE) {
    return resolveTextMealItemSelection(input.userId, input.text);
  }

  if (input.pending.type === PENDING_CONFIRMATION_TYPE) {
    const target = input.pending.target as { decision?: string };
    if (target?.decision === "reclassify_scope") {
      const action = parseScopeAction(input.text ?? "");
      if (!action) return null;
      const claim = await claimWhatsAppTextPendingOperation(
        input.userId,
        PENDING_CONFIRMATION_TYPE,
        action,
        input.receivedAt,
      );
      if (claim.status !== "claimed") return null;
      const { completeWhatsappGenericConfirmationCallback } = await import("./webhookTextCommands");
      return completeWhatsappGenericConfirmationCallback(input.userId, claim.pendingOperation, action);
    }
    const message: WhatsAppWebhookMessage = { text: { body: input.text ?? "" } };
    return handlePendingWhatsAppConfirmation(message, input.userId);
  }

  if (input.pending.type === PENDING_PERIOD_REPORT_TYPE) {
    const action = parsePeriodAction(input.text ?? "");
    if (!action) return null;
    const claim = await claimWhatsAppTextPendingOperation(
      input.userId,
      PENDING_PERIOD_REPORT_TYPE,
      action,
      input.receivedAt,
    );
    if (claim.status !== "claimed") return null;
    return completeWhatsappPeriodReportCallback(input.userId, action, input.receivedAt);
  }

  if (input.pending.type === PENDING_INTENT_CLARIFICATION_TYPE) {
    return resolveWhatsappIntentClarificationText({
      userId: input.userId,
      pendingOperation: input.pending,
      text: input.text,
      receivedAt: input.receivedAt,
    });
  }

  if (input.pending.type === PENDING_PROFESSIONAL_ACCESS_TYPE) {
    const service = await import("../professionals/service");
    const decision = service.parseProfessionalAccessWhatsappDecision(input.text ?? "");
    if (!decision) return null;
    const action = decision === "approved" ? "authorize" : "reject";
    const claim = await claimWhatsAppTextPendingOperation(
      input.userId,
      PENDING_PROFESSIONAL_ACCESS_TYPE,
      action,
      input.receivedAt,
    );
    if (claim.status !== "claimed") return null;
    return service.completeWhatsAppProfessionalAccessCallback(input.userId, claim.pendingOperation, action);
  }

  return null;
}

function buildUnregisteredPendingResult(pending: WhatsAppPendingOperationRecord): PendingInteractionResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: "Há uma operação pendente que não pode ser resolvida com segurança. Envie CANCELAR ou refaça o comando completo.",
    eventType: "whatsapp.interaction.unregistered_pending_blocked",
    detail: `Tipo de pendência não registrado bloqueou o fallback. type=${pending.type}`,
    data: {
      pendingOperationId: pending.id,
      pendingType: pending.type,
      fallbackBlocked: true,
      fallbackBlockReason: "unregistered_pending_type",
    },
  };
}

/**
 * Gate transversal mantido com o nome anterior por compatibilidade. Ele resolve
 * todas as pendências registradas e é chamado pelo webhook real e simulador.
 */
export async function resolvePendingWhatsappFoodClarification(input: {
  userId: number;
  text?: string | null;
  receivedAt?: Date;
  userTimezone: string;
  messageId?: string | null;
}): Promise<PendingInteractionResult | null> {
  const active = await pendingOperationRepository.getActivePendingOperation(input.userId, input.receivedAt);
  const correlatedInput = {
    ...input,
    messageId: input.messageId?.trim() || getCurrentWhatsappInboundExternalMessageId(),
  };

  if (active?.type === PENDING_FOOD_CLARIFICATION_TYPE) {
    return handleWhatsappFoodClarification(correlatedInput);
  }

  if (!active) {
    if (shouldCreateGenericIntentClarification(input.text)) {
      return createWhatsappIntentClarificationInteraction({
        userId: input.userId,
        originalText: input.text ?? "",
        receivedAt: input.receivedAt,
      });
    }
    return isStandaloneWhatsappCommandWord(input.text)
      ? handleWhatsappFoodClarification(correlatedInput)
      : null;
  }

  const interaction = findWhatsappRegisteredInteraction(active.type, active.target);
  if (!interaction) return buildUnregisteredPendingResult(active);

  const classification = classifyPendingText(active, input.text);
  if (classification === "new_command") {
    const superseded = await pendingOperationRepository.supersedePendingOperation(active.id);
    if (superseded.superseded) return null;
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não consegui substituir a operação pendente com segurança. Cancele a ação anterior e envie o novo comando novamente.",
      eventType: "whatsapp.interaction.pending_replacement_blocked",
      detail: "Novo comando completo bloqueado porque a pendência anterior não pôde ser marcada como substituída.",
      data: { pendingOperationId: active.id, pendingType: active.type, fallbackBlocked: true },
    };
  }

  if (classification === "resolve") {
    const resolved = await resolveRegisteredText({
      userId: input.userId,
      pending: active,
      text: input.text,
      receivedAt: input.receivedAt,
      userTimezone: input.userTimezone,
    });
    if (resolved) return resolved;
  }

  const replay = await rebuildWhatsappRegisteredInteraction(active, { timeZone: input.userTimezone });
  if (!replay) return buildUnregisteredPendingResult(active);
  return {
    handled: true,
    action: "clarification_needed",
    reply: replay.reply,
    eventType: "whatsapp.interaction.pending_represented",
    detail: `Resposta inválida reapresentou a mesma interação sem consumir a pendência. interactionId=${interaction.id}`,
    data: {
      pendingOperationId: active.id,
      pendingType: active.type,
      fallbackBlocked: true,
      fallbackBlockReason: "pending_interaction_represented",
      ...replay.telemetry,
    },
    interactiveReply: replay.interactiveReply,
  };
}
