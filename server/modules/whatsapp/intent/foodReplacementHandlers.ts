import {
  buildWhatsAppAuxiliaryReplyMessage,
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppItemNotFoundReplyMessage,
  buildWhatsAppMealActionReplyMessage,
} from "../replyMessages";
import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import { createPendingMealItemSelection, type MealItemSelectionCompanionAction } from "../mealItemSelectionCallback";
import { formatTargetMealItemOptions, formatTotalsLine, replaceMealItemFood, toMealItemInput } from "./mealItemHelpers";
import { resolveTargetMealItemInMeals, type MealItemTargetCandidate } from "./mealTargetResolution";
import { formatNumber } from "./textUtils";
import type { FoodReplacementIntent, WhatsappIntentResult } from "./types";

type MealRecord = Awaited<ReturnType<typeof listMeals>>[number];
type MutableMealRecord = MealRecord & { items: MealItemInput[] };
type AppliedFoodReplacement = { targetFood: string; from: string; to: string; item: MealItemInput; scope: string; scopeLabel: string; candidate: MealItemSelectionCompanionAction["candidate"] };
type PendingReplacementTarget = { targetFood: string; options: string; context: string; scopeLabel: string; candidates: MealItemTargetCandidate<MutableMealRecord>[]; toFood: string };

function replacementMatchDetail(params: { prefix: string; targetFood: string; selectedFoodName?: string; scopeLabel: string; ambiguous: boolean }) {
  const selected = params.selectedFoodName ? ` Item escolhido: ${params.selectedFoodName}.` : "";
  return `${params.prefix} Alvo usado: ${params.targetFood}. Escopo da busca: ${params.scopeLabel}. Ambiguidade: ${params.ambiguous ? "sim" : "não"}.${selected}`;
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

async function ambiguousReplacementReply(input: {
  userId: number;
  targetFood: string;
  toFood: string;
  candidates: MealItemTargetCandidate<MutableMealRecord>[];
  companionActions: MealItemSelectionCompanionAction[];
  context?: string;
  scopeLabel?: string;
}): Promise<WhatsappIntentResult> {
  const selectionResult = await createPendingMealItemSelection(input.userId, {
    targetFood: input.targetFood,
    action: { kind: "replace_food", targetFood: input.toFood },
    contextLabel: input.context ?? "na última refeição",
    resultTitle: "Alimento substituído",
    candidates: input.candidates.map(candidate => ({ mealId: candidate.meal.id, mealLabel: candidate.meal.mealLabel, itemIndex: candidate.index, itemName: candidate.item.foodName })),
    companionActions: input.companionActions,
  });
  return {
    handled: true,
    action: "clarification_needed",
    reply: selectionResult.reply,
    eventType: selectionResult.eventType,
    detail: replacementMatchDetail({ prefix: "Pedido de substituição de alimento com mais de um item compatível.", targetFood: input.targetFood, scopeLabel: input.scopeLabel ?? "última refeição", ambiguous: true }),
    interactiveReply: selectionResult.interactiveReply,
    data: selectionResult.data,
  };
}

function toMutableMeals(meals: MealRecord[]): MutableMealRecord[] {
  return meals.map(meal => ({ ...meal, items: [...(meal.items ?? [])] as MealItemInput[] }));
}

async function updateMealItems(userId: number, meal: MutableMealRecord) {
  return updateMeal(userId, { mealId: meal.id, mealLabel: meal.mealLabel, occurredAt: new Date(meal.occurredAt).toISOString(), notes: meal.notes, items: meal.items as MealItemInput[] });
}

function buildMultipleReplacementLines(applied: AppliedFoodReplacement[], notFound: string[]) {
  const context = replacementContext(applied.map(item => item.scope));
  const lines = [
    `Troquei os seguintes alimentos ${context} e recalculei os macros:`,
    ...applied.map(({ from, to, item }) => `• ${from} → ${to}: ${formatNumber(item.estimatedGrams)} g | ${formatTotalsLine(item)}`),
  ];
  if (notFound.length) lines.push(`Não encontrei nas refeições de hoje: ${notFound.join(", ")}.`);
  return lines;
}

export async function handleFoodReplacementIntents(userId: number, replacements: FoodReplacementIntent[]): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  if (!meals.length) {
    return { handled: true, action: "clarification_needed", reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma refeição recente para corrigir. Me diga qual alimento devo trocar."), eventType: "whatsapp.intent.clarification_needed", detail: "Pedido de substituição de alimento sem refeição recente disponível." };
  }

  const mutableMeals = toMutableMeals(meals);
  const changedMealIndexes = new Set<number>();
  const applied: AppliedFoodReplacement[] = [];
  const pendingTargets: PendingReplacementTarget[] = [];
  const notFound: string[] = [];

  for (const replacement of replacements) {
    const target = resolveTargetMealItemInMeals(mutableMeals, replacement.fromFood);
    if (target.kind === "ambiguous") {
      pendingTargets.push({ targetFood: replacement.fromFood, options: formatTargetMealItemOptions(target.candidates), context: contextWithPreposition(target.scope), scopeLabel: target.scopeLabel, candidates: target.candidates, toFood: replacement.toFood });
      continue;
    }
    if (target.kind !== "matched") {
      notFound.push(replacement.fromFood);
      continue;
    }

    const candidate = { mealId: target.meal.id, mealLabel: target.meal.mealLabel, itemIndex: target.index, itemName: target.item.foodName };
    const replacedItem = replaceMealItemFood(toMealItemInput(target.meal.items[target.index]), replacement.toFood);
    target.meal.items = target.meal.items.map((item, index) => index === target.index ? replacedItem : item);
    changedMealIndexes.add(target.mealIndex);
    applied.push({ targetFood: replacement.fromFood, from: target.item.foodName, to: replacement.toFood, item: replacedItem, scope: target.scope, scopeLabel: target.scopeLabel, candidate });
  }

  if (pendingTargets.length) {
    const pending = pendingTargets[0];
    return ambiguousReplacementReply({
      userId,
      targetFood: pending.targetFood,
      toFood: pending.toFood,
      candidates: pending.candidates,
      companionActions: applied.map(item => ({ candidate: item.candidate, action: { kind: "replace_food", targetFood: item.to } })),
      context: pending.context,
      scopeLabel: pending.scopeLabel,
    });
  }

  if (applied.length === 0) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppItemNotFoundReplyMessage({ target: notFound.join(", ") || "esse alimento", context: "nas refeições de hoje", instruction: "Me diga qual alimento devo trocar." }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: `Pedido de substituição de alimento sem item compatível nas refeições do dia. Alvos usados: ${notFound.join(", ")}. Escopo da busca: refeições do dia. Ambiguidade: não.`,
    };
  }

  const updatedMeals = await Promise.all([...changedMealIndexes].map(index => updateMealItems(userId, mutableMeals[index])));
  const actionLines = applied.length === 1 && !notFound.length
    ? (() => {
        const { from, to, item, scope } = applied[0];
        const recalculationSource = item.source === "catalog" ? "com base no catálogo" : "por estimativa";
        return [`Troquei ${from} por ${to} ${contextWithPreposition(scope)} e recalculei os macros ${recalculationSource}. Quantidade mantida: ${formatNumber(item.estimatedGrams)} g. Estimativa: ${formatTotalsLine(item)}.`];
      })()
    : buildMultipleReplacementLines(applied, notFound);

  const title = applied.length === 1 ? "Alimento substituído" : "Alimentos substituídos";
  const reply = updatedMeals.length === 1
    ? buildWhatsAppMealActionReplyMessage(updatedMeals[0], { title, actionLines })
    : updatedMeals.map(meal => buildWhatsAppMealActionReplyMessage(meal, { title, actionLines })).join("\n\n");

  const context = replacementContext(applied.map(item => item.scope));
  const notFoundDetail = notFound.length ? ` Alvos não encontrados: ${notFound.join(", ")}.` : "";
  return {
    handled: true,
    action: "meal_item_replaced",
    reply,
    eventType: "whatsapp.intent.meal_item_replaced",
    detail: `${applied.length} alimento(s) substituído(s) via WhatsApp com macros recalculados. Matches: ${formatAppliedDetails(applied)}. Escopo da busca: ${context}. Ambiguidade: não.${notFoundDetail}`,
    data: { mealId: updatedMeals[0]?.id, previousFoodName: applied[0].from, nextFoodName: applied[0].to, estimatedGrams: applied[0].item.estimatedGrams, calories: applied[0].item.calories, protein: applied[0].item.protein, carbs: applied[0].item.carbs, fat: applied[0].item.fat, nutritionSource: applied[0].item.source },
  };
}
