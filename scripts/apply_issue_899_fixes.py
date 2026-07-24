from pathlib import Path

ROOT = Path('.')

def replace_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one match, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def append_once(path: str, marker: str, addition: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if marker in text:
        return
    p.write_text(text.rstrip() + '\n\n' + addition.strip() + '\n', encoding='utf-8')

# 1) Canonical confirmed meal registration service.
(ROOT / 'server/modules/whatsapp/confirmedMealRegistration.ts').write_text(r'''import { calculateMealTotals } from "../../../shared/mealTotals";
import {
  confirmPendingMeal,
  createPendingMealInference,
  getHabitSnapshots,
  listUserMeals,
  removeUserMeal,
  updateUserMeal,
} from "../../db";
import {
  MealInferenceError,
  processMealInput,
  type MealProcessingResult,
} from "../../nutritionEngine";
import { consolidateWhatsAppMealAfterSave } from "./mealConsolidationService";
import { getWhatsAppMealGoalProgress } from "./goalProgressService";
import {
  buildWhatsAppConsolidatedMealReplyMessage,
  buildWhatsAppMealReplyMessage,
} from "./replyMessages";
import type { WhatsappIntentResult } from "./intent/types";

export type ConfirmedMealRegistrationOutcome =
  | { status: "registered"; result: WhatsappIntentResult }
  | { status: "details_needed"; prompt: string; detail: string }
  | { status: "safe_to_retry"; prompt: string; detail: string }
  | { status: "blocked_after_possible_mutation"; prompt: string; detail: string };

type ConfirmedMealRegistrationDependencies = {
  processMeal: typeof processMealInput;
  getHabits: typeof getHabitSnapshots;
  createDraft: typeof createPendingMealInference;
  confirmMeal: typeof confirmPendingMeal;
  consolidateMeal: typeof consolidateWhatsAppMealAfterSave;
  getGoalProgress: typeof getWhatsAppMealGoalProgress;
};

const defaultDependencies: ConfirmedMealRegistrationDependencies = {
  processMeal: processMealInput,
  getHabits: getHabitSnapshots,
  createDraft: createPendingMealInference,
  confirmMeal: confirmPendingMeal,
  consolidateMeal: consolidateWhatsAppMealAfterSave,
  getGoalProgress: getWhatsAppMealGoalProgress,
};

function safeClarificationPrompt(error: unknown) {
  if (error instanceof MealInferenceError && error.message.trim()) {
    return error.message.trim();
  }
  return "Não consegui interpretar todos os dados da refeição. Informe somente o detalhe que ficou faltando, como quantidade, peso, volume ou marca.";
}

export function createConfirmedMealRegistrationService(
  overrides: Partial<ConfirmedMealRegistrationDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };

  return async function execute(input: {
    userId: number;
    registrationText: string;
    originalText: string;
    occurredAt: Date;
    userTimezone: string;
  }): Promise<ConfirmedMealRegistrationOutcome> {
    let mutationMayHaveStarted = false;

    try {
      const processed = await deps.processMeal({
        text: input.registrationText,
        habits: await deps.getHabits(input.userId),
        occurredAt: input.occurredAt,
        timeZone: input.userTimezone,
      });

      const draft = deps.createDraft(input.userId, "whatsapp", processed, []);
      mutationMayHaveStarted = true;
      const savedMeal = await deps.confirmMeal({
        draftId: draft.draftId,
        userId: input.userId,
        mealLabel: processed.detectedMealLabel || "Refeição",
        occurredAt: input.occurredAt.toISOString(),
        notes: input.originalText,
        items: processed.items,
      });

      const consolidation = await deps.consolidateMeal(
        { listUserMeals, updateUserMeal, removeUserMeal },
        savedMeal,
        input.userTimezone,
      );
      const replyMeal = consolidation.meal;
      const persistedReplyInput: MealProcessingResult = {
        ...processed,
        sourceText: input.originalText,
        detectedMealLabel: replyMeal.mealLabel,
        items: replyMeal.items ?? [],
        totals: calculateMealTotals(replyMeal.items ?? []),
      };

      let goalProgress: Awaited<ReturnType<typeof getWhatsAppMealGoalProgress>> | undefined;
      try {
        goalProgress = await deps.getGoalProgress(
          input.userId,
          input.occurredAt,
          input.userTimezone,
        );
      } catch {
        goalProgress = undefined;
      }

      const reply = consolidation.action === "updated"
        ? buildWhatsAppConsolidatedMealReplyMessage(replyMeal, {
            registeredAt: input.occurredAt,
            goalProgress,
            timeZone: input.userTimezone,
          })
        : buildWhatsAppMealReplyMessage(persistedReplyInput, {
            registeredAt: input.occurredAt,
            goalProgress,
            timeZone: input.userTimezone,
          });

      return {
        status: "registered",
        result: {
          handled: true,
          action: "meal_item_added",
          reply,
          eventType: "whatsapp.meal_intent_decision.registered",
          detail:
            "Texto original processado pelo pipeline nutricional canônico em modo de consumo confirmado e estado recarregado antes da resposta.",
          data: {
            mealId: replyMeal.id,
            originalTextPreserved: true,
            originalTextResumed: true,
            ambiguityReclassified: false,
          },
        },
      };
    } catch (error) {
      if (mutationMayHaveStarted) {
        return {
          status: "blocked_after_possible_mutation",
          prompt:
            "Não consegui confirmar com segurança o estado final do registro. Para evitar duplicidade, não tente novamente agora. Consulte seus registros e, se a refeição não aparecer, envie a descrição completa em uma nova mensagem.",
          detail:
            "Falha após o início possível da mutação bloqueou retry cego da decisão consumo x sugestão.",
        };
      }

      if (error instanceof MealInferenceError) {
        return {
          status: "details_needed",
          prompt: safeClarificationPrompt(error),
          detail:
            "O pipeline nutricional solicitou somente dados alimentares adicionais antes de qualquer mutação.",
        };
      }

      return {
        status: "safe_to_retry",
        prompt:
          "Não consegui processar a refeição agora, mas sua descrição continua guardada. Tente escolher Registrar novamente em alguns instantes.",
        detail:
          "Falha comprovadamente anterior à mutação permite restaurar a decisão persistente.",
      };
    }
  };
}

export const executeConfirmedWhatsAppMealRegistration =
  createConfirmedMealRegistrationService();
''', encoding='utf-8')

# 2) Persistent open interaction for missing registration details.
(ROOT / 'server/modules/whatsapp/mealIntentRegistrationDetailsInteraction.ts').write_text(r'''import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import { normalizeMealIntentDecisionText } from "./mealIntentDecisionInteraction";
import { normalizeStandaloneWhatsappCommand } from "./standaloneCommandWords";

export const PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE =
  "meal_intent_registration_details";
export const PENDING_MEAL_INTENT_REGISTRATION_DETAILS_ORIGIN =
  "mealIntentRegistrationDetailsInteraction";
export const MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID =
  "meal_intent_decision.registration_details";
const DETAILS_TTL_MS = 10 * 60 * 1000;

export const MEAL_INTENT_REGISTRATION_DETAILS_ACTIONS = [
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const;

export type PendingMealIntentRegistrationDetails = {
  contractVersion: 1;
  interactionId: typeof MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID;
  kind: "meal_intent_registration_details";
  originalText: string;
  registrationText: string;
  normalizedText: string;
  inboundMessageId: string | null;
  prompt: string;
  attempts: number;
  actions: Array<{ id: string; label: string; effect: string }>;
};

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export function isPendingMealIntentRegistrationDetails(
  value: unknown,
): value is PendingMealIntentRegistrationDetails {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingMealIntentRegistrationDetails>;
  return target.contractVersion === 1
    && target.interactionId === MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID
    && target.kind === "meal_intent_registration_details"
    && typeof target.originalText === "string"
    && typeof target.registrationText === "string"
    && typeof target.prompt === "string"
    && typeof target.attempts === "number"
    && Array.isArray(target.actions);
}

export async function createWhatsappMealIntentRegistrationDetailsInteraction(input: {
  userId: number;
  originalText: string;
  registrationText?: string;
  inboundMessageId?: string | null;
  prompt: string;
  attempts?: number;
  receivedAt?: Date;
}) {
  const target: PendingMealIntentRegistrationDetails = {
    contractVersion: 1,
    interactionId: MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID,
    kind: "meal_intent_registration_details",
    originalText: input.originalText.trim(),
    registrationText: (input.registrationText ?? input.originalText).trim(),
    normalizedText: normalizeMealIntentDecisionText(input.originalText),
    inboundMessageId: input.inboundMessageId?.trim() || null,
    prompt: input.prompt.trim(),
    attempts: input.attempts ?? 1,
    actions: [...MEAL_INTENT_REGISTRATION_DETAILS_ACTIONS],
  };
  const created = await repository.createPendingOperation({
    userId: input.userId,
    type: PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE,
    origin: PENDING_MEAL_INTENT_REGISTRATION_DETAILS_ORIGIN,
    target,
    ttlMs: DETAILS_TTL_MS,
    now: input.receivedAt,
  });
  if (!created) return null;
  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply: target.prompt,
    eventType: "whatsapp.meal_intent_decision.registration_details_requested",
    detail:
      "Clarificação alimentar aberta preservou o texto original e solicita somente o dado ainda ausente.",
    data: {
      interactionId: target.interactionId,
      pendingOperationId: created.id,
      pendingType: created.type,
      originalTextPreserved: true,
      interactionClassification: "open",
      interactionComponent: "text",
      interactionLifecycle: "created",
    },
  };
}

function parseDetailsAction(text?: string | null) {
  const normalized = normalizeStandaloneWhatsappCommand(text ?? "");
  if (!normalized) return null;
  if (["cancelar", "cancela", "cancele", "nao", "0"].includes(normalized)) {
    return "cancel" as const;
  }
  if (["registrar", "registrar alimento", "registrar consumo", "registre", "registra"].includes(normalized)) {
    return null;
  }
  return "provide_details" as const;
}

export function classifyMealIntentRegistrationDetailsText(
  target: unknown,
  text?: string | null,
): "resolve" | "invalid" {
  if (!isPendingMealIntentRegistrationDetails(target)) return "invalid";
  return parseDetailsAction(text) ? "resolve" : "invalid";
}

function combineRegistrationText(base: string, details: string) {
  const quantityOnly = /^\s*\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|x[ií]caras?|copos?|colheres?|unidades?|fatias?)\s*$/i;
  return quantityOnly.test(details)
    ? `${details.trim()} de ${base.trim()}`
    : `${base.trim()}. Detalhes adicionais: ${details.trim()}`;
}

async function recreateAfterSafeFailure(input: {
  userId: number;
  target: PendingMealIntentRegistrationDetails;
  registrationText: string;
  prompt: string;
  receivedAt?: Date;
}) {
  return createWhatsappMealIntentRegistrationDetailsInteraction({
    userId: input.userId,
    originalText: input.target.originalText,
    registrationText: input.registrationText,
    inboundMessageId: input.target.inboundMessageId,
    prompt: input.prompt,
    attempts: input.target.attempts + 1,
    receivedAt: input.receivedAt,
  });
}

export async function resolveWhatsappMealIntentRegistrationDetailsText(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  text?: string | null;
  receivedAt?: Date;
  userTimezone: string;
}) {
  const target = input.pendingOperation.target;
  const action = parseDetailsAction(input.text);
  if (!isPendingMealIntentRegistrationDetails(target) || !action) return null;
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE,
    action,
    input.receivedAt,
  );
  if (claim.status !== "claimed") return null;

  if (action === "cancel") {
    return {
      handled: true as const,
      action: "meal_intent_decision_cancelled",
      reply: "Tudo certo. Nada foi registrado.",
      eventType: "whatsapp.meal_intent_decision.registration_details_cancelled",
      detail: "Clarificação alimentar complementar cancelada sem mutação.",
      data: { originalTextPreserved: true },
    };
  }

  const details = input.text?.trim() ?? "";
  const registrationText = combineRegistrationText(target.registrationText, details);
  const outcome = await executeConfirmedWhatsAppMealRegistration({
    userId: input.userId,
    registrationText,
    originalText: target.originalText,
    occurredAt: input.receivedAt ?? new Date(),
    userTimezone: input.userTimezone || DEFAULT_APP_TIME_ZONE,
  });

  if (outcome.status === "registered") {
    return {
      ...outcome.result,
      detail: `${outcome.result.detail} Dados complementares foram combinados ao contexto persistido.`,
      data: {
        ...(outcome.result.data ?? {}),
        supplementalDetailsUsed: true,
      },
    };
  }

  if (outcome.status === "blocked_after_possible_mutation") {
    return {
      handled: true as const,
      action: "clarification_needed" as const,
      reply: outcome.prompt,
      eventType: "whatsapp.meal_intent_decision.registration_blocked_after_mutation",
      detail: outcome.detail,
      data: { retryBlocked: true, originalTextPreserved: true },
    };
  }

  const recreated = await recreateAfterSafeFailure({
    userId: input.userId,
    target,
    registrationText,
    prompt: outcome.prompt,
    receivedAt: input.receivedAt,
  });
  return recreated ?? {
    handled: true as const,
    action: "clarification_needed" as const,
    reply:
      "Não consegui manter os detalhes pendentes com segurança. Nada foi registrado. Envie novamente a descrição completa da refeição.",
    eventType: "whatsapp.meal_intent_decision.registration_details_restore_failed",
    detail: "Falha anterior à mutação não conseguiu recriar a clarificação persistente.",
    data: { retryRequiresFullMessage: true, originalTextPreserved: true },
  };
}

export function rebuildWhatsappMealIntentRegistrationDetails(
  pendingOperation: WhatsAppPendingOperationRecord,
) {
  const target = pendingOperation.target;
  if (!isPendingMealIntentRegistrationDetails(target)) return null;
  return { reply: target.prompt };
}

export async function completeWhatsappMealIntentRegistrationDetailsCallback(input: {
  pendingOperation: WhatsAppPendingOperationRecord;
  action: string;
}) {
  const target = input.pendingOperation.target;
  if (!isPendingMealIntentRegistrationDetails(target) || input.action !== "cancel") {
    return null;
  }
  return {
    handled: true as const,
    action: "meal_intent_decision_cancelled",
    reply: "Tudo certo. Nada foi registrado.",
    eventType: "whatsapp.meal_intent_decision.registration_details_cancelled",
    detail: "Clarificação complementar cancelada por callback sem mutação.",
    data: { originalTextPreserved: true },
  };
}
''', encoding='utf-8')

# 3) Replace decision completion with canonical registration and recovery.
replace_once(
    'server/modules/whatsapp/mealIntentDecisionInteraction.ts',
    'import { getDb, logPersistenceWarning } from "../../db";\n',
    'import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";\nimport { getDb, logPersistenceWarning } from "../../db";\n'
)
replace_once(
    'server/modules/whatsapp/mealIntentDecisionInteraction.ts',
    'import type { WhatsAppLogicalReply } from "./replyContract";\n',
    'import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";\nimport { createWhatsappMealIntentRegistrationDetailsInteraction } from "./mealIntentRegistrationDetailsInteraction";\nimport type { WhatsAppLogicalReply } from "./replyContract";\n'
)
replace_once(
    'server/modules/whatsapp/mealIntentDecisionInteraction.ts',
    '''function isRegistrationContinuation(action?: string) {
  return Boolean(
    action === "meal_item_added" ||
      action?.startsWith("food_clarification_") ||
      action?.startsWith("llm_intent_add_foods_to_meal")
  );
}

''',
    ''
)
old_register = '''  const { executeWhatsappTextIntent } = await import("./intentActions");
  const resumed = await executeWhatsappTextIntent(input.userId, {
    text: target.originalText,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone,
    messageId: target.inboundMessageId,
    entrypoint: "intentClarification.resume",
  });
  if (resumed && isRegistrationContinuation(resumed.action)) {
    return {
      ...resumed,
      detail: `${resumed.detail} Texto original retomado em modo confirmado após a escolha Registrar.`,
      data: {
        ...(resumed.data ?? {}),
        originalTextPreserved: true,
        originalTextResumed: true,
        ambiguityReclassified: false,
      },
    };
  }

  return {
    handled: true as const,
    action: "meal_intent_decision_registration_details_needed",
    reply:
      "Entendi que foi consumo. Para registrar corretamente, informe a quantidade de cada alimento, por exemplo: 100 g de arroz e 1 filé de frango.",
    eventType: "whatsapp.meal_intent_decision.registration_details_needed",
    detail:
      "Escolha Registrar retomou somente o pipeline alimentar confirmado, mas faltaram dados específicos para concluir.",
    data: {
      originalTextPreserved: true,
      originalTextResumed: true,
      ambiguityReclassified: false,
    },
  };
'''
new_register = '''  const outcome = await executeConfirmedWhatsAppMealRegistration({
    userId: input.userId,
    registrationText: target.originalText,
    originalText: target.originalText,
    occurredAt: input.receivedAt ?? new Date(),
    userTimezone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
  });

  if (outcome.status === "registered") {
    return {
      ...outcome.result,
      detail: `${outcome.result.detail} Texto original retomado após a escolha Registrar.`,
      data: {
        ...(outcome.result.data ?? {}),
        originalTextPreserved: true,
        originalTextResumed: true,
        ambiguityReclassified: false,
      },
    };
  }

  if (outcome.status === "details_needed") {
    const details = await createWhatsappMealIntentRegistrationDetailsInteraction({
      userId: input.userId,
      originalText: target.originalText,
      registrationText: target.originalText,
      inboundMessageId: target.inboundMessageId,
      prompt: outcome.prompt,
      receivedAt: input.receivedAt,
    });
    return details ?? {
      handled: true as const,
      action: "clarification_needed" as const,
      reply:
        "Não consegui manter a solicitação de detalhes com segurança. Nada foi registrado. Envie novamente a descrição completa da refeição.",
      eventType: "whatsapp.meal_intent_decision.registration_details_restore_failed",
      detail: "Clarificação alimentar específica não pôde ser persistida.",
      data: { retryRequiresFullMessage: true, originalTextPreserved: true },
    };
  }

  if (outcome.status === "safe_to_retry") {
    const recreated = await pendingOperationRepository.createPendingOperation({
      userId: input.userId,
      type: PENDING_MEAL_INTENT_DECISION_TYPE,
      origin: PENDING_MEAL_INTENT_DECISION_ORIGIN,
      target,
      ttlMs: PENDING_MEAL_INTENT_DECISION_TTL_MS,
      now: input.receivedAt,
    });
    if (recreated) {
      return {
        handled: true as const,
        action: "clarification_needed" as const,
        reply: outcome.prompt,
        eventType: "whatsapp.meal_intent_decision.registration_retry_restored",
        detail: outcome.detail,
        data: {
          pendingOperationId: recreated.id,
          pendingType: recreated.type,
          originalTextPreserved: true,
          interactionId: MEAL_INTENT_DECISION_INTERACTION_ID,
          interactionLifecycle: "created",
        },
        interactiveReply: buildWhatsappMealIntentDecisionReply(
          recreated.id,
          outcome.prompt,
        ),
      };
    }
  }

  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply: outcome.prompt,
    eventType: "whatsapp.meal_intent_decision.registration_blocked_after_mutation",
    detail: outcome.detail,
    data: {
      retryBlocked: outcome.status === "blocked_after_possible_mutation",
      originalTextPreserved: true,
      ambiguityReclassified: false,
    },
  };
'''
replace_once('server/modules/whatsapp/mealIntentDecisionInteraction.ts', old_register, new_register)

# 4) Route LLM ambiguity to the same persistent interaction.
replace_once(
    'server/modules/whatsapp/llmIntentActions.ts',
    'import { createWhatsappIntentClarificationInteraction } from "./intentClarificationInteraction";\n',
    'import { createWhatsappIntentClarificationInteraction } from "./intentClarificationInteraction";\nimport { createWhatsappMealIntentDecisionInteraction } from "./mealIntentDecisionInteraction";\n'
)
old_builder = '''async function buildInteractiveClarification(
  userId: number,
  originalText: string,
  intent: WhatsappInterpretedIntent,
  receivedAt: Date,
): Promise<WhatsappLlmIntentResult> {
  const base = buildClarification(intent);
  if (!base.reply.includes(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE)) return base;

  const interaction = await createWhatsappIntentClarificationInteraction({
    userId,
    originalText,
    bodyText: base.reply,
    receivedAt,
  });
  if (!interaction) return base;

  return {
    ...base,
    detail: `${base.detail} ${interaction.detail}`,
    data: { ...base.data, ...interaction.data },
    interactiveReply: interaction.interactiveReply,
  };
}
'''
new_builder = '''function isMealConsumptionSuggestionAmbiguity(intent: WhatsappInterpretedIntent) {
  return intent.intent === "ambiguous"
    && intent.possibleIntents.length === 2
    && intent.possibleIntents.includes("add_foods_to_meal")
    && intent.possibleIntents.includes("meal_suggestion");
}

async function buildInteractiveClarification(
  userId: number,
  originalText: string,
  intent: WhatsappInterpretedIntent,
  receivedAt: Date,
): Promise<WhatsappLlmIntentResult> {
  const base = buildClarification(intent);

  if (isMealConsumptionSuggestionAmbiguity(intent)) {
    const interaction = await createWhatsappMealIntentDecisionInteraction({
      userId,
      originalText,
      receivedAt,
      confidence: intent.confidence,
      mealLabel: intent.meal?.label ?? null,
    });
    return {
      handled: true,
      action: "clarification_needed",
      reply: interaction.reply,
      eventType: interaction.eventType,
      detail: `${base.detail} ${interaction.detail}`,
      data: { ...base.data, ...interaction.data },
      toolTrace: base.toolTrace,
      interactiveReply: interaction.interactiveReply,
    };
  }

  if (!base.reply.includes(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE)) return base;

  const interaction = await createWhatsappIntentClarificationInteraction({
    userId,
    originalText,
    bodyText: base.reply,
    receivedAt,
  });
  if (!interaction) return base;

  return {
    ...base,
    detail: `${base.detail} ${interaction.detail}`,
    data: { ...base.data, ...interaction.data },
    interactiveReply: interaction.interactiveReply,
  };
}
'''
replace_once('server/modules/whatsapp/llmIntentActions.ts', old_builder, new_builder)

# 5) Make confirmed suggestions visibly use the original food context.
replace_once(
    'server/modules/whatsapp/foodAssistant.ts',
    'function buildAssistantReply(context: AssistantMealContext) {\n',
    'function buildAssistantReply(context: AssistantMealContext, originalText?: string | null) {\n'
)
replace_once(
    'server/modules/whatsapp/foodAssistant.ts',
    '''  return [
    "Sugestão alimentar:",
    "",
    "Posso te ajudar com uma escolha prática. Algumas boas opções:",
''',
    '''  const preservedContext = originalText?.trim()
    ? `Considerei como base os alimentos e o contexto da sua mensagem: ${originalText.trim()}.`
    : null;
  return [
    "Sugestão alimentar:",
    "",
    ...(preservedContext ? [preservedContext, ""] : []),
    "Posso te ajudar com uma escolha prática. Algumas boas opções:",
'''
)
replace_once(
    'server/modules/whatsapp/foodAssistant.ts',
    '''    reply: buildAssistantReply(context),
    eventType: "whatsapp.intent.food_assistant",
    detail: "Orientação alimentar confirmada e respondida pelo WhatsApp sem criar refeição por fallback.",
    data: { context },
''',
    '''    reply: buildAssistantReply(context, text),
    eventType: "whatsapp.intent.food_assistant",
    detail: "Orientação alimentar confirmada usou o contexto original e respondeu sem criar refeição por fallback.",
    data: { context, originalTextUsed: Boolean(normalized) },
'''
)
replace_once(
    'server/modules/whatsapp/foodAssistant.test.ts',
    '    expect(result.data).toEqual({ context: "dinner" });\n    expect(result.reply).toContain("Nada foi registrado como consumo");\n',
    '    expect(result.data).toEqual({ context: "dinner", originalTextUsed: true });\n    expect(result.reply).toContain("arroz, feijão e frango");\n    expect(result.reply).toContain("Nada foi registrado como consumo");\n'
)

# 6) Repository lookup for stale/expired textual aliases.
replace_once(
    'server/repositories/whatsappPendingOperationRepository.ts',
    '''  getActivePendingOperation(
    userId: number,
    now?: Date
  ): Promise<WhatsAppPendingOperationRecord | null>;
''',
    '''  getActivePendingOperation(
    userId: number,
    now?: Date
  ): Promise<WhatsAppPendingOperationRecord | null>;
  getLatestPendingOperation(
    userId: number
  ): Promise<WhatsAppPendingOperationRecord | null>;
'''
)
replace_once(
    'server/repositories/whatsappPendingOperationRepository.ts',
    '''    getById(id: number): WhatsAppPendingOperationRecord | null {
      return fallbackStore.get(id) ?? null;
    },
''',
    '''    getLatest(userId: number): WhatsAppPendingOperationRecord | null {
      return [...fallbackStore.values()]
        .filter(row => row.userId === userId)
        .sort((a, b) => b.id - a.id)[0] ?? null;
    },
    getById(id: number): WhatsAppPendingOperationRecord | null {
      return fallbackStore.get(id) ?? null;
    },
'''
)
repo_anchor = '''    async getPendingOperationById(id) {
      const db = await deps.getDb();
'''
repo_insert = '''    async getLatestPendingOperation(userId) {
      const db = await deps.getDb();
      if (!db) return fallback.getLatest(userId);

      try {
        const [row] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(eq(whatsappPendingOperations.userId, userId))
          .orderBy(desc(whatsappPendingOperations.id))
          .limit(1);
        return row ?? null;
      } catch (error) {
        deps.onWarning("WhatsApp pending operation latest read skipped", error);
        return null;
      }
    },

'''
replace_once('server/repositories/whatsappPendingOperationRepository.ts', repo_anchor, repo_insert + repo_anchor)

# 7) Block stale decision aliases before generic clarification.
replace_once(
    'server/modules/whatsapp/foodClarificationGate.ts',
    'import { createWhatsappIntentClarificationInteraction } from "./intentClarificationInteraction";\n',
    'import { createWhatsappIntentClarificationInteraction } from "./intentClarificationInteraction";\nimport { parseMealIntentDecisionTextAction, PENDING_MEAL_INTENT_DECISION_TYPE } from "./mealIntentDecisionInteraction";\n'
)
old_no_active = '''  if (!active) {
    if (shouldCreateGenericIntentClarification(input.text)) {
'''
new_no_active = '''  if (!active) {
    const latest = await pendingOperationRepository.getLatestPendingOperation(
      input.userId
    );
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
'''
replace_once('server/modules/whatsapp/foodClarificationGate.ts', old_no_active, new_no_active)

# 8) Register the open details interaction centrally.
replace_once(
    'server/modules/whatsapp/interactionRegistry.ts',
    'import {\n  buildMealItemSelectionActions,\n',
    '''import {
  classifyMealIntentRegistrationDetailsText,
  completeWhatsappMealIntentRegistrationDetailsCallback,
  isPendingMealIntentRegistrationDetails,
  PENDING_MEAL_INTENT_REGISTRATION_DETAILS_ORIGIN,
  PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE,
  rebuildWhatsappMealIntentRegistrationDetails,
  resolveWhatsappMealIntentRegistrationDetailsText,
} from "./mealIntentRegistrationDetailsInteraction";
import {
  buildMealItemSelectionActions,
'''
)
replace_once(
    'server/modules/whatsapp/interactionRegistry.ts',
    'export const WHATSAPP_INTERACTION_REGISTRY_VERSION = 5;\n',
    'export const WHATSAPP_INTERACTION_REGISTRY_VERSION = 6;\n'
)
replace_once(
    'server/modules/whatsapp/interactionRegistry.ts',
    '''function rebuildFoodClarification(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
''',
    '''function rebuildMealIntentRegistrationDetails(
  input: WhatsappInteractionReplayInput,
): WhatsappInteractionReplayResult {
  return rebuildWhatsappMealIntentRegistrationDetails(input.pendingOperation);
}

function rebuildFoodClarification(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
'''
)
replace_once(
    'server/modules/whatsapp/interactionRegistry.ts',
    '''function completeMealIntentDecision(input: WhatsappInteractionCallbackInput) {
  return completeWhatsappMealIntentDecisionCallback({
''',
    '''function completeMealIntentRegistrationDetails(
  input: WhatsappInteractionCallbackInput,
) {
  return completeWhatsappMealIntentRegistrationDetailsCallback({
    pendingOperation: input.pendingOperation,
    action: input.action,
  });
}

function completeMealIntentDecision(input: WhatsappInteractionCallbackInput) {
  return completeWhatsappMealIntentDecisionCallback({
'''
)
entry_anchor = '''  {
    id: "intent_clarification.generic",
'''
details_entry = '''  {
    id: "meal_intent_decision.registration_details",
    pendingType: PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE,
    origin: PENDING_MEAL_INTENT_REGISTRATION_DETAILS_ORIGIN,
    entrypoints: ALL_ENTRYPOINTS,
    classification: "open",
    reconstruction: "pending_target",
    invalidResponse: "text_guidance",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["provide_details", "register_original_meal_once", "cancel"],
    forbiddenEffects: ["llm_reinterpretation", "persist_command_word_as_food", "suggestion_as_consumption"],
    matches: isPendingMealIntentRegistrationDetails,
    actions: target => isPendingMealIntentRegistrationDetails(target)
      ? target.actions.map(action => ({ ...action }))
      : [],
    classifyText: classifyMealIntentRegistrationDetailsText,
    resolveText: resolveWhatsappMealIntentRegistrationDetailsText,
    rebuild: rebuildMealIntentRegistrationDetails,
    completeCallback: completeMealIntentRegistrationDetails,
  },
'''
replace_once('server/modules/whatsapp/interactionRegistry.ts', entry_anchor, details_entry + entry_anchor)

# 9) Add focused regression tests.
(ROOT / 'server/modules/whatsapp/confirmedMealRegistration.test.ts').write_text(r'''import { describe, expect, it, vi } from "vitest";

import { MealInferenceError } from "../../nutritionEngine";
import { createConfirmedMealRegistrationService } from "./confirmedMealRegistration";
import { executeWhatsappLlmIntent } from "./llmIntentActions";
import {
  createWhatsappMealIntentDecisionInteraction,
  MEAL_INTENT_DECISION_INTERACTION_ID,
} from "./mealIntentDecisionInteraction";
import { resolveWhatsAppPrecedenceGate } from "./messageRouter";

function processed(text: string) {
  return {
    detectedMealLabel: "Café da manhã",
    sourceText: text,
    transcript: null,
    reasoning: "fixture",
    confidence: 0.98,
    needsConfirmation: false,
    items: [{
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      portionText: "200 ml",
      quantity: 200,
      unit: "ml",
      estimatedGrams: 200,
      calories: 40,
      protein: 0,
      carbs: 10,
      fat: 0,
      fiber: 0,
      source: "manual",
    }],
    totals: { calories: 40, protein: 0, carbs: 10, fat: 0, fiber: 0 },
  } as any;
}

function savedMeal() {
  return {
    id: 89901,
    userId: 899,
    mealLabel: "Café da manhã",
    occurredAt: new Date("2026-07-24T10:00:00.000Z"),
    notes: "200 ml café com açúcar",
    items: processed("200 ml café com açúcar").items,
  } as any;
}

describe("issue #899 orchestration regressions", () => {
  it("persiste 200 ml café com açúcar pelo pipeline canônico após confirmação", async () => {
    const confirmMeal = vi.fn(async () => savedMeal());
    const service = createConfirmedMealRegistrationService({
      processMeal: vi.fn(async input => processed(input.text ?? "")),
      getHabits: vi.fn(async () => []),
      createDraft: vi.fn(() => ({ draftId: "draft-899" } as any)),
      confirmMeal: confirmMeal as any,
      consolidateMeal: vi.fn(async (_deps, meal) => ({ action: "created", meal })) as any,
      getGoalProgress: vi.fn(async () => undefined) as any,
    });

    const result = await service({
      userId: 899,
      registrationText: "200 ml café com açúcar",
      originalText: "200 ml café com açúcar",
      occurredAt: new Date("2026-07-24T10:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.status).toBe("registered");
    expect(confirmMeal).toHaveBeenCalledTimes(1);
    if (result.status !== "registered") throw new Error("unreachable");
    expect(result.result.action).toBe("meal_item_added");
    expect(result.result.data).toEqual(expect.objectContaining({ mealId: 89901 }));
  });

  it("distingue falta de dado antes da mutação de falha após mutação possível", async () => {
    const detailsService = createConfirmedMealRegistrationService({
      processMeal: vi.fn(async () => {
        throw new MealInferenceError("Qual foi a quantidade de açúcar?");
      }),
      getHabits: vi.fn(async () => []),
    });
    const details = await detailsService({
      userId: 899,
      registrationText: "café com açúcar",
      originalText: "café com açúcar",
      occurredAt: new Date(),
      userTimezone: "America/Sao_Paulo",
    });
    expect(details).toEqual(expect.objectContaining({
      status: "details_needed",
      prompt: "Qual foi a quantidade de açúcar?",
    }));

    const blockedService = createConfirmedMealRegistrationService({
      processMeal: vi.fn(async () => processed("200 ml café com açúcar")),
      getHabits: vi.fn(async () => []),
      createDraft: vi.fn(() => ({ draftId: "draft-899" } as any)),
      confirmMeal: vi.fn(async () => {
        throw new Error("connection lost after write");
      }) as any,
    });
    const blocked = await blockedService({
      userId: 899,
      registrationText: "200 ml café com açúcar",
      originalText: "200 ml café com açúcar",
      occurredAt: new Date(),
      userTimezone: "America/Sao_Paulo",
    });
    expect(blocked.status).toBe("blocked_after_possible_mutation");
  });

  it("faz o produtor LLM delegar à mesma pendência persistente", async () => {
    const previous = process.env.OPENAI_WHATSAPP_INTENT_ENABLED;
    process.env.OPENAI_WHATSAPP_INTENT_ENABLED = "false";
    try {
      const result = await executeWhatsappLlmIntent(899200, {
        text: "jantar com arroz e feijão",
        receivedAt: new Date("2026-07-24T20:00:00.000Z"),
        userTimezone: "America/Sao_Paulo",
      });
      expect(result && "handled" in result ? result.eventType : null).toBe(
        "whatsapp.meal_intent_decision.requested",
      );
      expect(result && "handled" in result ? result.data : null).toEqual(
        expect.objectContaining({ interactionId: MEAL_INTENT_DECISION_INTERACTION_ID }),
      );
    } finally {
      if (previous === undefined) delete process.env.OPENAI_WHATSAPP_INTENT_ENABLED;
      else process.env.OPENAI_WHATSAPP_INTENT_ENABLED = previous;
    }
  });

  it("bloqueia alias textual de decisão expirada antes do menu genérico", async () => {
    const createdAt = new Date("2026-07-24T10:00:00.000Z");
    await createWhatsappMealIntentDecisionInteraction({
      userId: 899201,
      originalText: "200 ml café com açúcar",
      receivedAt: createdAt,
    });
    const result = await resolveWhatsAppPrecedenceGate({
      userId: 899201,
      text: "Registrar",
      receivedAt: new Date(createdAt.getTime() + 11 * 60 * 1000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(result.step).toBe("pending_interaction");
    if (result.step !== "pending_interaction") throw new Error("unreachable");
    expect(result.result.eventType).toBe("whatsapp.meal_intent_decision.unavailable");
    expect(result.result.reply).not.toContain("corrigir uma refeição");
  });
});
''', encoding='utf-8')

# Add isolation and suggestion context assertions to existing tests.
append_once(
    'server/modules/whatsapp/mealIntentDecisionInteraction.test.ts',
    'mantém decisões iguais isoladas por usuário',
    r'''describe("mealIntentDecisionInteraction isolation", () => {
  it("mantém decisões iguais isoladas por usuário", async () => {
    const receivedAt = new Date("2026-07-24T22:10:00.000Z");
    await createWhatsappMealIntentDecisionInteraction({
      userId: 899301,
      originalText: "jantar com arroz e feijão",
      receivedAt,
    });
    await createWhatsappMealIntentDecisionInteraction({
      userId: 899302,
      originalText: "jantar com arroz e feijão",
      receivedAt,
    });

    const first = await resolveWhatsAppPrecedenceGate({
      userId: 899301,
      text: "Cancelar",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    const second = await resolveWhatsAppPrecedenceGate({
      userId: 899302,
      text: "talvez",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(first.step).toBe("pending_interaction");
    expect(second.step).toBe("pending_interaction");
    if (second.step !== "pending_interaction") throw new Error("unreachable");
    expect(second.result.eventType).toBe("whatsapp.interaction.pending_represented");
  });
});'''
)

# 10) Documentation aligns with the new successor interaction and failure semantics.
append_once(
    'docs/design-docs/whatsapp-meal-intent-decision.md',
    '## Continuidade após confirmar consumo',
    r'''## Continuidade após confirmar consumo

A ação **Registrar** chama diretamente o pipeline nutricional canônico com o texto original, sem reenviar o rótulo do botão e sem nova classificação consumo x sugestão. O registro usa o mesmo processamento, persistência, consolidação, recarga e formatter do webhook nutricional.

Quando o domínio solicitar um dado alimentar adicional antes de qualquer mutação, a decisão fechada transita para `meal_intent_decision.registration_details`, uma interação aberta persistente. Ela guarda separadamente o texto original e o texto de trabalho, aceita somente o detalhe complementar ou cancelamento e combina uma resposta curta de quantidade ao contexto preservado.

Falha comprovadamente anterior à mutação restaura uma pendência recuperável. Falha depois do início possível da persistência bloqueia retry cego e orienta o usuário a consultar os registros, evitando duplicidade.

Resultados ambíguos produzidos pelo interpretador estruturado também delegam a `createWhatsappMealIntentDecisionInteraction`; nenhum produtor pode enviar a pergunta consumo x sugestão como texto desacoplado da persistência.'''
)

# 11) Remove the temporary automation from the final commit.
for temporary in [
    ROOT / 'scripts/apply_issue_899_fixes.py',
    ROOT / '.github/workflows/orchestrate-899-fixes.yml',
]:
    if temporary.exists():
        temporary.unlink()
