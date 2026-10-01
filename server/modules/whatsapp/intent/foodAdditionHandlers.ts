import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone, zonedDateTimeLocalToIso } from "../../../../shared/timeZone";
import { MealInferenceError } from "../../../nutritionEngine";
import { createWhatsappCoffeeAdditionClarification } from "../coffeeAdditionClarification";
import { createWhatsappMealIntentRegistrationDetailsInteraction } from "../mealIntentRegistrationDetailsInteraction";
import {
  requestWhatsappCaloricComplementQuantityClarification,
  requestWhatsappFoodAdditionQuantityClarification,
} from "../foodQuantityClarification";
import { buildWhatsAppClarificationReplyMessage } from "../replyMessages";
import { buildWhatsAppRecoverableErrorReplyMessage } from "../replyMessages";
import { composeWhatsAppMealActionReply } from "../mealActionReplyComposer";
import { createManualMeal, listMeals, updateMeal } from "../../meals/service";
import { findConfiguredMealSchedule, listMealSchedules } from "../../mealSchedules/service";
import type { MealItemInput } from "../../meals/schemas";
import { formatReplyDate, resolveRelativeOccurredAt } from "./dateTime";
import {
  resolveWhatsappRelativeMealDateSelection,
  type WhatsappRelativeMealDateSelection,
} from "./explicitMealDate";
import {
  resolveCanonicalFoodAdditionItems,
  type CanonicalFoodAdditionItem,
} from "./canonicalFoodAdditionResolution";
import {
  buildCoffeeLorCapsuleItem,
  buildUnsweetenedCoffeeItem,
  findMealByLabel,
  formatAddedItemsList,
  formatTotalsLine,
} from "./mealItemHelpers";
import type { CoffeeAdditionIntent, CoffeeLorCapsuleIntent, ExistingMeal, FoodAdditionIntent, WhatsappIntentResult } from "./types";

type AdditionExecutionContext = {
  originalText?: string;
  receivedAt?: Date;
  messageId?: string | null;
  expectedMealId?: number;
  expectedMealLabel?: string;
  expectedOccurredAt?: string;
  resolvedItems?: CanonicalFoodAdditionItem[];
};

type FoodAdditionItem = FoodAdditionIntent["items"][number];

function buildAdditionFoodText(item: FoodAdditionItem) {
  return item.quantity
    ? `${item.quantity} ${item.unit} de ${item.foodName}`
    : item.foodName;
}

function buildCompleteAdditionFoodText(items: FoodAdditionItem[]) {
  return items.map(buildAdditionFoodText).join(" e ");
}

function normalizeCoffeeAdditionText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatAdditionActionFoodName(item: MealItemInput) {
  const normalizedName = normalizeCoffeeAdditionText(item.foodName);
  return /\bcafe\b/.test(normalizedName) && /\bsem acucar\b/.test(normalizedName)
    ? "café sem açúcar"
    : item.foodName;
}

function formatQuantityResolutionNote(item: CanonicalFoodAdditionItem) {
  const kind = item.quantityResolution?.kind;
  if (kind === "usual_average") {
    return `A gramatura de ${item.foodName} foi estimada pela média usual da mesma medida e os nutrientes foram calculados com essa estimativa. Você pode corrigir depois pelo WhatsApp ou na tela da refeição.`;
  }
  if (kind === "contextual_estimate") {
    return `A gramatura de ${item.foodName} foi estimada de forma contextual para essa medida e os nutrientes foram calculados com essa aproximação. Você pode corrigir depois pelo WhatsApp ou na tela da refeição.`;
  }
  if (kind === "user_learned") {
    return `Usei como aproximação uma referência pessoal anterior que você corrigiu para ${item.foodName}. Você pode corrigir novamente pelo WhatsApp ou na tela da refeição.`;
  }
  return null;
}

/**
 * Falha do motor nutricional é anterior a qualquer mutação. O usuário precisa
 * receber uma resposta controlada — sem prometer registro — em vez de ficar
 * sem retorno nenhum.
 */
function buildNutritionFailureResult(
  item: FoodAdditionIntent["items"][number],
): WhatsappIntentResult {
  const quantityLabel = item.quantity
    ? `${item.quantity} ${item.unit} de ${item.foodName}`
    : item.foodName;
  return {
    handled: true,
    action: "clarification_needed",
    reply: buildWhatsAppRecoverableErrorReplyMessage(
      `Não consegui calcular os nutrientes de ${item.foodName} agora, então nada foi adicionado à refeição. Envie novamente o comando para eu tentar de novo.`,
    ),
    eventType: "whatsapp.food_addition.nutrition_failure",
    detail: `Motor nutricional não materializou ${quantityLabel}; nenhuma mutação foi executada.`,
  };
}

async function resolveAdditionItems(input: {
  userId: number;
  addition: FoodAdditionIntent;
  targetMeal: ExistingMeal;
  timeZone: string;
  context?: AdditionExecutionContext;
}): Promise<
  | { kind: "items"; items: CanonicalFoodAdditionItem[] }
  | { kind: "clarification"; result: WhatsappIntentResult }
> {
  const receivedAt = input.context?.receivedAt ?? input.addition.date;
  const completeFoodText = buildCompleteAdditionFoodText(input.addition.items);

  try {
    const resolution = await resolveCanonicalFoodAdditionItems({
      userId: input.userId,
      addition: input.addition,
      occurredAt: receivedAt,
      timeZone: input.timeZone,
      resolvedItems: input.context?.resolvedItems,
    });
    if (resolution.kind === "items") return resolution;

    if (resolution.kind === "nutrition_failure") {
      return {
        kind: "clarification",
        result: buildNutritionFailureResult(resolution.item),
      };
    }

    if (resolution.kind === "identity_clarification") {
      const result = await createWhatsappMealIntentRegistrationDetailsInteraction({
        userId: input.userId,
        originalText: input.context?.originalText?.trim() || completeFoodText,
        registrationText: completeFoodText,
        inboundMessageId: input.context?.messageId,
        prompt: resolution.message,
        receivedAt,
        foodAdditionContext: {
          addition: {
            mealLabel: input.addition.mealLabel,
            date: input.addition.date.toISOString(),
            items: input.addition.items.map(item => ({ ...item })),
          },
          itemIndex: resolution.itemIndex,
          expectedMealId: input.targetMeal.id,
          expectedMealLabel: input.targetMeal.mealLabel,
          expectedOccurredAt: new Date(input.targetMeal.occurredAt).toISOString(),
          receivedAt: receivedAt.toISOString(),
          userTimezone: input.timeZone,
          clarification: resolution.context,
          resolvedItems: resolution.resolvedItems,
        },
      });
      return {
        kind: "clarification",
        result: result ?? {
          handled: true,
          action: "clarification_needed",
          reply: "Não consegui guardar a pergunta de identidade com segurança. Nada foi alterado. Envie novamente o pedido completo.",
          eventType: "whatsapp.food_addition.identity_clarification.persistence_unavailable",
          detail: "Pendência de identidade da adição não foi persistida; mutação bloqueada.",
        },
      };
    }

    return {
      kind: "clarification",
      result: await requestWhatsappFoodAdditionQuantityClarification({
        userId: input.userId,
        foodName: resolution.item.foodName,
        originalText: input.context?.originalText?.trim() || completeFoodText,
        addition: input.addition,
        itemIndex: resolution.itemIndex,
        expectedMealId: input.targetMeal.id,
        expectedMealLabel: input.targetMeal.mealLabel,
        expectedOccurredAt: new Date(input.targetMeal.occurredAt).toISOString(),
        receivedAt,
        messageId: input.context?.messageId,
        resolvedItems: resolution.resolvedItems,
        instructionText: `Não encontrei uma gramatura verificável nem uma estimativa segura para ${resolution.item.quantity} ${resolution.item.unit} de ${resolution.item.foodName}. Informe somente o peso ou volume correspondente, por exemplo 20 g.`,
      }),
    };
  } catch (error) {
    if (
      error instanceof MealInferenceError
      && error.code === "food_component_quantity_required"
    ) {
      return {
        kind: "clarification",
        result: await requestWhatsappCaloricComplementQuantityClarification({
          userId: input.userId,
          originalFoodText: completeFoodText,
          originalText: input.context?.originalText,
          operation: {
            kind: "add_to_meal",
            mealId: input.targetMeal.id,
            expectedMealLabel: input.targetMeal.mealLabel,
            expectedOccurredAt: new Date(input.targetMeal.occurredAt).toISOString(),
          },
          receivedAt,
          messageId: input.context?.messageId,
        }),
      };
    }
    throw error;
  }
}

/**
 * Adição datada para um rótulo que corresponde a uma refeição habitual ATIVA do
 * usuário: cria a refeição no dia pedido, no horário inicial configurado, com os
 * alimentos resolvidos (#1271).
 *
 * A resolução dos alimentos acontece ANTES da mutação: se algum item exigir
 * esclarecimento de identidade ou quantidade, nada é criado (não existe refeição
 * vazia e nenhum dia é alterado por engano). Rótulo que não corresponde a uma
 * refeição configurada continua fail-closed.
 */
async function createConfiguredDatedMealAddition(input: {
  userId: number;
  addition: FoodAdditionIntent;
  dateSelection: WhatsappRelativeMealDateSelection;
  timeZone: string;
  context?: AdditionExecutionContext;
}): Promise<WhatsappIntentResult | null> {
  if (!input.dateSelection.explicit) return null;

  // Continuação vinculada a um alvo específico mantém o gate de "alvo mudou":
  // se a refeição esperada pela pendência não existe mais, nada é criado.
  if (
    input.context?.expectedMealId
    || input.context?.expectedMealLabel
    || input.context?.expectedOccurredAt
  ) {
    return null;
  }

  const schedule = findConfiguredMealSchedule(
    await listMealSchedules(input.userId),
    input.addition.mealLabel,
  );
  if (!schedule) return null;

  const receivedAt = input.context?.receivedAt ?? input.addition.date;
  const resolution = await resolveCanonicalFoodAdditionItems({
    userId: input.userId,
    addition: input.addition,
    occurredAt: receivedAt,
    timeZone: input.timeZone,
    resolvedItems: input.context?.resolvedItems,
  });
  // Falha do motor precisa chegar ao usuário como resposta controlada; sem isso
  // o pedido cairia na clarificação genérica de refeição inexistente.
  if (resolution.kind === "nutrition_failure") {
    return buildNutritionFailureResult(resolution.item);
  }
  if (resolution.kind !== "items") return null;

  let occurredAt: string;
  try {
    const targetDateKey = getDateKeyInTimeZone(input.dateSelection.date, input.timeZone);
    occurredAt = zonedDateTimeLocalToIso(
      `${targetDateKey}T${schedule.startTime}:00`,
      input.timeZone,
    );
  } catch {
    // Horário configurado inválido ou inexistente no fuso: mantém o
    // esclarecimento seguro em vez de derrubar a mensagem do usuário.
    return null;
  }
  const createdMeal = await createManualMeal(input.userId, {
    mealLabel: schedule.mealLabel,
    occurredAt,
    items: resolution.items,
  });
  const itemCount = resolution.items.length;

  return {
    handled: true,
    action: "meal_item_added",
    reply: await composeWhatsAppMealActionReply({
      userId: input.userId,
      meal: createdMeal,
      timeZone: input.timeZone,
      options: {
        title: itemCount === 1 ? "Alimento adicionado" : "Alimentos adicionados",
        actionLines: [
          `Criei a refeição configurada ${schedule.mealLabel} de ${formatReplyDate(new Date(occurredAt), input.timeZone)} e adicionei ${itemCount} item(ns).`,
        ],
        mealResultState: "registered",
      },
    }),
    eventType: "whatsapp.intent.meal_item_added",
    detail: `${itemCount} alimento(s) adicionados a uma nova refeição criada a partir da configuração habitual ${schedule.mealLabel}.`,
    data: {
      mealId: createdMeal.id,
      mealLabel: schedule.mealLabel,
      occurredAt,
      itemCount,
      explicitDate: true,
      createdFromConfiguredSchedule: true,
      items: resolution.items.map(item => ({
        foodName: item.foodName,
        quantity: item.quantity,
        unit: item.unit,
        estimatedGrams: item.estimatedGrams,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        nutritionSource: item.source,
        quantityResolution: item.quantityResolution,
      })),
    },
  };
}

export async function handleFoodAdditionIntent(
  userId: number,
  addition: FoodAdditionIntent,
  timeZone = DEFAULT_APP_TIME_ZONE,
  context?: AdditionExecutionContext,
): Promise<WhatsappIntentResult> {
  const dateSelection = resolveWhatsappRelativeMealDateSelection({
    text: context?.originalText,
    receivedAt: context?.receivedAt ?? addition.date,
    timeZone,
    fallbackDate: addition.date,
  });
  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(
    meals,
    addition.mealLabel,
    dateSelection.date,
    timeZone,
    { allowCrossDayFallback: !dateSelection.explicit },
  );
  const targetChanged = Boolean(
    targetMeal
      && (
        (context?.expectedMealId && targetMeal.id !== context.expectedMealId)
        || (context?.expectedMealLabel && targetMeal.mealLabel !== context.expectedMealLabel)
        || (
          context?.expectedOccurredAt
          && new Date(targetMeal.occurredAt).toISOString() !== context.expectedOccurredAt
        )
      )
  );
  if (!targetMeal || targetChanged) {
    if (!targetChanged) {
      const configuredMealAddition = await createConfiguredDatedMealAddition({
        userId,
        addition,
        dateSelection,
        timeZone,
        context,
      });
      if (configuredMealAddition) return configuredMealAddition;
    }
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(`Não encontrei a refeição ${addition.mealLabel} em ${formatReplyDate(dateSelection.date, timeZone)}. Me diga em qual refeição devo adicionar ${addition.items[0]?.foodName ?? "o alimento"}.`),
      eventType: "whatsapp.intent.clarification_needed",
      detail: context?.expectedMealId
        ? "A refeição alvo mudou antes da continuação da adição; nenhuma mutação foi executada."
        : dateSelection.explicit
          ? "Pedido para adicionar alimento com data explícita sem refeição compatível no dia indicado; nenhuma mutação foi executada."
          : "Pedido para adicionar alimento sem refeição compatível no dia indicado.",
    };
  }

  const resolution = await resolveAdditionItems({
    userId,
    addition,
    targetMeal,
    timeZone,
    context,
  });
  if (resolution.kind === "clarification") return resolution.result;
  const addedItems = resolution.items;

  const updatedMeal = await updateMeal(userId, {
    mealId: targetMeal.id,
    mealLabel: targetMeal.mealLabel,
    occurredAt: new Date(targetMeal.occurredAt).toISOString(),
    notes: targetMeal.notes,
    items: [...(targetMeal.items ?? []), ...addedItems] as MealItemInput[],
  });

  if (addedItems.length === 1) {
    const addedItem = addedItems[0];
    const estimationLabel = addedItem.source === "catalog" ? "Estimativa com base no catálogo" : "Estimativa";
    const quantityNote = formatQuantityResolutionNote(addedItem);
    return {
      handled: true,
      action: "meal_item_added",
      reply: await composeWhatsAppMealActionReply({
        userId,
        meal: updatedMeal,
        timeZone,
        options: {
          title: "Alimento adicionado",
          actionLines: [
            `Adicionei ${addedItem.portionText} de ${formatAdditionActionFoodName(addedItem)} à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt), timeZone)}. ${estimationLabel}: ${formatTotalsLine(addedItem)}.`,
            ...(quantityNote ? [quantityNote] : []),
          ],
        },
      }),
      eventType: "whatsapp.intent.meal_item_added",
      detail: `Alimento ${addedItem.foodName} adicionado à refeição ${targetMeal.mealLabel} via WhatsApp com data relativa interpretada.`,
      data: {
        mealId: updatedMeal.id,
        mealLabel: targetMeal.mealLabel,
        foodName: addedItem.foodName,
        quantity: addedItem.quantity,
        unit: addedItem.unit,
        estimatedGrams: addedItem.estimatedGrams,
        calories: addedItem.calories,
        protein: addedItem.protein,
        carbs: addedItem.carbs,
        fat: addedItem.fat,
        nutritionSource: addedItem.source,
        quantityResolution: addedItem.quantityResolution,
      },
    };
  }

  const quantityNotes = addedItems
    .map(formatQuantityResolutionNote)
    .filter((value): value is string => Boolean(value));
  return {
    handled: true,
    action: "meal_item_added",
    reply: await composeWhatsAppMealActionReply({
      userId,
      meal: updatedMeal,
      timeZone,
      options: {
        title: "Alimentos adicionados",
        actionLines: [
          `Adicionado à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt), timeZone)}: ${formatAddedItemsList(addedItems)}.`,
          ...quantityNotes,
        ],
      },
    }),
    eventType: "whatsapp.intent.meal_item_added",
    detail: `${addedItems.length} alimentos adicionados à refeição ${targetMeal.mealLabel} via WhatsApp com data relativa interpretada.`,
    data: {
      mealId: updatedMeal.id,
      mealLabel: targetMeal.mealLabel,
      itemCount: addedItems.length,
      items: addedItems.map(item => ({
        foodName: item.foodName,
        quantity: item.quantity,
        unit: item.unit,
        estimatedGrams: item.estimatedGrams,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        nutritionSource: item.source,
        quantityResolution: item.quantityResolution,
      })),
    },
  };
}

function formatCoffeeAdditionQuantity(addition: CoffeeAdditionIntent) {
  const unitLabel = addition.unit === "copo"
    ? (addition.cups === 1 ? "copo" : "copos")
    : (addition.cups === 1 ? "xícara" : "xícaras");
  return `${addition.cups} ${unitLabel}`;
}

function buildCoffeeAdditionMissingFieldsReply(addition: CoffeeAdditionIntent) {
  if (!addition.cups && addition.mealLabel) {
    return {
      reply: buildWhatsAppClarificationReplyMessage(`Entendi que você quer adicionar café sem açúcar à refeição ${addition.mealLabel}. Me diga apenas a quantidade, por exemplo: 3 xícaras.`),
      detail: "Pedido para adicionar café sem açúcar com refeição reconhecida e quantidade ausente.",
    };
  }
  if (addition.cups && !addition.mealLabel) {
    return {
      reply: buildWhatsAppClarificationReplyMessage(`Entendi que você quer adicionar ${formatCoffeeAdditionQuantity(addition)} de café sem açúcar. Me diga apenas a refeição, por exemplo: café da manhã.`),
      detail: "Pedido para adicionar café sem açúcar com quantidade reconhecida e refeição ausente.",
    };
  }
  return {
    reply: buildWhatsAppClarificationReplyMessage("Entendi que você quer adicionar café sem açúcar. Me diga a quantidade e a refeição. Exemplo: adicionar 3 xícaras de café sem açúcar à refeição café da manhã."),
    detail: "Pedido para adicionar café sem açúcar sem quantidade nem refeição explícitas.",
  };
}

export async function handleCoffeeAdditionIntent(userId: number, text: string, addition: CoffeeAdditionIntent, receivedAt: Date, timeZone = DEFAULT_APP_TIME_ZONE): Promise<WhatsappIntentResult> {
  if (!addition.cups || !addition.mealLabel) {
    if (Boolean(addition.cups) !== Boolean(addition.mealLabel)) {
      return createWhatsappCoffeeAdditionClarification({
        userId,
        originalText: text,
        addition,
        receivedAt,
      });
    }
    const clarification = buildCoffeeAdditionMissingFieldsReply(addition);
    return {
      handled: true,
      action: "clarification_needed",
      reply: clarification.reply,
      eventType: "whatsapp.intent.clarification_needed",
      detail: clarification.detail,
    };
  }

  const dateSelection = resolveWhatsappRelativeMealDateSelection({
    text,
    receivedAt,
    timeZone,
    fallbackDate: resolveRelativeOccurredAt(text, receivedAt, timeZone),
  });
  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(
    meals,
    addition.mealLabel,
    dateSelection.date,
    timeZone,
    { allowCrossDayFallback: !dateSelection.explicit },
  );
  if (!targetMeal) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(`Não encontrei a refeição ${addition.mealLabel}. Me diga em qual refeição devo adicionar o café.`),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido para adicionar café sem açúcar sem refeição compatível.",
    };
  }

  const coffeeItem = buildUnsweetenedCoffeeItem(addition.cups, addition.unit ?? "xícara");
  const updatedMeal = await updateMeal(userId, {
    mealId: targetMeal.id,
    mealLabel: targetMeal.mealLabel,
    occurredAt: new Date(targetMeal.occurredAt).toISOString(),
    notes: targetMeal.notes,
    items: [...(targetMeal.items ?? []), coffeeItem] as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_added",
    reply: await composeWhatsAppMealActionReply({
      userId,
      meal: updatedMeal,
      timeZone,
      options: {
        title: "Alimento adicionado",
        actionLines: [
          `Adicionei ${coffeeItem.portionText} de café sem açúcar à refeição ${targetMeal.mealLabel}. Estimativa: ${formatTotalsLine(coffeeItem)}.`,
        ],
      },
    }),
    eventType: "whatsapp.intent.meal_item_added",
    detail: `Café sem açúcar adicionado à refeição ${targetMeal.mealLabel} via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      mealLabel: targetMeal.mealLabel,
      foodName: coffeeItem.foodName,
      cups: addition.cups,
      quantity: coffeeItem.quantity,
      unit: coffeeItem.unit,
      calories: coffeeItem.calories,
    },
  };
}

export async function handleCoffeeLorCapsuleIntent(userId: number, text: string, intent: CoffeeLorCapsuleIntent, receivedAt: Date, timeZone = DEFAULT_APP_TIME_ZONE): Promise<WhatsappIntentResult> {
  let targetMeal: ExistingMeal | undefined;

  if (intent.mealLabel) {
    const dateSelection = resolveWhatsappRelativeMealDateSelection({
      text,
      receivedAt,
      timeZone,
      fallbackDate: resolveRelativeOccurredAt(text, receivedAt, timeZone),
    });
    const meals = await listMeals(userId);
    targetMeal = findMealByLabel(
      meals,
      intent.mealLabel,
      dateSelection.date,
      timeZone,
      { allowCrossDayFallback: !dateSelection.explicit },
    ) ?? undefined;
    if (!targetMeal) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: buildWhatsAppClarificationReplyMessage(`Não encontrei a refeição ${intent.mealLabel}. Me diga em qual refeição devo adicionar o café.`),
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido para adicionar café em cápsula L'Or sem refeição compatível.",
      };
    }
  } else {
    targetMeal = (await listMeals(userId))[0];
    if (!targetMeal) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma refeição recente. Me diga em qual refeição devo adicionar o café."),
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido para adicionar café em cápsula L'Or sem refeição recente.",
      };
    }
  }

  const capsuleItem = buildCoffeeLorCapsuleItem(intent.quantity);
  const updatedMeal = await updateMeal(userId, {
    mealId: targetMeal.id,
    mealLabel: targetMeal.mealLabel,
    occurredAt: new Date(targetMeal.occurredAt).toISOString(),
    notes: targetMeal.notes,
    items: [...(targetMeal.items ?? []), capsuleItem] as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_added",
    reply: await composeWhatsAppMealActionReply({
      userId,
      meal: updatedMeal,
      timeZone,
      options: {
        title: "Alimento adicionado",
        actionLines: [
          `Adicionei ${capsuleItem.portionText} de ${capsuleItem.foodName} à refeição ${targetMeal.mealLabel}. Estimativa: ${formatTotalsLine(capsuleItem)}.`,
        ],
      },
    }),
    eventType: "whatsapp.intent.meal_item_added",
    detail: `Café em cápsula L'Or adicionado à refeição ${targetMeal.mealLabel} via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      mealLabel: targetMeal.mealLabel,
      foodName: capsuleItem.foodName,
      quantity: intent.quantity,
      unit: capsuleItem.unit,
      calories: capsuleItem.calories,
    },
  };
}
