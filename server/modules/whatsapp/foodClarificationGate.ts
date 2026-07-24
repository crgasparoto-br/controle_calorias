import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { handleWhatsappFoodClarification } from "./foodClarification";
import { parseLatestFoodCorrection } from "./contextualFoodReplacementIntent";
import { isCompleteWhatsappCommand } from "./foodClarificationContract";
import { attachWhatsappFoodClarificationPresentation } from "./foodClarificationPresentation";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import { createWhatsappIntentClarificationInteraction } from "./intentClarificationInteraction";
import {
  parseMealIntentDecisionTextAction,
  PENDING_MEAL_INTENT_DECISION_TYPE,
} from "./mealIntentDecisionInteraction";
import { buildWhatsappInteractionTelemetry } from "./interactionPresentation";
import {
  findWhatsappRegisteredInteraction,
  rebuildWhatsappRegisteredInteraction,
  resolveWhatsappRegisteredText,
  type WhatsappRegisteredInteraction,
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

type InteractionLifecycle =
  | "represented"
  | "cancelled"
  | "consumed"
  | "blocked";

const pendingOperationRepository =
  createDrizzleWhatsAppPendingOperationRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });

function normalizeResolvedInteraction(
  value: ResolvedInteractionLike,
  fallbackAction: string
): PendingInteractionResult {
  return {
    ...value,
    handled: true,
    action: value.action ?? fallbackAction,
  };
}

function inferTextInteractionLifecycle(
  result: PendingInteractionResult
): InteractionLifecycle {
  const marker = `${result.action} ${result.eventType}`.toLowerCase();
  if (marker.includes("cancel")) return "cancelled";
  if (/(reprompt|represented|clarification_needed|invalid_)/.test(marker))
    return "represented";
  if (/(blocked|unavailable|stale|not_found)/.test(marker)) return "blocked";
  return "consumed";
}

function enrichResolvedTextInteraction(input: {
  pending: WhatsAppPendingOperationRecord;
  interaction: WhatsappRegisteredInteraction;
  result: PendingInteractionResult;
  timeZone: string;
}) {
  const actions = input.interaction.actions(input.pending.target, {
    timeZone: input.timeZone,
  });
  const lifecycle = inferTextInteractionLifecycle(input.result);
  const invalidResponseReason =
    lifecycle === "represented" || lifecycle === "blocked"
      ? input.result.eventType
      : null;
  const telemetry = buildWhatsappInteractionTelemetry({
    interactionId: input.interaction.id,
    origin: input.interaction.origin,
    classification: input.interaction.classification,
    actions,
    lifecycle,
    invalidResponseReason,
  });
  const downstreamInteractionId =
    typeof input.result.data?.interactionId === "string"
      ? input.result.data.interactionId
      : null;
  const transitionedToAnotherInteraction = Boolean(
    downstreamInteractionId && downstreamInteractionId !== input.interaction.id
  );

  return {
    ...input.result,
    detail: `${input.result.detail} interaction=${JSON.stringify({
      interactionId: input.interaction.id,
      origin: input.interaction.origin,
      classification: input.interaction.classification,
      actionCount: actions.length,
      lifecycle,
      transitionedToInteractionId: transitionedToAnotherInteraction
        ? downstreamInteractionId
        : null,
    })}`,
    data: transitionedToAnotherInteraction
      ? {
          ...(input.result.data ?? {}),
          sourcePendingOperationId: input.pending.id,
          sourcePendingType: input.pending.type,
          sourceInteractionId: telemetry.interactionId,
          sourceInteractionOrigin: telemetry.interactionOrigin,
          sourceInteractionClassification: telemetry.interactionClassification,
          sourceInteractionComponent: telemetry.interactionComponent,
          sourceInteractionActionCount: telemetry.interactionActionCount,
          sourceInteractionLifecycle: telemetry.interactionLifecycle,
          sourceInvalidResponseReason: telemetry.invalidResponseReason,
        }
      : {
          ...(input.result.data ?? {}),
          pendingOperationId: input.pending.id,
          pendingType: input.pending.type,
          ...telemetry,
        },
  } satisfies PendingInteractionResult;
}

function shouldCreateGenericIntentClarification(text?: string | null) {
  const normalized = normalizeStandaloneWhatsappCommand(text ?? "");
  return [
    "registrar",
    "registre",
    "registra",
    "corrigir",
    "corrija",
    "corrige",
    "consultar",
    "consulte",
    "consulta",
  ].includes(normalized);
}

function buildUnregisteredPendingResult(
  pending: WhatsAppPendingOperationRecord
): PendingInteractionResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply:
      "Há uma operação pendente que não pode ser resolvida com segurança. Envie CANCELAR ou refaça o comando completo.",
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
  const active = await pendingOperationRepository.getActivePendingOperation(
    input.userId,
    input.receivedAt
  );
  const correlatedMessageId =
    input.messageId?.trim() || getCurrentWhatsappInboundExternalMessageId();

  if (active && parseLatestFoodCorrection(input.text?.trim() ?? "")) {
    const superseded =
      await pendingOperationRepository.supersedePendingOperation(active.id);
    if (superseded.superseded) return null;
    return {
      handled: true,
      action: "clarification_needed",
      reply:
        "Não consegui substituir a operação pendente com segurança. Envie CANCELAR e repita a correção do último alimento.",
      eventType: "whatsapp.interaction.pending_replacement_blocked",
      detail:
        "Correção clara do último alimento não conseguiu substituir a pendência incompatível.",
      data: {
        pendingOperationId: active.id,
        pendingType: active.type,
        fallbackBlocked: true,
        interactionLifecycle: "blocked",
      },
    };
  }

  if (!active) {
    const latest =
      (await pendingOperationRepository.getLatestPendingOperation?.(
        input.userId
      )) ?? null;
    if (
      latest?.type === PENDING_MEAL_INTENT_DECISION_TYPE &&
      parseMealIntentDecisionTextAction(input.text) &&
      (latest.state !== "active" ||
        new Date(latest.expiresAt).getTime() <
          (input.receivedAt ?? new Date()).getTime())
    ) {
      return {
        handled: true,
        action: "clarification_needed",
        reply:
          "Essa escolha não está mais disponível. Envie novamente a descrição completa da refeição.",
        eventType: "whatsapp.meal_intent_decision.unavailable",
        detail:
          "Alias textual de decisão expirada, consumida, cancelada ou substituída foi bloqueado antes da clarificação genérica.",
        data: {
          fallbackBlocked: true,
          fallbackBlockReason: "stale_meal_intent_decision",
          interactionLifecycle: "blocked",
        },
      };
    }
    if (shouldCreateGenericIntentClarification(input.text)) {
      const created = await createWhatsappIntentClarificationInteraction({
        userId: input.userId,
        originalText: input.text ?? "",
        receivedAt: input.receivedAt,
      });
      return created
        ? normalizeResolvedInteraction(created, "clarification_needed")
        : null;
    }
    if (isStandaloneWhatsappCommandWord(input.text)) {
      const foodResult = await handleWhatsappFoodClarification({
        ...input,
        messageId: correlatedMessageId,
      });
      const presented = await attachWhatsappFoodClarificationPresentation(
        input.userId,
        foodResult,
        input.receivedAt
      );
      return presented
        ? normalizeResolvedInteraction(
            presented,
            "food_clarification_standalone_command_blocked"
          )
        : null;
    }
    return null;
  }

  const interaction = findWhatsappRegisteredInteraction(
    active.type,
    active.target
  );
  if (!interaction) return buildUnregisteredPendingResult(active);

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
    if (resolved) {
      return enrichResolvedTextInteraction({
        pending: active,
        interaction,
        result: resolved,
        timeZone: input.userTimezone,
      });
    }
  } else if (isCompleteWhatsappCommand(input.text?.trim() ?? "")) {
    // Somente um comando completo incompatível substitui a pendência. Rótulos
    // textuais válidos da interação, como "Registrar alimento", são resolvidos
    // acima pela própria entrada do registro.
    const superseded =
      await pendingOperationRepository.supersedePendingOperation(active.id);
    if (superseded.superseded) return null;
    return {
      handled: true,
      action: "clarification_needed",
      reply:
        "Não consegui substituir a operação pendente com segurança. Cancele a ação anterior e envie o novo comando novamente.",
      eventType: "whatsapp.interaction.pending_replacement_blocked",
      detail:
        "Novo comando completo bloqueado porque a pendência anterior não pôde ser marcada como substituída.",
      data: {
        pendingOperationId: active.id,
        pendingType: active.type,
        fallbackBlocked: true,
        interactionLifecycle: "blocked",
      },
    };
  }

  const replay = await rebuildWhatsappRegisteredInteraction(active, {
    timeZone: input.userTimezone,
  });
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
