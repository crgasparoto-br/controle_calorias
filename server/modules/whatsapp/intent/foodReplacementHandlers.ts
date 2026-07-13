import {
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppItemNotFoundReplyMessage,
  buildWhatsAppMealActionReplyMessage,
} from "../replyMessages";
import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import { createPendingMealItemSelection, type MealItemSelectionCompanionAction, type MealItemPendingSelectionStep } from "../mealItemSelectionCallback";
import { formatTotalsLine, replaceMealItemFood, toMealItemInput } from "./mealItemHelpers";
import { resolveTargetMealItemInMeals, type MealItemTargetCandidate } from "./mealTargetResolution";
import { formatNumber } from "./textUtils";
import type { FoodReplacementIntent, WhatsappIntentResult } from "./types";

type MealRecord = Awaited<ReturnType<typeof listMeals>>[number];
type MutableMealRecord = MealRecord & { items: MealItemInput[] };
type AppliedFoodReplacement = {
  targetFood: string;
  from: string;
  to: string;
  item: MealItemInput;
  scope: string;
  scopeLabel: string;
  candidate: MealItemSelectionCompanionAction["candidate"];
};
type PendingReplacementTarget = {
  targetFood: string;
  context: string;
  scopeLabel: string;
  candidates: MealItemTargetCandidate<MutableMealRecord>[];
  toFood: string;
};

function replacementMatchDetail(params: { prefix: string; targetFood: string; scopeLabel: string; ambiguous: boolean }) {
  return `${params.prefix} Alvo usado: ${params.targetFood}. Escopo da busca: ${params.scopeLabel}. Ambiguidade: ${params.ambiguous ? "sim" : "não"}.`;
}

function formatAppliedDetails(applied: AppliedFoodReplacement[]) {
  return applied.map(item => `alvo "${item.targetFood}" -> "${item.from}" (${item.scopeLabel})`).join("; ");
}

function contextWithPreposition(scope: string) {
  return scope === "same_day_meals" ? "nas refeições do dia" : "na última refeição";
}

function replacementContext(scopes: string[]) {
  return scopes.some(scope => scope === "same_day_meals") ? "nas refeições do dia" : "na última refeição";
}

function capitalizeDisplayName(value: string) {
  return value ? `${value[0].toLocaleUpperCase("pt-BR")}${value.slice(1)}` : value;
}

function selectionCandidates(candidates: MealItemTargetCandidate<MutableMealRecord>[]) {
  return candidates.map(candidate => ({
    mealId: candidate.meal.id,
    mealLabel: candidate.meal.mealLabel,
    itemIndex: candidate.index,
    itemName: candidate.item.foodName,
  }));
}

async function ambiguousReplacementReply(input: {
  userId: number;
  current: PendingReplacementTarget;
  remaining: PendingReplacementTarget[];
  companionActions: MealItemSelectionCompanionAction[];
  resultTitle: string;
}): Promise<WhatsappIntentResult> {
  const remainingSelections: MealItemPendingSelectionStep[] = input.remaining.map(pending => ({
    targetFood: pending.targetFood,
    action: { kind: "replace_food", targetFood: pending.toFood },
    contextLabel: pending.context,
    candidates: selectionCandidates(pending.candidates),
  }));
  const selectionResult = await createPendingMealItemSelection(input.userId, {
    targetFood: input.current.targetFood,
    action: { kind: "replace_food", targetFood: input.current.toFood },
    contextLabel: input.current.context,
    resultTitle: input.resultTitle,
    candidates: selectionCandidates(input.current.candidates),
    companionActions: input.companionActions,
    remainingSelections,
  });
  return {
    handled: true,
    action: "clarification_needed",
    reply: selectionResult.reply,
    eventType: selectionResult.eventType,
    detail: replacementMatchDetail({ prefix: "Pedido de substituição com item ambíguo.", targetFood: input.current.targetFood, scopeLabel: input.current.scopeLabel, ambiguous: true }),
    interactiveReply: selectionResult.interactiveReply,
    data: selectionResult.data,
  };
}

function toMutableMeals(meals: MealRecord[]): MutableMealRecord[] {
  return meals.map(meal => ({
    ...meal,
    items: (meal.items ?? []).map(item => ({ ...item })) as MealItemInput[],
  }));
}

async function updateMealItems(userId: number, meal: MutableMealRecord) {
  return updateMeal(userId, { mealId: meal.id, mealLabel: meal.mealLabel, occurredAt: new Date(meal.occurredAt).toISOString(), notes: meal.notes, items: meal.items });
}

function buildMultipleReplacementLines(applied: AppliedFoodReplacement[], notFound: string[]) {
  const context = replacementContext(applied.map(item => item.scope));
  const lines = [
    `Troquei os seguintes alimentos ${context} e recalculei os macros:`,
    ...applied.map(({ from, to, item }) => `• ${from} → ${capitalizeDisplayName(to)}: ${formatNumber(item.estimatedGrams)} g | ${formatTotalsLine(item)}`),
  ];
  if (notFound.length) lines.push(`Não encontrei nas refeições de hoje: ${notFound.join(", ")}.`);
  return lines;
}

export async function handleFoodReplacementIntents(userId: number, replacements: FoodReplacementIntent[]): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  if (!meals.length) {
    return { handled: true, action: "clarification_needed", reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma refeição recente para corrigir. Me diga qual alimento devo trocar."), eventType: "whatsapp.intent.clarification_needed", detail: "Pedido de substituição sem refeição recente disponível." };
  }

  const mutableMeals = toMutableMeals(meals);
  const changedMealIndexes = new Set<number>();
  const applied: AppliedFoodReplacement[] = [];
  const pendingTargets: PendingReplacementTarget[] = [];
  const notFound: string[] = [];

  for (const replacement of replacements) {
    const target = resolveTargetMealItemInMeals(mutableMeals, replacement.fromFood);
    if (target.kind === "ambiguous") {
      pendingTargets.push({ targetFood: replacement.fromFood, context: contextWithPreposition(target.scope), scopeLabel: target.scopeLabel, candidates: target.candidates, toFood: replacement.toFood });
      continue;
    }
    if (target.kind !== "matched") {
      notFound.push(replacement.fromFood);
      continue;
    }
    const candidate = { mealId: target.meal.id, mealLabel: target.meal.mealLabel, itemIndex: target.index, itemName: target.item.foodName };
    const replacedItem = replaceMealItemFood(toMealItemInput(target.meal.items[target.index]), replacement.toFood);
    const originalItems = meals[target.mealIndex]?.items ?? [];
    target.meal.items = originalItems.map((item, index) => index === target.index ? replacedItem : item) as MealItemInput[];
    changedMealIndexes.add(target.mealIndex);
    applied.push({ targetFood: replacement.fromFood, from: target.item.foodName, to: replacement.toFood, item: replacedItem, scope: target.scope, scopeLabel: target.scopeLabel, candidate });
  }

  if (pendingTargets.length) {
    const [current, ...remaining] = pendingTargets;
    return ambiguousReplacementReply({
      userId,
      current,
      remaining,
      resultTitle: replacements.length === 1 ? "Alimento substituído" : "Alimentos substituídos",
      companionActions: applied.map(item => ({ candidate: item.candidate, action: { kind: "replace_food", targetFood: item.to } })),
    });
  }

  if (!applied.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppItemNotFoundReplyMessage({ target: notFound.join(", ") || "esse alimento", context: "nas refeições de hoje", instruction: "Me diga qual alimento devo trocar." }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: `Pedido de substituição sem item compatível. Alvos: ${notFound.join(", ")}.`,
    };
  }

  const updatedMeals = await Promise.all([...changedMealIndexes].map(index => updateMealItems(userId, mutableMeals[index])));
  const actionLines = applied.length === 1 && !notFound.length
    ? (() => {
        const { from, to, item, scope } = applied[0];
        const source = item.source === "catalog" ? "com base no catálogo" : "por estimativa";
        return [`Troquei ${from} por ${capitalizeDisplayName(to)} ${contextWithPreposition(scope)} e recalculei os macros ${source}. Quantidade mantida: ${formatNumber(item.estimatedGrams)} g.`];
      })()
    : buildMultipleReplacementLines(applied, notFound);
  const title = applied.length === 1 ? "Alimento substituído" : "Alimentos substituídos";
  const reply = updatedMeals.map(meal => buildWhatsAppMealActionReplyMessage(meal, { title, actionLines })).join("\n\n");
  return {
    handled: true,
    action: "meal_item_replaced",
    reply,
    eventType: "whatsapp.intent.meal_item_replaced",
    detail: `${applied.length} alimento(s) substituído(s). Matches: ${formatAppliedDetails(applied)}.`,
    data: { mealId: updatedMeals[0]?.id, affectedMealIds: updatedMeals.map(meal => meal.id), previousFoodName: applied[0].from, nextFoodName: applied[0].to },
  };
}
