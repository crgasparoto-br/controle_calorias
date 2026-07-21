import { randomUUID } from "node:crypto";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { findCatalogFood } from "../../catalogMatching";
import { getDb, getHabitSnapshots, logPersistenceWarning } from "../../db";
import { FOOD_CATALOG_REFERENCE } from "../../foodCatalogReference";
import {
  cleanFoodName,
  extractExplicitQuantities,
  normalizeText,
  parseQuantityUnitFromPortionText,
} from "../../mealTextParsing";
import { processMealInput } from "../../nutritionEngine";
import type { CatalogFood, MealDraftItem } from "../../nutritionEngineTypes";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
  type WhatsAppPendingOperationRepository,
} from "../../repositories/whatsappPendingOperationRepository";
import { findTacoFood } from "../../tacoLookup";
import { createManualMeal, listMeals, removeMeal, updateMeal } from "../meals/service";
import type { WhatsappIntentResult } from "./intent/types";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import { consolidateWhatsAppMealAfterSave } from "./mealConsolidationService";
import {
  buildWhatsAppActionCancelledReplyMessage,
  buildWhatsAppCallbackUnavailableReplyMessage,
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";
import {
  isStandaloneWhatsappCancellationWord,
  isStandaloneWhatsappCommandWord,
  isStandaloneWhatsappConfirmationWord,
  normalizeStandaloneWhatsappCommand,
} from "./standaloneCommandWords";

export const PENDING_FOOD_CLARIFICATION_TYPE = "food_registration_clarification";
export const PENDING_FOOD_CLARIFICATION_ORIGIN = "foodClarification";
export const PENDING_FOOD_CLARIFICATION_TTL_MS = 10 * 60 * 1000;

export type FoodClarificationKind = "confirmation" | "quantity" | "selection";
export type FoodClarificationClassification = "open" | "closed";

export type FoodClarificationCandidate = {
  name: string;
  servingLabel: string;
  gramsPerServing: number;
  brandName: string | null;
  isBrandedProduct: boolean;
  matchKind: "exact" | "fallback";
};

export type PendingFoodClarificationTarget = {
  contractVersion: 1;
  interactionId: string;
  kind: "food_registration_clarification";
  classification: FoodClarificationClassification;
  pendingKind: FoodClarificationKind;
  originalText: string;
  sanitizedOriginalText: string;
  originalCandidate: string;
  normalizedCandidate: string;
  normalizationChanged: boolean;
  count: number;
  qualifiers: string[];
  candidates: FoodClarificationCandidate[];
  selectedCandidateIndex: number | null;
  actions: Array<{ id: string; label: string; effect: string }>;
  instructionText: string;
  inboundMessageId: string | null;
  allowedDomainEffect: "register_original_food_once";
};

export type WhatsappFoodClarificationResult = WhatsappIntentResult;

type FoodClarificationDependencies = {
  repository: WhatsAppPendingOperationRepository;
  processFood: typeof processMealInput;
  getHabits: typeof getHabitSnapshots;
  createMeal: typeof createManualMeal;
  listMeals: typeof listMeals;
  updateMeal: typeof updateMeal;
  removeMeal: typeof removeMeal;
};

const defaultRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

const defaultDependencies: FoodClarificationDependencies = {
  repository: defaultRepository,
  processFood: processMealInput,
  getHabits: getHabitSnapshots,
  createMeal: createManualMeal,
  listMeals,
  updateMeal,
  removeMeal,
};

const COUNT_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

const SAFE_TYPO_REPLACEMENTS: Record<string, string> = {
  natual: "natural",
  iorgute: "iogurte",
  yogurte: "iogurte",
  bananna: "banana",
  banna: "banana",
};

const NON_FOOD_COUNT_CONTEXT = /\b(?:relatorio|resumo|registro|opcao|dia|semana|mes|ano|paciente|mensagem|pergunta|consulta|arquivo|foto|imagem)\b/i;
const FULL_COMMAND_WORDS = /\b(?:excluir|remover|apagar|deletar|trocar|corrigir|alterar|consultar|resumo|relatorio)\b/i;
const COUNTABLE_SERVING = /\b(?:unidade|unid|und|fatia|pedaco|x[ií]cara|copo|colher|dose|scoop|lata|garrafa|long\s*neck|por[cç][aã]o)\b/i;
const EXPLICIT_MASS_OR_VOLUME = /^(\d+(?:[,.]\d+)?)\s*(g|gramas?|ml|mililitros?|l|litros?)\b/i;
const QUANTITY_ONLY_REPLY = /^\s*\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?)\s*$/i;

function normalizeCandidate(value: string) {
  return cleanFoodName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(word => SAFE_TYPO_REPLACEMENTS[normalizeText(word)] ?? word)
    .join(" ");
}

function parseCount(value: string) {
  const normalized = normalizeStandaloneWhatsappCommand(value);
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return COUNT_WORDS[normalized] ?? null;
}

export type CountedFoodRequest = {
  originalText: string;
  originalCandidate: string;
  normalizedCandidate: string;
  normalizationChanged: boolean;
  count: number;
};

export function parseCountedFoodRequest(text?: string | null): CountedFoodRequest | null {
  const originalText = text?.trim() ?? "";
  if (!originalText || FULL_COMMAND_WORDS.test(originalText)) return null;
  if (extractExplicitQuantities(originalText).length > 0) return null;

  const cleaned = cleanFoodName(originalText);
  const match = cleaned.match(/^(\d+|um|uma|dois|duas|tres|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+(.+)$/i);
  if (!match) return null;

  const count = parseCount(match[1]);
  const originalCandidate = cleanFoodName(match[2]);
  if (!count || count > 50 || !originalCandidate || NON_FOOD_COUNT_CONTEXT.test(originalCandidate)) return null;

  const normalizedCandidate = normalizeCandidate(originalCandidate);
  return {
    originalText,
    originalCandidate,
    normalizedCandidate,
    normalizationChanged: normalizeText(originalCandidate) !== normalizeText(normalizedCandidate),
    count,
  };
}

function toCandidate(food: CatalogFood, matchKind: FoodClarificationCandidate["matchKind"]): FoodClarificationCandidate {
  return {
    name: food.name,
    servingLabel: food.servingLabel,
    gramsPerServing: food.gramsPerServing,
    brandName: food.brandName?.trim() || null,
    isBrandedProduct: Boolean(food.isBrandedProduct || food.brandName),
    matchKind,
  };
}

function isExactFoodMatch(food: Pick<CatalogFood, "name" | "aliases">, candidate: string) {
  const normalized = normalizeText(candidate);
  return [food.name, ...food.aliases].some(name => normalizeText(name) === normalized);
}

function uniqueCandidates(candidates: FoodClarificationCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${normalizeText(candidate.name)}|${normalizeText(candidate.servingLabel)}|${normalizeText(candidate.brandName ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveFoodClarificationCandidates(candidate: string): FoodClarificationCandidate[] {
  const exactReference = FOOD_CATALOG_REFERENCE
    .filter(food => isExactFoodMatch(food as CatalogFood, candidate))
    .map(food => toCandidate(food as CatalogFood, "exact"));
  const catalog = findCatalogFood(candidate);
  const taco = findTacoFood(candidate);

  return uniqueCandidates([
    ...exactReference,
    ...(catalog ? [toCandidate(catalog, isExactFoodMatch(catalog, candidate) ? "exact" : "fallback")] : []),
    ...(taco ? [toCandidate(taco, normalizeText(taco.name) === normalizeText(candidate) ? "exact" : "fallback")] : []),
  ]);
}

export function hasSafeCanonicalPortion(candidate: FoodClarificationCandidate) {
  if (candidate.matchKind !== "exact") return false;
  if (!Number.isFinite(candidate.gramsPerServing) || candidate.gramsPerServing <= 0) return false;
  if (/^100\s*g$/i.test(candidate.servingLabel.trim())) return false;
  if (COUNTABLE_SERVING.test(candidate.servingLabel)) return true;
  return candidate.isBrandedProduct && EXPLICIT_MASS_OR_VOLUME.test(candidate.servingLabel.trim()) !== null;
}

function buildQuantityInstruction(candidate: string) {
  return `Qual é o tamanho, peso ou volume de ${candidate}? Responda, por exemplo, 170 g ou 200 ml. Não vou assumir 100 g como uma unidade.`;
}

function buildConfirmationInstruction(candidate: string) {
  return `Você quis dizer ${candidate}? Responda SIM para registrar o alimento original ou CANCELAR para desistir.`;
}

function buildSelectionInstruction(candidates: FoodClarificationCandidate[]) {
  const options = candidates.map((candidate, index) => `${index + 1}. ${candidate.name} — ${candidate.servingLabel}`).join("\n");
  return `Encontrei mais de um alimento possível. Qual deles você quis dizer?\n${options}\n\nResponda com o número ou CANCELAR.`;
}

function buildActions(kind: FoodClarificationKind, candidates: FoodClarificationCandidate[]) {
  if (kind === "quantity") {
    return [
      { id: "provide_quantity", label: "Informar quantidade", effect: "complete_original_food" },
      { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
    ];
  }
  if (kind === "confirmation") {
    return [
      { id: "confirm", label: "Confirmar", effect: "register_original_food_once" },
      { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
    ];
  }
  return [
    ...candidates.map((_, index) => ({ id: `select:${index}`, label: `Opção ${index + 1}`, effect: "select_candidate" })),
    { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
  ];
}

function buildTarget(input: {
  request: CountedFoodRequest;
  pendingKind: FoodClarificationKind;
  candidates: FoodClarificationCandidate[];
  selectedCandidateIndex?: number | null;
  instructionText: string;
  messageId?: string | null;
}): PendingFoodClarificationTarget {
  return {
    contractVersion: 1,
    interactionId: randomUUID(),
    kind: "food_registration_clarification",
    classification: input.pendingKind === "quantity" ? "open" : "closed",
    pendingKind: input.pendingKind,
    originalText: input.request.originalText,
    sanitizedOriginalText: cleanFoodName(input.request.originalText),
    originalCandidate: input.request.originalCandidate,
    normalizedCandidate: input.request.normalizedCandidate,
    normalizationChanged: input.request.normalizationChanged,
    count: input.request.count,
    qualifiers: input.request.normalizedCandidate.split(/\s+/).slice(1),
    candidates: input.candidates,
    selectedCandidateIndex: input.selectedCandidateIndex ?? null,
    actions: buildActions(input.pendingKind, input.candidates),
    instructionText: input.instructionText,
    inboundMessageId: input.messageId?.trim() || null,
    allowedDomainEffect: "register_original_food_once",
  };
}

export function isPendingFoodClarificationTarget(value: unknown): value is PendingFoodClarificationTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingFoodClarificationTarget>;
  return target.contractVersion === 1
    && target.kind === "food_registration_clarification"
    && ["confirmation", "quantity", "selection"].includes(target.pendingKind ?? "")
    && typeof target.originalText === "string"
    && typeof target.normalizedCandidate === "string"
    && typeof target.count === "number"
    && Array.isArray(target.candidates)
    && Array.isArray(target.actions)
    && typeof target.instructionText === "string";
}

function result(input: Omit<WhatsappFoodClarificationResult, "handled">): WhatsappFoodClarificationResult {
  return { handled: true, ...input };
}

function pendingData(pending: Pick<WhatsAppPendingOperationRecord, "id" | "type" | "state" | "version">, target: PendingFoodClarificationTarget) {
  return {
    interactionId: target.interactionId,
    classification: target.classification,
    pendingOperationId: pending.id,
    pendingType: pending.type,
    pendingKind: target.pendingKind,
    pendingState: pending.state,
    pendingVersion: pending.version,
    actions: target.actions,
    instructionText: target.instructionText,
    originalTextPreserved: true,
    originalCandidate: target.originalCandidate,
    normalizedCandidate: target.normalizedCandidate,
    normalizationChanged: target.normalizationChanged,
    inboundMessageId: target.inboundMessageId,
    allowedDomainEffect: target.allowedDomainEffect,
  };
}

function inferCountUnit(candidate: FoodClarificationCandidate) {
  const parsed = parseQuantityUnitFromPortionText(candidate.servingLabel);
  return parsed && COUNTABLE_SERVING.test(parsed.unit) ? parsed.unit : "unidades";
}

function buildRegistrationText(
  target: PendingFoodClarificationTarget,
  candidate: FoodClarificationCandidate,
  explicitQuantity?: { quantity: number; unit: string },
) {
  if (explicitQuantity) return `${explicitQuantity.quantity} ${explicitQuantity.unit} de ${target.normalizedCandidate}`;
  if (COUNTABLE_SERVING.test(candidate.servingLabel)) {
    return `${target.count} ${inferCountUnit(candidate)} de ${target.normalizedCandidate}`;
  }
  const grams = Math.round(candidate.gramsPerServing * target.count * 100) / 100;
  return `${grams} g de ${target.normalizedCandidate}`;
}

function sameLogicalMeal(
  meal: { mealLabel: string; occurredAt: Date | number | string },
  mealLabel: string,
  occurredAt: Date,
  timeZone: string,
) {
  return normalizeText(meal.mealLabel) === normalizeText(mealLabel)
    && getDateKeyInTimeZone(new Date(meal.occurredAt), timeZone) === getDateKeyInTimeZone(occurredAt, timeZone);
}

async function persistResolvedFood(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  candidate: FoodClarificationCandidate,
  occurredAt: Date,
  timeZone: string,
  explicitQuantity?: { quantity: number; unit: string },
): Promise<WhatsappFoodClarificationResult> {
  const processed = await deps.processFood({
    text: buildRegistrationText(target, candidate, explicitQuantity),
    habits: await deps.getHabits(userId),
    occurredAt,
    timeZone,
  });
  if (!processed.items.length) throw new Error("A resolução não produziu alimento válido.");

  const meals = await deps.listMeals(userId);
  const existing = meals.find(meal => sameLogicalMeal(meal, processed.detectedMealLabel, occurredAt, timeZone));
  const notes = target.originalText;

  const saved = existing
    ? await deps.updateMeal(userId, {
        mealId: existing.id,
        mealLabel: existing.mealLabel,
        occurredAt: new Date(existing.occurredAt).toISOString(),
        notes: existing.notes || notes,
        items: [...(existing.items ?? []), ...processed.items] as MealDraftItem[],
      })
    : await deps.createMeal(userId, {
        mealLabel: processed.detectedMealLabel || "Refeição",
        occurredAt: occurredAt.toISOString(),
        notes,
        items: processed.items,
      });

  const consolidated = existing
    ? { action: "updated" as const, meal: saved }
    : await consolidateWhatsAppMealAfterSave({
        listUserMeals: deps.listMeals,
        updateUserMeal: input => deps.updateMeal(input.userId, {
          mealId: input.mealId,
          mealLabel: input.mealLabel,
          occurredAt: input.occurredAt,
          notes: input.notes,
          items: input.items,
        }),
        removeUserMeal: deps.removeMeal,
      }, saved, timeZone);

  const meal = consolidated.meal;
  const reply = await composeWhatsAppMealActionReply({
    userId,
    meal,
    timeZone,
    options: {
      title: consolidated.action === "updated" ? "Alimento adicionado" : "Alimento registrado",
      actionLines: [`Registrei ${target.normalizedCandidate} usando a quantidade resolvida para a mensagem original.`],
      mealResultState: consolidated.action === "updated" ? "updated" : "registered",
    },
  });

  return result({
    action: "food_clarification_completed",
    reply,
    eventType: "whatsapp.food_clarification.completed",
    detail: "Pendência alimentar resolvida com serviço canônico, consolidação e estado persistido recarregado.",
    data: {
      mealId: meal.id,
      interactionId: target.interactionId,
      originalTextPreserved: true,
      normalizedCandidate: target.normalizedCandidate,
      resolvedQuantity: explicitQuantity ?? { count: target.count, servingLabel: candidate.servingLabel },
    },
  });
}

async function recreateAfterFailure(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  occurredAt: Date,
) {
  await deps.repository.createPendingOperation({
    userId,
    type: PENDING_FOOD_CLARIFICATION_TYPE,
    origin: PENDING_FOOD_CLARIFICATION_ORIGIN,
    target: { ...target, interactionId: randomUUID() },
    ttlMs: PENDING_FOOD_CLARIFICATION_TTL_MS,
    now: occurredAt,
  });
}

function parseQuantityReply(text?: string | null) {
  const raw = text?.trim() ?? "";
  if (!QUANTITY_ONLY_REPLY.test(raw)) return null;
  const quantities = extractExplicitQuantities(raw);
  return quantities.length === 1
    ? { quantity: quantities[0].quantity, unit: quantities[0].unit }
    : null;
}

function parseSelectionReply(text?: string | null, candidateCount = 0) {
  const match = normalizeStandaloneWhatsappCommand(text).match(/^(?:opcao\s*)?(\d{1,2})$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < candidateCount ? index : -1;
}

function isFullNewCommand(text?: string | null) {
  const raw = text?.trim() ?? "";
  return Boolean(raw && !isStandaloneWhatsappCommandWord(raw) && /\p{L}/u.test(raw) && raw.split(/\s+/).length >= 2);
}

function reprompt(pending: WhatsAppPendingOperationRecord, target: PendingFoodClarificationTarget, eventType: string, detail: string) {
  return result({
    action: "food_clarification_reprompted",
    reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
    eventType,
    detail,
    data: pendingData(pending, target),
  });
}

async function claimOrUnavailable(deps: FoodClarificationDependencies, pending: WhatsAppPendingOperationRecord) {
  return deps.repository.claimPendingOperation({ id: pending.id, expectedVersion: pending.version });
}

async function persistAfterClaim(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  candidate: FoodClarificationCandidate,
  occurredAt: Date,
  timeZone: string,
  explicitQuantity?: { quantity: number; unit: string },
) {
  try {
    return await persistResolvedFood(deps, userId, target, candidate, occurredAt, timeZone, explicitQuantity);
  } catch {
    await recreateAfterFailure(deps, userId, target, occurredAt);
    return result({
      action: "food_clarification_retryable_failure",
      reply: buildWhatsAppRecoverableErrorReplyMessage(`Não consegui concluir o registro agora. Mantive ${target.normalizedCandidate} pendente para nova tentativa.`),
      eventType: "whatsapp.food_clarification.retryable_failure",
      detail: "Falha após claim recriou a pendência sem descartar o texto original.",
    });
  }
}

async function resolvePendingText(
  deps: FoodClarificationDependencies,
  userId: number,
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  text: string | null | undefined,
  occurredAt: Date,
  timeZone: string,
): Promise<WhatsappFoodClarificationResult | "new_command"> {
  if (isStandaloneWhatsappCancellationWord(text)) {
    const cancelled = await deps.repository.cancelPendingOperation(pending.id);
    if (!cancelled.cancelled) return unavailable("A pendência alimentar já não estava ativa.");
    return result({
      action: "food_clarification_cancelled",
      reply: buildWhatsAppActionCancelledReplyMessage("Não registrei o alimento pendente."),
      eventType: "whatsapp.food_clarification.cancelled",
      detail: "Pendência alimentar cancelada sem mutação.",
      data: { ...pendingData(pending, target), pendingState: "cancelled" },
    });
  }

  if (target.pendingKind === "quantity") {
    const quantity = parseQuantityReply(text);
    if (!quantity) {
      if (isFullNewCommand(text)) return "new_command";
      return reprompt(pending, target, "whatsapp.food_clarification.invalid_quantity_response", "Resposta incompatível não consumiu a pendência aberta de quantidade.");
    }
    const claimed = await claimOrUnavailable(deps, pending);
    if (!claimed.claimed) return unavailable("Claim atômico da quantidade falhou.");
    const candidate = target.candidates[target.selectedCandidateIndex ?? 0] ?? {
      name: target.normalizedCandidate,
      servingLabel: `${quantity.quantity} ${quantity.unit}`,
      gramsPerServing: quantity.quantity,
      brandName: null,
      isBrandedProduct: false,
      matchKind: "exact" as const,
    };
    return persistAfterClaim(deps, userId, target, candidate, occurredAt, timeZone, quantity);
  }

  let selectedIndex = target.selectedCandidateIndex ?? 0;
  if (target.pendingKind === "confirmation") {
    if (!isStandaloneWhatsappConfirmationWord(text)) {
      if (isFullNewCommand(text)) return "new_command";
      return reprompt(pending, target, "whatsapp.food_clarification.invalid_confirmation_response", "Resposta incompatível não consumiu a confirmação alimentar.");
    }
  } else {
    const selection = parseSelectionReply(text, target.candidates.length);
    if (selection === null || selection < 0) {
      if (isFullNewCommand(text)) return "new_command";
      return reprompt(pending, target, "whatsapp.food_clarification.invalid_selection_response", "Opção inválida não consumiu a seleção alimentar.");
    }
    selectedIndex = selection;
  }

  const candidate = target.candidates[selectedIndex];
  if (!candidate || !hasSafeCanonicalPortion(candidate)) {
    return reprompt(pending, target, "whatsapp.food_clarification.canonical_portion_missing", "Candidato sem porção canônica segura não foi tratado como unidade.");
  }
  const claimed = await claimOrUnavailable(deps, pending);
  if (!claimed.claimed) return unavailable("Claim atômico da confirmação/seleção falhou.");
  return persistAfterClaim(deps, userId, { ...target, selectedCandidateIndex: selectedIndex }, candidate, occurredAt, timeZone);
}

function unavailable(detail: string): WhatsappFoodClarificationResult {
  return result({
    action: "food_clarification_unavailable",
    reply: buildWhatsAppCallbackUnavailableReplyMessage(),
    eventType: "whatsapp.food_clarification.unavailable",
    detail,
  });
}

async function supersedeActive(
  deps: FoodClarificationDependencies,
  userId: number,
  occurredAt: Date,
) {
  const active = await deps.repository.getActivePendingOperation(userId, occurredAt);
  if (!active) return true;
  const transitioned = await deps.repository.supersedePendingOperation(active.id);
  return transitioned.superseded;
}

async function createPending(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  occurredAt: Date,
): Promise<WhatsappFoodClarificationResult> {
  if (!await supersedeActive(deps, userId, occurredAt)) {
    return result({
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage("Não consegui substituir a operação pendente com segurança. Cancele a anterior e envie o alimento novamente."),
      eventType: "whatsapp.food_clarification.pending_replacement_blocked",
      detail: "Uma operação anterior não pôde ser marcada como substituída.",
    });
  }
  const created = await deps.repository.createPendingOperation({
    userId,
    type: PENDING_FOOD_CLARIFICATION_TYPE,
    origin: PENDING_FOOD_CLARIFICATION_ORIGIN,
    target,
    ttlMs: PENDING_FOOD_CLARIFICATION_TTL_MS,
    now: occurredAt,
  });
  if (!created) {
    return result({
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage("Não consegui guardar o contexto do alimento com segurança. Envie a mensagem completa novamente."),
      eventType: "whatsapp.food_clarification.persistence_unavailable",
      detail: "Persistência indisponível; fallback nutricional bloqueado.",
    });
  }
  return result({
    action: "food_clarification_requested",
    reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
    eventType: "whatsapp.food_clarification.requested",
    detail: "Pergunta específica criada em whatsappPendingOperations com contrato consumível pela #858.",
    data: pendingData(created, target),
  });
}

export function isExpectedWhatsappFoodClarificationAction(target: PendingFoodClarificationTarget, action: string) {
  return target.actions.some(candidate => candidate.id === action);
}

export function createWhatsappFoodClarificationService(overrides: Partial<FoodClarificationDependencies> = {}) {
  const deps = { ...defaultDependencies, ...overrides };

  const handle = async (input: {
    userId: number;
    text?: string | null;
    receivedAt?: Date;
    userTimezone: string;
    messageId?: string | null;
  }): Promise<WhatsappFoodClarificationResult | null> => {
    const occurredAt = input.receivedAt ?? new Date();
    const text = input.text?.trim() ?? "";
    const active = await deps.repository.getActivePendingOperation(input.userId, occurredAt);

    if (active?.type === PENDING_FOOD_CLARIFICATION_TYPE && isPendingFoodClarificationTarget(active.target)) {
      const pendingResult = await resolvePendingText(deps, input.userId, active, active.target, text, occurredAt, input.userTimezone);
      if (pendingResult !== "new_command") return pendingResult;
      const transitioned = await deps.repository.supersedePendingOperation(active.id);
      if (!transitioned.superseded) {
        return result({
          action: "food_clarification_blocked",
          reply: buildWhatsAppRecoverableErrorReplyMessage("Não consegui substituir a operação pendente com segurança. Cancele a anterior e tente novamente."),
          eventType: "whatsapp.food_clarification.pending_replacement_blocked",
          detail: "Novo comando completo bloqueado porque a pendência alimentar não pôde ser substituída.",
        });
      }
    } else if (active && isStandaloneWhatsappCommandWord(text)) {
      // Outra pendência possui precedência própria; não roubar sua resposta curta.
      return null;
    }

    if (isStandaloneWhatsappCommandWord(text)) {
      return result({
        action: "food_clarification_standalone_command_blocked",
        reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma operação compatível pendente. Envie a mensagem completa, por exemplo: registrar 100 g de arroz."),
        eventType: "whatsapp.food_clarification.standalone_command_blocked",
        detail: "Comando isolado bloqueado antes de parser, LLM e persistência nutricional.",
      });
    }

    const request = parseCountedFoodRequest(text);
    if (!request) return null;

    const candidates = resolveFoodClarificationCandidates(request.normalizedCandidate);
    const safeCandidates = candidates.filter(hasSafeCanonicalPortion);

    if (safeCandidates.length === 1 && !request.normalizationChanged) {
      const target = buildTarget({
        request,
        pendingKind: "confirmation",
        candidates: safeCandidates,
        selectedCandidateIndex: 0,
        instructionText: buildConfirmationInstruction(safeCandidates[0].name),
        messageId: input.messageId,
      });
      try {
        return await persistResolvedFood(deps, input.userId, target, safeCandidates[0], occurredAt, input.userTimezone);
      } catch {
        return createPending(deps, input.userId, target, occurredAt);
      }
    }

    if (safeCandidates.length === 1) {
      return createPending(deps, input.userId, buildTarget({
        request,
        pendingKind: "confirmation",
        candidates: safeCandidates,
        selectedCandidateIndex: 0,
        instructionText: buildConfirmationInstruction(safeCandidates[0].name),
        messageId: input.messageId,
      }), occurredAt);
    }

    if (safeCandidates.length > 1) {
      return createPending(deps, input.userId, buildTarget({
        request,
        pendingKind: "selection",
        candidates: safeCandidates,
        instructionText: buildSelectionInstruction(safeCandidates),
        messageId: input.messageId,
      }), occurredAt);
    }

    return createPending(deps, input.userId, buildTarget({
      request,
      pendingKind: "quantity",
      candidates,
      selectedCandidateIndex: candidates.length === 1 ? 0 : null,
      instructionText: buildQuantityInstruction(request.normalizedCandidate),
      messageId: input.messageId,
    }), occurredAt);
  };

  const completeClaimedCallback = async (input: {
    userId: number;
    pendingOperation: WhatsAppPendingOperationRecord;
    action: string;
    receivedAt?: Date;
    userTimezone?: string | null;
  }): Promise<WhatsappFoodClarificationResult> => {
    const target = input.pendingOperation.target;
    if (!isPendingFoodClarificationTarget(target) || !isExpectedWhatsappFoodClarificationAction(target, input.action)) {
      return unavailable("Callback não corresponde ao contrato alimentar persistido.");
    }
    if (input.action === "cancel") {
      return result({
        action: "food_clarification_cancelled",
        reply: buildWhatsAppActionCancelledReplyMessage("Não registrei o alimento pendente."),
        eventType: "whatsapp.food_clarification.cancelled",
        detail: "Callback cancelou a operação já reivindicada sem mutação.",
      });
    }

    const index = input.action === "confirm"
      ? target.selectedCandidateIndex ?? 0
      : Number(input.action.match(/^select:(\d+)$/)?.[1] ?? Number.NaN);
    const candidate = target.candidates[index];
    if (!candidate || !hasSafeCanonicalPortion(candidate)) {
      await recreateAfterFailure(deps, input.userId, {
        ...target,
        pendingKind: "quantity",
        classification: "open",
        selectedCandidateIndex: Number.isInteger(index) ? index : null,
        actions: buildActions("quantity", target.candidates),
        instructionText: buildQuantityInstruction(target.normalizedCandidate),
      }, input.receivedAt ?? new Date());
      return result({
        action: "food_clarification_reprompted",
        reply: buildWhatsAppClarificationReplyMessage(buildQuantityInstruction(target.normalizedCandidate)),
        eventType: "whatsapp.food_clarification.canonical_portion_missing",
        detail: "Callback não inferiu unidade sem porção canônica segura.",
      });
    }

    return persistAfterClaim(
      deps,
      input.userId,
      { ...target, selectedCandidateIndex: index },
      candidate,
      input.receivedAt ?? new Date(),
      input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
    );
  };

  return { handle, completeClaimedCallback };
}

const defaultService = createWhatsappFoodClarificationService();
export const handleWhatsappFoodClarification = defaultService.handle;
export const completeClaimedWhatsappFoodClarificationCallback = defaultService.completeClaimedCallback;
