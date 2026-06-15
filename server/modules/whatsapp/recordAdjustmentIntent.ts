import { listMeals } from "../meals/service";

type WhatsappRecordAdjustmentInput = {
  text?: string | null;
  receivedAt?: Date;
};

type WhatsappRecordAdjustmentResult = {
  handled: true;
  action:
    | "record_adjustment_confirmation_needed"
    | "record_adjustment_selection_needed"
    | "record_adjustment_clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

type ExistingMeal = Awaited<ReturnType<typeof listMeals>>[number];
type ExistingMealItem = NonNullable<ExistingMeal["items"]>[number];

type ClarificationOption = {
  id: string;
  label: string;
  value: Record<string, unknown>;
};

type AdjustmentIntent =
  | { kind: "quantity"; quantity: number; unit: string }
  | { kind: "replace_item"; sourceFood: string; targetFood: string }
  | { kind: "remove_item"; targetFood: string }
  | { kind: "remove_last_meal" }
  | { kind: "incomplete"; reason: string };

const RECENT_ADJUSTMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function formatMealDate(value: ExistingMeal["occurredAt"]) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function getItemName(item: ExistingMealItem) {
  return item.foodName || item.canonicalName || "item";
}

function buildOptionsPrompt(question: string, options: ClarificationOption[]) {
  return [
    question,
    "",
    ...options.map((option, index) => `${index + 1}. ${option.label}`),
    "",
    "Responda com o número da opção.",
  ].join("\n");
}

function getRecentMeals(meals: ExistingMeal[], receivedAt: Date) {
  const now = receivedAt.getTime();
  return meals
    .filter(meal => {
      const occurredAt = new Date(meal.occurredAt).getTime();
      return Number.isFinite(occurredAt) && occurredAt <= now && now - occurredAt <= RECENT_ADJUSTMENT_WINDOW_MS;
    })
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

function detectAdjustmentIntent(text: string): AdjustmentIntent | null {
  const trimmed = text.trim();
  const normalized = normalizeText(trimmed);

  if (/^(?:apaga|apagar|remove|remover|exclui|excluir)\s+(?:o\s+|a\s+)?(?:ultimo|ultima)$/.test(normalized)) {
    return { kind: "remove_last_meal" };
  }

  if (/^(?:corrige|corrigir|altera|alterar|ajusta|ajustar|troca|trocar|remove|remover|apaga|apagar|exclui|excluir)\s+(?:isso|esse|essa|ultimo|ultima)$/.test(normalized)) {
    return { kind: "incomplete", reason: "missing_target" };
  }

  const quantityMatch = /^(?:era|corrige(?:\s+(?:para|pra))?|corrigir(?:\s+(?:para|pra))?|ajusta(?:\s+(?:para|pra))?|ajustar(?:\s+(?:para|pra))?)\s+(\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|ml|l|un|unidade|unidades|fatia|fatias|porcao|porcoes|porção|porções)$/iu.exec(trimmed);
  if (quantityMatch) {
    return {
      kind: "quantity",
      quantity: Number(quantityMatch[1].replace(",", ".")),
      unit: quantityMatch[2].toLowerCase(),
    };
  }

  const replaceMatch = /^(?:troca|trocar|substitui|substituir|nao\s+(?:e|era)|não\s+(?:é|era))\s+(.+?)\s+(?:por|pelo|pela|e\s+sim|é|e)\s+(.+)$/iu.exec(trimmed);
  if (replaceMatch) {
    return {
      kind: "replace_item",
      sourceFood: replaceMatch[1].trim(),
      targetFood: replaceMatch[2].trim(),
    };
  }

  const removeMealMatch = /^(?:apaga|apagar|remove|remover|exclui|excluir)\s+(?:a\s+)?(?:refeicao|refeição|ultima\s+refeicao|última\s+refeição|ultimo\s+lancamento|último\s+lançamento)$/iu.exec(trimmed);
  if (removeMealMatch) {
    return { kind: "remove_last_meal" };
  }

  const removeItemMatch = /^(?:remove|remover|apaga|apagar|exclui|excluir)\s+(?:o\s+|a\s+|um\s+|uma\s+)?(.+)$/iu.exec(trimmed);
  if (removeItemMatch) {
    const targetFood = removeItemMatch[1].trim();
    if (targetFood) return { kind: "remove_item", targetFood };
  }

  return null;
}

function itemMatchScore(item: ExistingMealItem, targetFood: string) {
  const target = normalizeText(targetFood);
  const itemText = normalizeText(`${item.foodName ?? ""} ${item.canonicalName ?? ""}`);
  if (!target || !itemText) return 0;
  if (itemText === target) return 4;
  if (itemText.includes(target) || target.includes(normalizeText(getItemName(item)))) return 3;

  const targetWords = new Set(target.split(" ").filter(Boolean));
  const itemWords = new Set(itemText.split(" ").filter(Boolean));
  const overlap = [...targetWords].filter(word => itemWords.has(word)).length;
  return overlap >= Math.max(1, Math.min(2, targetWords.size)) ? overlap : 0;
}

function findItemCandidates(meals: ExistingMeal[], targetFood: string) {
  return meals.flatMap(meal => (meal.items ?? [])
    .map((item, itemIndex) => ({ meal, item, itemIndex, score: itemMatchScore(item, targetFood) }))
    .filter(candidate => candidate.score > 0))
    .sort((a, b) => b.score - a.score || new Date(b.meal.occurredAt).getTime() - new Date(a.meal.occurredAt).getTime());
}

function buildNoRecentMealResponse(intent: AdjustmentIntent): WhatsappRecordAdjustmentResult {
  return {
    handled: true,
    action: "record_adjustment_clarification_needed",
    reply: "Nao encontrei uma refeicao recente segura para ajustar. Me diga qual refeicao e qual item devo alterar.",
    eventType: "whatsapp.records.adjustment_clarification_needed",
    detail: `Comando de ajuste ${intent.kind} sem refeicao recente dentro da janela segura.`,
    data: { adjustmentKind: intent.kind, recentWindowHours: 24 },
  };
}

function buildOptionsResponse(targetFood: string, candidates: ReturnType<typeof findItemCandidates>, kind: AdjustmentIntent["kind"]): WhatsappRecordAdjustmentResult {
  const options: ClarificationOption[] = candidates.slice(0, 5).map((candidate, index) => ({
    id: `${candidate.meal.id}:${candidate.itemIndex}`,
    label: `${getItemName(candidate.item)} em ${candidate.meal.mealLabel} (${formatMealDate(candidate.meal.occurredAt)})`,
    value: {
      mealId: candidate.meal.id,
      mealLabel: candidate.meal.mealLabel,
      itemIndex: candidate.itemIndex,
      itemName: getItemName(candidate.item),
    },
  }));
  return {
    handled: true,
    action: "record_adjustment_selection_needed",
    reply: buildOptionsPrompt(`Encontrei mais de um item possivel para "${targetFood}". Qual deles devo usar?`, options),
    eventType: "whatsapp.records.adjustment_selection_needed",
    detail: "Comando de ajuste encontrou multiplos alvos possiveis e abriu selecao segura.",
    data: {
      adjustmentKind: kind,
      targetFood,
      optionCount: options.length,
      options,
    },
  };
}

function buildMissingTargetResponse(intent: AdjustmentIntent): WhatsappRecordAdjustmentResult {
  return {
    handled: true,
    action: "record_adjustment_clarification_needed",
    reply: "Preciso saber qual item ou refeicao voce quer ajustar. Exemplo: troque arroz por arroz integral, ou corrija para 150 g.",
    eventType: "whatsapp.records.adjustment_clarification_needed",
    detail: `Comando de ajuste ${intent.kind} sem alvo suficiente.`,
    data: { adjustmentKind: intent.kind },
  };
}

function buildQuantityConfirmation(meal: ExistingMeal, item: ExistingMealItem, quantity: number, unit: string): WhatsappRecordAdjustmentResult {
  return {
    handled: true,
    action: "record_adjustment_confirmation_needed",
    reply: `Confirme antes de eu alterar: ajustar ${getItemName(item)} em ${meal.mealLabel} (${formatMealDate(meal.occurredAt)}) para ${formatNumber(quantity)} ${unit}?`,
    eventType: "whatsapp.records.adjustment_confirmation_needed",
    detail: "Correcao de quantidade com alvo unico exige confirmacao antes de persistir.",
    data: {
      adjustmentKind: "quantity",
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      itemName: getItemName(item),
      quantity,
      unit,
    },
  };
}

function buildReplaceConfirmation(meal: ExistingMeal, item: ExistingMealItem, targetFood: string): WhatsappRecordAdjustmentResult {
  return {
    handled: true,
    action: "record_adjustment_confirmation_needed",
    reply: `Confirme antes de eu alterar: trocar ${getItemName(item)} por ${targetFood} em ${meal.mealLabel} (${formatMealDate(meal.occurredAt)})?`,
    eventType: "whatsapp.records.adjustment_confirmation_needed",
    detail: "Troca de alimento com alvo unico exige confirmacao antes de persistir.",
    data: {
      adjustmentKind: "replace_item",
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      sourceFood: getItemName(item),
      targetFood,
    },
  };
}

function buildRemoveItemConfirmation(meal: ExistingMeal, item: ExistingMealItem): WhatsappRecordAdjustmentResult {
  return {
    handled: true,
    action: "record_adjustment_confirmation_needed",
    reply: `Confirme antes de eu remover: ${getItemName(item)} de ${meal.mealLabel} (${formatMealDate(meal.occurredAt)})?`,
    eventType: "whatsapp.records.adjustment_confirmation_needed",
    detail: "Remocao de alimento com alvo unico exige confirmacao antes de persistir.",
    data: {
      adjustmentKind: "remove_item",
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      itemName: getItemName(item),
    },
  };
}

function buildRemoveMealConfirmation(meal: ExistingMeal): WhatsappRecordAdjustmentResult {
  return {
    handled: true,
    action: "record_adjustment_confirmation_needed",
    reply: `Confirme antes de eu remover a ultima refeicao: ${meal.mealLabel} de ${formatMealDate(meal.occurredAt)} com ${(meal.items ?? []).length} item(ns).`,
    eventType: "whatsapp.records.adjustment_confirmation_needed",
    detail: "Remocao de ultima refeicao exige confirmacao antes de persistir.",
    data: {
      adjustmentKind: "remove_last_meal",
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      itemCount: (meal.items ?? []).length,
    },
  };
}

export async function executeWhatsappRecordAdjustmentIntent(
  userId: number,
  input: WhatsappRecordAdjustmentInput,
): Promise<WhatsappRecordAdjustmentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const intent = detectAdjustmentIntent(text);
  if (!intent) return null;
  if (intent.kind === "incomplete") return buildMissingTargetResponse(intent);

  const receivedAt = input.receivedAt ?? new Date();
  const recentMeals = getRecentMeals(await listMeals(userId), receivedAt);
  if (!recentMeals.length) return buildNoRecentMealResponse(intent);

  if (intent.kind === "remove_last_meal") {
    return buildRemoveMealConfirmation(recentMeals[0]);
  }

  if (intent.kind === "quantity") {
    const latestMeal = recentMeals[0];
    const latestItems = latestMeal.items ?? [];
    if (latestItems.length === 1) {
      return buildQuantityConfirmation(latestMeal, latestItems[0], intent.quantity, intent.unit);
    }
    if (latestItems.length > 1) {
      return buildOptionsResponse("quantidade informada", latestItems.map((item, itemIndex) => ({ meal: latestMeal, item, itemIndex, score: 1 })), intent.kind);
    }
    return buildMissingTargetResponse(intent);
  }

  const targetFood = intent.kind === "replace_item" ? intent.sourceFood : intent.targetFood;
  const candidates = findItemCandidates(recentMeals, targetFood);
  if (!candidates.length) return buildMissingTargetResponse(intent);
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return buildOptionsResponse(targetFood, candidates, intent.kind);
  }

  const selected = candidates[0];
  if (intent.kind === "replace_item") {
    return buildReplaceConfirmation(selected.meal, selected.item, intent.targetFood);
  }
  return buildRemoveItemConfirmation(selected.meal, selected.item);
}
