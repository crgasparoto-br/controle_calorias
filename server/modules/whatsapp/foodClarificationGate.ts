import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { handleWhatsappFoodClarification } from "./foodClarification";
import { isCompleteWhatsappCommand } from "./foodClarificationContract";
import { attachWhatsappFoodClarificationPresentation } from "./foodClarificationPresentation";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import { createWhatsappIntentClarificationInteraction } from "./intentClarificationInteraction";
import {
  findWhatsappRegisteredInteraction,
  rebuildWhatsappRegisteredInteraction,
  resolveWhatsappRegisteredText,
} from "./interactionRegistry";
import type { WhatsAppLogicalReply } from "./replyContract";
import {
  isStandaloneWhatsappCommandWord,
  normalizeStandaloneWhatsappCommand,
} from "./standaloneCommandWords";

type PendingInteractionResult = {
  handled: true;
  action: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

type ResolvedInteractionLike = {
  handled?: boolean;
  action?: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function normalizeResolvedInteraction(
  value: ResolvedInteractionLike,
  fallbackAction: string,
): PendingInteractionResult {
  return {
    ...value,
    handled: true,
    action: value.action ?? fallbackAction,
  };
}

function shouldCreateGenericIntentClarification(text?: string | null) {
  const normalized = normalizeStandaloneWhatsappCommand(text ?? "");
  return ["registrar", "registre", "registra", "corrigir", "corrija", "corrige", "consultar", "consulte", "consulta"]
    .includes(normalized);
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
      interactionLifecycle: "blocked",
    },
  };
}

export async function resolvePendingWhatsappFoodClarification(input: {
  userId: number;
  text?: string | null;
  receivedAt?: Date;
  userTimezone: string;
  messageId?: string | null;
}): Promise<PendingInteractionResult | null> {
  const active = await pendingOperationRepository.getActivePendingOperation(input.userId, input.receivedAt);
  const correlatedMessageId = input.messageId?.trim() || getCurrentWhatsappInboundExternalMessageId();

  if (!active) {
    if (shouldCreateGenericIntentClarification(input.text)) {
      const created = await createWhatsappIntentClarificationInteraction({
        userId: input.userId,
        originalText: input.text ?? "",
        receivedAt: input.receivedAt,
      });
      return created ? normalizeResolvedInteraction(created, "clarification_needed") : null;
    }
    if (isStandaloneWhatsappCommandWord(input.text)) {
      const foodResult = await handleWhatsappFoodClarification({
        ...input,
        messageId: correlatedMessageId,
      });
      const presented = await attachWhatsappFoodClarificationPresentation(
        input.userId,
        foodResult,
        input.receivedAt,
      );
      return presented
        ? normalizeResolvedInteraction(presented, "food_clarification_standalone_command_blocked")
        : null;
    }
    return null;
  }

  const interaction = findWhatsappRegisteredInteraction(active.type, active.target);
  if (!interaction) return buildUnregisteredPendingResult(active);

  if (isCompleteWhatsappCommand(input.text?.trim() ?? "")) {
    const superseded = await pendingOperationRepository.supersedePendingOperation(active.id);
    if (superseded.superseded) return null;
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não consegui substituir a operação pendente com segurança. Cancele a ação anterior e envie o novo comando novamente.",
      eventType: "whatsapp.interaction.pending_replacement_blocked",
      detail: "Novo comando completo bloqueado porque a pendência anterior não pôde ser marcada como substituída.",
      data: {
        pendingOperationId: active.id,
        pendingType: active.type,
        fallbackBlocked: true,
        interactionLifecycle: "blocked",
      },
    };
  }

  const classification = interaction.classifyText(active.target, input.text);
  if (classification === "resolve") {
    const resolved = await resolveWhatsappRegisteredText(interaction, {
      userId: input.userId,
      pendingOperation: active,
      text: input.text,
      receivedAt: input.receivedAt,
      userTimezone: input.userTimezone,
      messageId: correlatedMessageId,
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
