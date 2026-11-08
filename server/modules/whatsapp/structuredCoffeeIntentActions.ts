import { createHash } from "node:crypto";
import { normalizeMeasurementUnit } from "../../../shared/measurementUnits";
import { getDb, getHabitSnapshots, logPersistenceWarning } from "../../db";
import { MealInferenceError, processMealInput, type MealDraftItem } from "../../nutritionEngine";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import { createManualMeal, listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { buildWhatsappAiToolTrace, runWhatsappAiTool, type WhatsappAiToolTrace } from "./aiToolContract";
import {
  classifyWhatsappCoffeePreparation,
  createWhatsappCoffeePreparationClarification,
  qualifyWhatsappCoffeeItem,
  type CoffeePreparationChoice,
  type PendingCoffeePreparationClarification,
} from "./coffeePreparationClarification";
import { requestWhatsappCaloricComplementQuantityClarification } from "./foodQuantityClarification";
import { recordWhatsappIntentAuditLog } from "./intentAuditLog";
import { buildWhatsappIntentContext } from "./intentContext";
import { interpretWhatsappMessageWithDiagnostics, type WhatsappMessageInterpretation } from "./intentInterpreter";
import {
  WHATSAPP_INTENT_CONFIDENCE,
  type WhatsappIntentFoodItem,
  type WhatsappInterpretedIntent,
} from "./intentSchema";
import { validateWhatsappRuntimeIntentForPersistence } from "./intentValidation";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import {
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";
import type { WhatsAppLogicalReply } from "./replyContract";
import { collapseWhitespace, stripDiacritics } from "./webhookUtils";
import { addDaysToZonedDate, getZonedParts, makeDateInTimeZone } from "./intent/dateTime";
import { getWhatsAppUserTimeZone } from "./userMeasurementReplyContext";
import { buildWhatsappExplicitMealTargetMissingClarification } from "./intent/explicitMealTargetGuard";

export type StructuredCoffeeIntentInput = {
  text?: string | null;
  receivedAt?: Date;
  messageId?: string | null;
  userTimezone?: string | null;
};

export type StructuredCoffeeIntentResult = {
  handled: true;
  action: "llm_intent_add_foods_to_meal" | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  toolTrace?: WhatsappAiToolTrace[];
  interactiveReply?: WhatsAppLogicalReply;
};

export type StructuredCoffeePreflightOutcome =
  | { matched: false }
  | { matched: true; result: StructuredCoffeeIntentResult };

type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string;
  items?: MealDraftItem[];
};

type ResolvedIntentDate = {
  date: Date;
  explicit: boolean;
  source: "text" | "intent" | "received_day";
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function normalizeText(value: string) {
  return collapseWhitespace(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/[-_]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " "),
  );
}

function normalizeCoffeeItemText(value: string) {
  return collapseWhitespace(normalizeText(value).replace(/\bcafe da manha\b/g, " "));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function normalizeMealLabel(value: string) {
  const normalized = normalizeText(value);
  if (/(^|\s)(cafe|manha|desjejum)(\s|$)/.test(normalized)) return "Café da manhã";
  if (/\balmoco\b/.test(normalized)) return "Almoço";
  if (/\bjantar\b|\bjanta\b/.test(normalized)) return "Jantar";
  if (/\bceia\b/.test(normalized)) return "Ceia";
  if (/\blanche\b/.test(normalized)) return "Lanche";
  return value.trim();
}

function logicalDayKey(date: Date | number | string, timeZone: string) {
  const parts = getZonedParts(new Date(date), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function isMealInsideDay(meal: ExistingMeal, date: Date, timeZone: string) {
  return logicalDayKey(meal.occurredAt, timeZone) === logicalDayKey(date, timeZone);
}

function shiftLogicalDay(receivedAt: Date, days: number, timeZone: string) {
  return makeDateInTimeZone(
    addDaysToZonedDate(getZonedParts(receivedAt, timeZone), days),
    timeZone,
  );
}

function resolveRelativeDateFromText(text: string, receivedAt: Date, timeZone: string) {
  const normalized = normalizeText(text);
  if (/\banteontem\b/.test(normalized)) return shiftLogicalDay(receivedAt, -2, timeZone);
  if (/\bontem\b/.test(normalized)) return shiftLogicalDay(receivedAt, -1, timeZone);
  if (/\bamanha\b/.test(normalized)) return shiftLogicalDay(receivedAt, 1, timeZone);
  if (/\bhoje\b/.test(normalized)) return receivedAt;
  return null;
}

function resolveIntentDateSelection(
  intent: WhatsappInterpretedIntent,
  receivedAt: Date,
  timeZone: string,
  sourceText: string,
): ResolvedIntentDate {
  const textDate = resolveRelativeDateFromText(sourceText, receivedAt, timeZone);
  if (textDate) return { date: textDate, explicit: true, source: "text" };
  if (!intent.date) return { date: receivedAt, explicit: false, source: "received_day" };
  const normalized = normalizeText(intent.date);
  if (normalized === "hoje") return { date: receivedAt, explicit: true, source: "intent" };
  if (normalized === "ontem") return { date: shiftLogicalDay(receivedAt, -1, timeZone), explicit: true, source: "intent" };
  if (normalized === "anteontem") return { date: shiftLogicalDay(receivedAt, -2, timeZone), explicit: true, source: "intent" };
  if (normalized === "amanha") return { date: shiftLogicalDay(receivedAt, 1, timeZone), explicit: true, source: "intent" };
  const parsed = new Date(intent.date);
  return Number.isNaN(parsed.getTime())
    ? { date: receivedAt, explicit: false, source: "received_day" }
    : { date: parsed, explicit: true, source: "intent" };
}

function findMealByLabel(
  meals: ExistingMeal[],
  label: string,
  date: Date,
  timeZone: string,
  allowCrossDayFallback: boolean,
) {
  const normalizedLabel = normalizeText(normalizeMealLabel(label));
  return meals.find(meal =>
    normalizeText(meal.mealLabel) === normalizedLabel
      && isMealInsideDay(meal, date, timeZone))
    ?? (allowCrossDayFallback
      ? meals.find(meal => normalizeText(meal.mealLabel) === normalizedLabel)
      : null)
    ?? null;
}

function toMealItemInput(item: MealDraftItem): MealItemInput {
  const quantityUnit = item as MealDraftItem & Partial<Pick<MealItemInput, "quantity" | "unit" | "brand">>;
  return {
    ...item,
    ...(quantityUnit.brand ? { brand: quantityUnit.brand } : {}),
    quantity: quantityUnit.quantity ?? item.servings,
    unit: quantityUnit.unit?.trim() || "porção",
  };
}

function buildItemText(item: WhatsappIntentFoodItem) {
  const foodName = [item.foodName, item.preparation].filter(Boolean).join(" ").trim();
  if (item.quantity && item.unit) {
    return `${formatNumber(item.quantity)} ${normalizeMeasurementUnit(item.unit)} de ${foodName}`;
  }
  if (item.quantity) return `${formatNumber(item.quantity)} de ${foodName}`;
  return foodName;
}

function buildFoodBatchText(items: WhatsappIntentFoodItem[]) {
  return items.map(buildItemText).join(" e ");
}

function buildResumableFoodText(items: WhatsappIntentFoodItem[], mealLabel: string) {
  return `${buildFoodBatchText(items)} na refeição ${mealLabel}`;
}

function buildIdempotencyKey(
  userId: number,
  text: string,
  receivedAt: Date,
  messageId?: string | null,
) {
  const source = messageId?.trim() || `${userId}:${receivedAt.toISOString()}:${normalizeText(text)}`;
  return createHash("sha256").update(source).digest("hex");
}

function hasCoffeeItemSignal(text: string) {
  return /\bcafe\b/.test(normalizeCoffeeItemText(text));
}

function hasExplicitCoffeeSugarStatus(text: string) {
  const normalized = normalizeCoffeeItemText(text);
  return /\bcafe\b[^,.;]*\b(?:sem acucar|com acucar|puro|preto|natural|adocado|acucarado)\b/.test(normalized);
}

function hasExplicitCoffeeCaloricComplement(text: string) {
  const normalized = normalizeCoffeeItemText(text);
  return /\bcafe\b[^,.;]*\b(?:leite|mel|creme|chantilly|condensad[oa]|chocolate|cacau)\b/.test(normalized);
}

function isGenericCoffeeText(text: string) {
  return hasCoffeeItemSignal(text)
    && !hasExplicitCoffeeSugarStatus(text)
    && !hasExplicitCoffeeCaloricComplement(text);
}

function isSugarQuantityRequired(error: unknown) {
  if (!(error instanceof MealInferenceError)) return false;
  const candidate = error as MealInferenceError & {
    code?: string;
    context?: { component?: string };
  };
  return candidate.code === "food_component_quantity_required"
    && (!candidate.context?.component || candidate.context.component === "açúcar");
}

function clarificationResult(input: {
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
  intent?: WhatsappInterpretedIntent;
}): StructuredCoffeeIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: input.reply,
    eventType: input.eventType,
    detail: input.detail,
    ...(input.data ? { data: input.data } : {}),
    ...(input.interactiveReply ? { interactiveReply: input.interactiveReply } : {}),
    ...(input.intent
      ? {
          toolTrace: [buildWhatsappAiToolTrace({
            toolId: "clarification_request",
            intent: input.intent.intent,
            outcome: "success",
            parameterSummary: {
              intent: input.intent.intent,
              confidence: Number(input.intent.confidence.toFixed(2)),
              reason: "coffee_preparation",
            },
          })],
        }
      : {}),
  };
}

function recordIntentAudit(input: {
  userId: number;
  text: string;
  interpretation: WhatsappMessageInterpretation;
  result: StructuredCoffeeIntentResult;
}) {
  recordWhatsappIntentAuditLog({
    userId: input.userId,
    messageText: input.text,
    intent: input.interpretation.intent,
    validationStatus: input.interpretation.validationStatus,
    action: input.result.action,
    replyKind: input.result.action === "clarification_needed" ? "clarification" : "executed",
    operationalTrace: input.interpretation.operationalTrace,
    toolTrace: input.result.toolTrace ?? [],
    fallbackReason: input.interpretation.fallbackReason,
    errorCode: input.interpretation.errorCode,
  });
}

async function requestPreparationClarification(input: {
  userId: number;
  text: string;
  receivedAt: Date;
  messageId?: string | null;
  timeZone: string;
  intent: WhatsappInterpretedIntent;
  mealLabel: string;
  ambiguousItemIndexes: number[];
}) {
  const created = await createWhatsappCoffeePreparationClarification({
    userId: input.userId,
    originalText: input.text,
    receivedAt: input.receivedAt,
    messageId: input.messageId,
    userTimezone: input.timeZone,
    mealLabel: input.mealLabel,
    createIfMissing: Boolean(input.intent.meal?.createIfMissing),
    intentDate: input.intent.date ?? null,
    items: input.intent.items,
    ambiguousItemIndexes: input.ambiguousItemIndexes,
  });
  if (!created) {
    return clarificationResult({
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui guardar a pergunta sobre o preparo do café. Nada foi registrado; envie a mensagem completa novamente.",
      ),
      eventType: "whatsapp.coffee_preparation_clarification.persistence_unavailable",
      detail: "Clarificação de preparo não pôde ser criada antes do outbound.",
      intent: input.intent,
    });
  }
  return clarificationResult({
    reply: created.reply,
    eventType: created.eventType,
    detail: created.detail,
    data: created.data,
    interactiveReply: created.interactiveReply,
    intent: input.intent,
  });
}

async function executeResolvedCoffeeAddition(input: {
  userId: number;
  text: string;
  receivedAt: Date;
  messageId?: string | null;
  timeZone: string;
  intent: WhatsappInterpretedIntent;
  preparationChoice?: CoffeePreparationChoice;
}): Promise<StructuredCoffeeIntentResult | null> {
  if (!input.intent.meal?.label || !input.intent.items.length) return null;
  const mealLabel = normalizeMealLabel(input.intent.meal.label);
  const targetDate = resolveIntentDateSelection(
    input.intent,
    input.receivedAt,
    input.timeZone,
    input.text,
  );
  const effectiveItems = input.intent.items.map(item =>
    input.preparationChoice
      ? qualifyWhatsappCoffeeItem(item, input.preparationChoice)
      : { ...item },
  );
  const toolTrace: WhatsappAiToolTrace[] = [];

  const mealsResult = await runWhatsappAiTool({
    toolId: "meal_records_list",
    intent: "add_foods_to_meal",
    outcome: "success",
    parameterSummary: {
      dateWindow: targetDate.explicit ? targetDate.source : "received_day",
      mealLabel,
      coffeePreparationResolved: true,
    },
  }, () => listMeals(input.userId));
  toolTrace.push(mealsResult.trace);
  if (!mealsResult.result) {
    return clarificationResult({
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui consultar suas refeições antes de concluir o café. Nada foi registrado.",
      ),
      eventType: "whatsapp.coffee_preparation_clarification.target_lookup_failed",
      detail: "Consulta da refeição-alvo falhou antes de qualquer mutação.",
      intent: input.intent,
    });
  }

  const existingMeal = findMealByLabel(
    mealsResult.result,
    mealLabel,
    targetDate.date,
    input.timeZone,
    !targetDate.explicit,
  );
  if (!existingMeal && targetDate.explicit) {
    return clarificationResult({
      ...buildWhatsappExplicitMealTargetMissingClarification({
        mealLabel,
        targetDate: targetDate.date,
        timeZone: input.timeZone,
        eventType: "whatsapp.coffee_preparation_clarification.target_missing_for_explicit_date",
        detail: "Café com data explícita bloqueado porque a refeição indicada não existe no dia interpretado.",
      }),
      intent: input.intent,
    });
  }
  if (!existingMeal && !input.intent.meal.createIfMissing) return null;

  let processed: Awaited<ReturnType<typeof processMealInput>>;
  try {
    processed = await processMealInput({
      text: buildFoodBatchText(effectiveItems),
      habits: await getHabitSnapshots(input.userId),
      occurredAt: targetDate.date,
      timeZone: input.timeZone,
    });
  } catch (error) {
    if (!isSugarQuantityRequired(error)) {
      return clarificationResult({
        reply: buildWhatsAppRecoverableErrorReplyMessage(
          "Não consegui resolver a composição do café com segurança. Nada foi registrado; envie a descrição completa novamente.",
        ),
        eventType: "whatsapp.coffee_preparation_clarification.nutrition_resolution_failed",
        detail: "Motor nutricional não produziu composição coerente antes da mutação.",
        intent: input.intent,
      });
    }

    const sugarClarification = await requestWhatsappCaloricComplementQuantityClarification({
      userId: input.userId,
      originalFoodText: buildResumableFoodText(effectiveItems, mealLabel),
      originalText: input.text,
      operation: existingMeal
        ? {
            kind: "add_to_meal",
            mealId: existingMeal.id,
            expectedMealLabel: existingMeal.mealLabel,
            expectedOccurredAt: new Date(existingMeal.occurredAt).toISOString(),
          }
        : {
            kind: "register",
            occurredAt: targetDate.date.toISOString(),
          },
      receivedAt: input.receivedAt,
      messageId: input.messageId,
    });
    return clarificationResult({
      reply: sugarClarification.reply,
      eventType: sugarClarification.eventType,
      detail: `${sugarClarification.detail} Contexto de preparo do café já foi resolvido e preservado.`,
      data: {
        ...(sugarClarification.data ?? {}),
        coffeePreparationResolved: true,
        preservedMealLabel: mealLabel,
        preservedTargetDate: targetDate.date.toISOString(),
      },
      interactiveReply: sugarClarification.interactiveReply,
      intent: input.intent,
    });
  }

  if (processed.items.length < effectiveItems.length) {
    return clarificationResult({
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui preservar todos os alimentos da mensagem junto com o café. Nada foi registrado; envie a descrição completa novamente.",
      ),
      eventType: "whatsapp.coffee_preparation_clarification.companion_items_incomplete",
      detail: "A resolução nutricional perdeu itens acompanhantes e foi bloqueada antes da mutação.",
      intent: input.intent,
    });
  }

  const addedItems = processed.items.map(toMealItemInput);
  toolTrace.push(buildWhatsappAiToolTrace({
    toolId: "meal_item_nutrition_simulate",
    intent: "add_foods_to_meal",
    backendValidated: true,
    outcome: "success",
    parameterSummary: {
      itemCount: addedItems.length,
      coffeePreparationResolved: true,
      heuristicCoffeeFallbackBlocked: true,
    },
  }));
  const idempotencyKey = buildIdempotencyKey(
    input.userId,
    input.text,
    input.receivedAt,
    input.messageId,
  );
  const mealResult = existingMeal
    ? await runWhatsappAiTool({
        toolId: "meal_record_update",
        intent: "add_foods_to_meal",
        backendValidated: true,
        idempotencyKey,
        outcome: "success",
        parameterSummary: { mealId: existingMeal.id, itemCount: addedItems.length },
      }, () => updateMeal(input.userId, {
        mealId: existingMeal.id,
        mealLabel: existingMeal.mealLabel,
        occurredAt: new Date(existingMeal.occurredAt).toISOString(),
        notes: existingMeal.notes,
        items: [...(existingMeal.items ?? []), ...addedItems] as MealItemInput[],
      }))
    : await runWhatsappAiTool({
        toolId: "meal_record_create",
        intent: "add_foods_to_meal",
        backendValidated: true,
        idempotencyKey,
        outcome: "success",
        parameterSummary: {
          mealLabel,
          itemCount: addedItems.length,
          occurredAt: targetDate.date.toISOString(),
        },
      }, () => createManualMeal(input.userId, {
        mealLabel,
        occurredAt: targetDate.date.toISOString(),
        notes: "Criada automaticamente pelo interpretador estruturado do WhatsApp.",
        items: addedItems,
      }));
  toolTrace.push(mealResult.trace);
  if (!mealResult.result) {
    return clarificationResult({
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui salvar a refeição depois de resolver o preparo do café. Consulte seus registros antes de tentar novamente para evitar duplicidade.",
      ),
      eventType: "whatsapp.coffee_preparation_clarification.persistence_failed",
      detail: "Falha de persistência após resolução nutricional bloqueou retry cego.",
      intent: input.intent,
    });
  }

  const meal = mealResult.result;
  return {
    handled: true,
    action: "llm_intent_add_foods_to_meal",
    reply: await composeWhatsAppMealActionReply({
      userId: input.userId,
      meal,
      timeZone: input.timeZone,
      options: {
        title: addedItems.length === 1 ? "Alimento adicionado" : "Alimentos adicionados",
        actionLines: [
          `Adicionado a ${meal.mealLabel}: ${addedItems.map(item => `${item.portionText} de ${item.foodName}`).join(", ")}.`,
        ],
      },
    }),
    eventType: "whatsapp.llm_intent.add_foods_to_meal",
    detail: existingMeal
      ? "Café com preparo resolvido e alimentos acompanhantes adicionados à refeição existente."
      : "Café com preparo resolvido e alimentos acompanhantes registrados na refeição criada.",
    data: {
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      createdMeal: !existingMeal,
      itemCount: addedItems.length,
      coffeePreparationResolved: true,
      heuristicCoffeeFallbackBlocked: true,
    },
    toolTrace,
  };
}

async function interpretForCoffeePreflight(
  userId: number,
  text: string,
  receivedAt: Date,
  timeZone: string,
) {
  const activePendingOperation = await pendingOperationRepository.getActivePendingOperation(
    userId,
    receivedAt,
  );
  const pendingClarification = activePendingOperation
    ? { kind: activePendingOperation.type, originalIntent: activePendingOperation.origin }
    : null;
  const context = await buildWhatsappIntentContext(userId, {
    receivedAt,
    pendingClarification,
    timeZone,
  });
  return interpretWhatsappMessageWithDiagnostics(text, context);
}

export async function tryExecuteWhatsappStructuredCoffeeIntent(
  userId: number,
  input: StructuredCoffeeIntentInput,
): Promise<StructuredCoffeePreflightOutcome> {
  const text = input.text?.trim();
  if (!text || !hasCoffeeItemSignal(text)) return { matched: false };

  const receivedAt = input.receivedAt ?? new Date();
  const timeZone = input.userTimezone ?? await getWhatsAppUserTimeZone(userId);
  const interpretation = await interpretForCoffeePreflight(userId, text, receivedAt, timeZone);
  const intent = interpretation.intent;
  const coffeeClassifications = intent.items.map(classifyWhatsappCoffeePreparation);
  const relevantCoffeeIndexes = coffeeClassifications
    .map((classification, index) => classification === "other" ? -1 : index)
    .filter(index => index >= 0);

  if (
    intent.intent !== "add_foods_to_meal"
    || !intent.meal?.label
    || !relevantCoffeeIndexes.length
    || intent.confidence < WHATSAPP_INTENT_CONFIDENCE.clarify
  ) {
    if (!isGenericCoffeeText(text)) return { matched: false };
    const result = clarificationResult({
      reply: buildWhatsAppClarificationReplyMessage(
        "O preparo do café ficou ambíguo e eu não consegui preservar o destino com segurança. Envie novamente a mensagem completa informando a refeição; não vou assumir calorias para o café genérico.",
      ),
      eventType: "whatsapp.coffee_preparation_clarification.incomplete_context",
      detail: "Café genérico foi bloqueado antes do fallback nutricional porque o contexto estruturado não estava completo.",
      intent,
    });
    recordIntentAudit({ userId, text, interpretation, result });
    return { matched: true, result };
  }

  const validation = validateWhatsappRuntimeIntentForPersistence({
    intent,
    validationStatus: interpretation.validationStatus,
  });
  if (!validation.valid) return { matched: false };

  const ambiguousItemIndexes = coffeeClassifications
    .map((classification, index) => classification === "ambiguous" ? index : -1)
    .filter(index => index >= 0);
  if (ambiguousItemIndexes.length) {
    const result = await requestPreparationClarification({
      userId,
      text,
      receivedAt,
      messageId: input.messageId,
      timeZone,
      intent,
      mealLabel: normalizeMealLabel(intent.meal.label),
      ambiguousItemIndexes,
    });
    recordIntentAudit({ userId, text, interpretation, result });
    return { matched: true, result };
  }

  const hasQualifiedCoffee = coffeeClassifications.some(classification =>
    classification === "without_sugar" || classification === "with_sugar");
  if (!hasQualifiedCoffee) return { matched: false };

  const result = await executeResolvedCoffeeAddition({
    userId,
    text,
    receivedAt,
    messageId: input.messageId,
    timeZone,
    intent,
  });
  if (!result) return { matched: false };
  recordIntentAudit({ userId, text, interpretation, result });
  return { matched: true, result };
}

export async function resumeWhatsappStructuredCoffeePreparation(input: {
  userId: number;
  target: PendingCoffeePreparationClarification;
  choice: CoffeePreparationChoice;
  receivedAt?: Date;
  userTimezone?: string | null;
}): Promise<StructuredCoffeeIntentResult | null> {
  const parsedOriginalReceivedAt = new Date(input.target.originalReceivedAt);
  const originalReceivedAt = Number.isFinite(parsedOriginalReceivedAt.getTime())
    ? parsedOriginalReceivedAt
    : (input.receivedAt ?? new Date());
  const timeZone = input.target.userTimezone
    || input.userTimezone
    || await getWhatsAppUserTimeZone(input.userId);
  const intent: WhatsappInterpretedIntent = {
    intent: "add_foods_to_meal",
    confidence: 1,
    date: input.target.intentDate,
    meal: {
      label: input.target.mealLabel,
      createIfMissing: input.target.createIfMissing,
    },
    items: input.target.items.map(item => ({ ...item })),
    sourceFood: null,
    targetFood: null,
    quantity: null,
    requiresConfirmation: false,
    clarificationQuestion: null,
    possibleIntents: [],
    reason: "Retomada de clarificação persistente do preparo do café.",
  };

  return executeResolvedCoffeeAddition({
    userId: input.userId,
    text: input.target.originalText,
    receivedAt: originalReceivedAt,
    messageId: input.target.inboundMessageId,
    timeZone,
    intent,
    preparationChoice: input.choice,
  });
}
