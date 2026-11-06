import type {
  ConfirmedMealRegistrationOutcome,
  ConfirmedWhatsAppMealRegistrationInput,
} from "./confirmedMealRegistration";
import type { FoodClarificationDependencies } from "./foodClarificationPersistence";
import type { FoodQuantityClarificationService } from "./foodQuantityClarification";
import { getMealMutationPreImage } from "../meals/mealMutationToken";
import { MEAL_UPDATE_SERVICE_OPTIONS } from "../meals/mealUpdateOptions";
import type {
  FoodQuantityClarificationTarget,
  PartialConfirmedTextMealQuantityContext,
  RequestPartialConfirmedTextMealQuantityInput,
} from "./foodQuantityClarificationTypes";
import type { WhatsappIntentResult } from "./intent/types";

type ExistingMeal = Awaited<
  ReturnType<FoodClarificationDependencies["listMeals"]>
>[number];

type ConfirmedTextMealQuantityRequest = Parameters<
  FoodQuantityClarificationService["requestConfirmedTextMealQuantity"]
>[0];

type ConfirmedTextMealPersistenceServices = {
  requestConfirmedTextMealQuantity: (
    input: ConfirmedTextMealQuantityRequest
  ) => Promise<WhatsappIntentResult>;
  requestPartialConfirmedTextMealQuantity: (
    input: RequestPartialConfirmedTextMealQuantityInput
  ) => Promise<WhatsappIntentResult>;
  registerConfirmedTextMeal: (
    input: ConfirmedWhatsAppMealRegistrationInput
  ) => Promise<ConfirmedMealRegistrationOutcome>;
  composeActionReply: (input: {
    userId: number;
    meal: ExistingMeal;
    title: string;
    actionLines: string[];
    registeredAt: Date;
    timeZone: string;
  }) => Promise<string>;
};

export async function advanceConfirmedTextMealQuantity(
  deps: FoodClarificationDependencies,
  userId: number,
  target: FoodQuantityClarificationTarget,
  explicitQuantity: { quantity: number; unit: string } | undefined,
  receivedAt: Date,
  services: ConfirmedTextMealPersistenceServices
) {
  const context = target.resolutionContext;
  if (
    !context ||
    context.mode !== "complete_confirmed_text_meal" ||
    !explicitQuantity
  ) {
    throw new Error("Contexto da refeição textual ou quantidade ausente.");
  }
  const current = context.pendingItems[context.currentPendingIndex];
  if (!current)
    throw new Error("Item pendente da refeição textual não existe.");

  const registrationSegments = [...context.registrationSegments];
  registrationSegments[current.segmentIndex] =
    `${explicitQuantity.quantity} ${explicitQuantity.unit} de ${current.foodName}`;
  const nextPendingIndex = context.currentPendingIndex + 1;
  const nextPending = context.pendingItems[nextPendingIndex];

  if (nextPending) {
    const result = await services.requestConfirmedTextMealQuantity({
      userId,
      foodName: nextPending.foodName,
      originalText: context.originalText,
      registrationSegments,
      pendingItems: context.pendingItems,
      currentPendingIndex: nextPendingIndex,
      resolvedSegments: context.resolvedSegments,
      occurredAt: new Date(context.occurredAt),
      receivedAt,
      userTimezone: context.userTimezone,
      messageId: context.inboundMessageId ?? null,
      instructionText: `Para concluir a refeição sem assumir 100 g para ${nextPending.segment}, informe somente o peso ou volume correspondente, por exemplo 20 g.`,
    });
    if (
      result.eventType !== "whatsapp.food_clarification.requested" ||
      !Number.isSafeInteger(result.data?.pendingOperationId)
    )
      throw new Error("A próxima quantidade da refeição não foi persistida.");
    return result;
  }

  const outcome = await services.registerConfirmedTextMeal({
    userId,
    registrationText: registrationSegments.join("\n"),
    originalText: context.originalText,
    occurredAt: new Date(context.occurredAt),
    receivedAt,
    userTimezone: context.userTimezone,
    inboundMessageId: context.inboundMessageId,
    skipCountablePreflight: true,
    resolvedSegments: context.resolvedSegments,
  });
  if (
    outcome.status === "registered" ||
    outcome.status === "clarification_requested"
  ) {
    return outcome.result;
  }
  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply: outcome.prompt,
    eventType: "whatsapp.food_clarification.confirmed_text_meal_incomplete",
    detail: outcome.detail,
    data: { originalTextPreserved: true },
  };
}

async function requestPartialMealQuantity(
  deps: FoodClarificationDependencies,
  userId: number,
  context: PartialConfirmedTextMealQuantityContext,
  currentPendingIndex: number,
  resolvedQuantities: PartialConfirmedTextMealQuantityContext["resolvedQuantities"],
  receivedAt: Date,
  services: ConfirmedTextMealPersistenceServices
) {
  const current = context.pendingItems[currentPendingIndex];
  if (!current) throw new Error("Item omitido da refeição parcial não existe.");
  const result = await services.requestPartialConfirmedTextMealQuantity({
    userId,
    originalText: context.originalText,
    pendingItems: context.pendingItems,
    currentPendingIndex,
    resolvedQuantities,
    occurredAt: new Date(context.occurredAt),
    receivedAt,
    userTimezone: context.userTimezone,
    messageId: context.inboundMessageId ?? null,
    expectedMealId: context.expectedMealId,
    expectedMealLabel: context.expectedMealLabel,
    expectedMealOccurredAt: context.expectedMealOccurredAt,
    instructionText: `O registro continua parcial. Para incluir ${current.segment}, informe somente o peso ou volume correspondente, por exemplo 20 g.`,
  });
  if (
    result.eventType !== "whatsapp.food_clarification.requested" ||
    !Number.isSafeInteger(result.data?.pendingOperationId)
  ) {
    throw new Error(
      "A próxima quantidade da refeição parcial não foi persistida."
    );
  }
  return {
    ...result,
    data: {
      ...(result.data ?? {}),
      mealId: context.expectedMealId,
      partialRegistration: true,
      omittedItemCount: context.pendingItems.length,
      pendingItemIndex: currentPendingIndex,
    },
  };
}

export async function continuePartialConfirmedTextMealQuantity(
  deps: FoodClarificationDependencies,
  userId: number,
  target: FoodQuantityClarificationTarget,
  explicitQuantity: { quantity: number; unit: string } | undefined,
  receivedAt: Date,
  services: ConfirmedTextMealPersistenceServices
) {
  const resolutionContext = target.resolutionContext;
  if (
    !resolutionContext ||
    resolutionContext.mode !== "complete_partial_confirmed_text_meal" ||
    !explicitQuantity
  ) {
    throw new Error("Contexto do registro parcial ou quantidade ausente.");
  }
  const current =
    resolutionContext.pendingItems[resolutionContext.currentPendingIndex];
  if (!current) throw new Error("Item omitido da refeição parcial não existe.");

  const resolvedQuantities = resolutionContext.resolvedQuantities.map(item =>
    item ? { ...item } : null
  );
  resolvedQuantities[resolutionContext.currentPendingIndex] = {
    quantity: explicitQuantity.quantity,
    unit: explicitQuantity.unit,
  };
  const nextPendingIndex = resolutionContext.currentPendingIndex + 1;
  if (nextPendingIndex < resolutionContext.pendingItems.length) {
    return requestPartialMealQuantity(
      deps,
      userId,
      resolutionContext,
      nextPendingIndex,
      resolvedQuantities,
      receivedAt,
      services
    );
  }

  const meals = await deps.listMeals(userId, { adjustmentRead: true });
  const currentMeal = meals.find(
    meal => meal.id === resolutionContext.expectedMealId
  );
  if (
    !currentMeal ||
    currentMeal.mealLabel !== resolutionContext.expectedMealLabel ||
    new Date(currentMeal.occurredAt).toISOString() !==
      resolutionContext.expectedMealOccurredAt
  ) {
    throw new Error(
      "A refeição parcial mudou antes da conclusão da clarificação."
    );
  }
  const expectedPreImage = getMealMutationPreImage(currentMeal);
  if (!expectedPreImage) {
    throw new Error("A refeição parcial não tem um pre-image CAS verificável.");
  }

  const habits = await deps.getHabits(userId);
  const resolvedItems: NonNullable<ExistingMeal["items"]> = [];
  for (const [index, pending] of resolutionContext.pendingItems.entries()) {
    const quantity = resolvedQuantities[index];
    if (!quantity) {
      throw new Error("Há um item omitido sem quantidade confirmada.");
    }
    const foodName = pending.foodName.trim();
    const brand = pending.brand?.trim();
    const qualifiedFoodName =
      brand && !foodName.toLocaleLowerCase().includes(brand.toLocaleLowerCase())
        ? `${foodName} ${brand}`
        : foodName;
    const processed = await deps.processFood({
      text: `${quantity.quantity} ${quantity.unit} de ${qualifiedFoodName}`,
      habits,
      occurredAt: new Date(resolutionContext.occurredAt),
      timeZone: resolutionContext.userTimezone,
    });
    if (processed.items.length !== 1) {
      throw new Error(
        "A quantidade do item omitido não produziu um único alimento válido."
      );
    }
    resolvedItems.push(processed.items[0]);
  }

  const updateInput = {
    mealId: currentMeal.id,
    mealLabel: currentMeal.mealLabel,
    occurredAt: resolutionContext.expectedMealOccurredAt,
    notes: currentMeal.notes,
    items: [...(currentMeal.items ?? []), ...resolvedItems],
  };
  Object.defineProperty(updateInput, MEAL_UPDATE_SERVICE_OPTIONS, {
    value: { expectedPreImage },
    enumerable: false,
  });
  const updated = await deps.updateMeal(userId, updateInput);
  const reloaded = (await deps.listMeals(userId)).find(
    meal => meal.id === currentMeal.id
  );
  if (!reloaded || reloaded.id !== updated.id) {
    throw new Error(
      "A refeição atualizada não pôde ser recarregada com segurança."
    );
  }

  const reply = await services.composeActionReply({
    userId,
    meal: reloaded,
    title: "Registro parcial concluído",
    actionLines: [
      `Incluí ${resolutionContext.pendingItems.map(item => item.foodName).join(", ")} após confirmar as quantidades informadas.`,
    ],
    registeredAt: receivedAt,
    timeZone: resolutionContext.userTimezone,
  });
  return {
    handled: true as const,
    action: "food_clarification_completed" as const,
    reply,
    eventType:
      "whatsapp.food_clarification.partial_confirmed_text_meal.completed",
    detail:
      "Os itens omitidos foram resolvidos e anexados uma única vez à refeição parcial já persistida; os itens originais não foram recalculados.",
    data: {
      mealId: reloaded.id,
      originalTextPreserved: true,
      originalTextResumed: true,
      partialRegistration: false,
      addedItemCount: resolvedItems.length,
      inboundMessageId: resolutionContext.inboundMessageId ?? null,
    },
  };
}
