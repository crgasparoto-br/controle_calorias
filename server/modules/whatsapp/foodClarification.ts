import { randomUUID } from "node:crypto";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { findCatalogFood } from "../../catalogMatching";
import { FOOD_CATALOG_REFERENCE } from "../../foodCatalogReference";
import { cleanFoodName, extractExplicitQuantities, normalizeText, parseQuantityUnitFromPortionText } from "../../mealTextParsing";
import { processMealInput } from "../../nutritionEngine";
import type { CatalogFood, MealDraftItem } from "../../nutritionEngineTypes";
import { findTacoFood } from "../../tacoLookup";
import { getDb, getHabitSnapshots, logPersistenceWarning } from "../../db";
import { consolidateWhatsAppMealAfterSave } from "./mealConsolidationService";
import { createManualMeal, listMeals, removeMeal, updateMeal } from "../meals/service";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
  type WhatsAppPendingOperationRepository,
} from "../../repositories/whatsappPendingOperationRepository";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
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
import { supersedeActiveWhatsappPendingOperations } from "./pendingOperationPrecedence";

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

export type WhatsappFoodClarificationResult = {
  handled: true;
  action: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

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

function normalizeCandidate(value: string) {
  const words = cleanFoodName(value).split(/\s+/).filter(Boolean);
  const normalizedWords = words.map(word => SAFE_TYPO_REPLACEMENTS[normalizeText(word)] ?? word);
  return cleanFoodName(normalizedWords.join(" "));
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
  if (!count || count <= 0 || count > 50 || !originalCandidate || NON_FOOD_COUNT_CONTEXT.test(originalCandidate)) return null;

  const normalizedCandidate = normalizeCandidate(originalCandidate);
  return {
    originalText,
    originalCandidate,
    normalizedCandidate,
    normalizationChanged: normalizeText(originalCandidate) !== normalizeText(normalizedCandidate),
    count,
  };
}

function snapshotCandidate(food: CatalogFood): FoodClarificationCandidate {
  return {
    name: food.name,
    servingLabel: food.servingLabel,
    gramsPerServing: food.gramsPerServing,
    brandName: food.brandName?.trim() || null,
    isBrandedProduct: Boolean(food.isBrandedProduct || food.brandName),
  };
}

function exactReferenceCandidates(candidate: string) {
  const normalized = normalizeText(candidate);
  return FOOD_CATALOG_REFERENCE
    .filter(food => [food.name, ...food.aliases].some(name => normalizeText(name) === normalized))
    .map(food => snapshotCandidate(food as CatalogFood));
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
  const exact = exactReferenceCandidates(candidate);
  const catalog = findCatalogFood(candidate);
  const taco = findTacoFood(candidate);
  return uniqueCandidates([
    ...exact,
    ...(catalog ? [snapshotCandidate(catalog)] : []),
    ...(taco ? [snapshotCandidate(taco)] : []),
  ]);
}

export function hasSafeCanonicalPortion(candidate: FoodClarificationCandidate) {
  if (!Number.isFinite(candidate.gramsPerServing) || candidate.gramsPerServing <= 0) return false;
  if (/^100\s*g$/i.test(candidate.servingLabel.trim())) return false;
  if (COUNTABLE_SERVING.test(candidate.servingLabel)) return true;
  return candidate.isBrandedProduct && EXPLICIT_MASS_OR_VOLUME.test(candidate.servingLabel.trim()) !== null;
}

function resolveSafeCandidates(candidates: FoodClarificationCandidate[]) {
  return candidates.filter(hasSafeCanonicalPortion);
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

function buildTarget(input: {
  request: CountedFoodRequest;
  pendingKind: FoodClarificationKind;
  candidates: FoodClarificationCandidate[];
  selectedCandidateIndex?: number | null;
  instructionText: string;
  messageId?: string | null;
}): PendingFoodClarificationTarget {
  const classification: FoodClarificationClassification = input.pendingKind === "quantity" ? "open" : "closed";
  const actions = input.pendingKind === "quantity"
    ? [
        { id: "provide_quantity", label: "Informar quantidade", effect: "complete_original_food" },
        { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
      ]
    : input.pendingKind === "confirmation"
      ? [
          { id: "confirm", label: "Confirmar", effect: "register_original_food_once" },
          { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
        ]
      : [
          ...input.candidates.map((_, index) => ({ id: `select:${index}`, label: `Opção ${index + 1}`, effect: "select_candidate" })),
          { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
        ];

  return {
    contractVersion: 1,
    interactionId: randomUUID(),
    kind: "food_registration_clarification",
    classification,
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
    actions,
    instructionText: input.instructionText,
    inboundMessageId: input.messageId?.trim() || null,
    allowedDomainEffect: "register_original_food_once",
  };
}

export function isPendingFoodClarificationTarget(value: unknown): value is PendingFoodClarificationTarget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingFoodClarificationTarget>;
  return candidate.contractVersion === 1
    && candidate.kind === "food_registration_clarification"
    && ["confirmation", "quantity", "selection"].includes(candidate.pendingKind ?? "")
    && typeof candidate.originalText === "string"
    && typeof candidate.normalizedCandidate === "string"
    && typeof candidate.count === "number"
    && Array.isArray(candidate.candidates)
    && typeof candidate.instructionText === "string";
}

function buildResult(input: {
  action: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
}): WhatsappFoodClarificationResult {
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
    allowedDomainEffect: target.allowedDomainEffect,
  };
}

function inferCountUnit(candidate: FoodClarificationCandidate) {
  const parsed = parseQuantityUnitFromPortionText(candidate.servingLabel);
  if (parsed && COUNTABLE_SERVING.test(parsed.unit)) return parsed.unit;
  return "unidades";
}

function buildRegistrationText(target: PendingFoodClarificationTarget, candidate: FoodClarificationCandidate, explicitQuantity?: { quantity: number; unit: string }) {
  if (explicitQuantity) {
    return `${explicitQuantity.quantity} ${explicitQuantity.unit} de ${target.normalizedCandidate}`;
  }

  if (COUNTABLE_SERVING.test(candidate.servingLabel)) {
    return `${target.count} ${inferCountUnit(candidate)} de ${target.normalizedCandidate}`;
  }

  const grams = Math.round(candidate.gramsPerServing * target.count * 100) / 100;
  return `${grams} g de ${target.normalizedCandidate}`;
}

function sameLogicalMeal(meal: { mealLabel: string; occurredAt: Date | number | string }, mealLabel: string, occurredAt: Date, timeZone: string) {
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
  const registrationText = buildRegistrationText(target, candidate, explicitQuantity);
  const processed = await deps.processFood({
    text: registrationText,
    habits: await deps.getHabits(userId),
    occurredAt,
    timeZone,
  });
  if (!processed.items.length) {
    throw new Error("A resolução da pendência não produziu alimento válido.");
  }

  const existingMeals = await deps.listMeals(userId);
  const existing = existingMeals.find(meal => sameLogicalMeal(meal, processed.detectedMealLabel, occurredAt, timeZone));
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

  const consolidated = await consolidateWhatsAppMealAfterSave({
    listUserMeals: deps.listMeals,
    updateUserMeal: deps.updateMeal,
    removeUserMeal: deps.removeMeal,
  }, saved, timeZone);
  const meal = consolidated.meal;
  const reply = await composeWhatsAppMealActionReply({
    userId,
    meal,
    timeZone,
    options: {
      title: consolidated.action === "updated" ? "Alimento adicionado" : "Alimento registrado",
      actionLines: [`Registrei ${target.normalizedCandidate} usando a quantidade confirmada, sem usar uma palavra de continuidade como alimento.`],
      mealResultState: consolidated.action === "updated" ? "updated" : "registered",
    },
  });

  return buildResult({
    action: "food_clarification_completed",
    reply,
    eventType: "whatsapp.food_clarification.completed",
    detail: "Pendência alimentar resolvida com texto original preservado, serviço canônico e estado persistido recarregado.",
    data: {
      mealId: meal.id,
      interactionId: target.interactionId,
      originalTextPreserved: true,
      normalizedCandidate: target.normalizedCandidate,
      resolvedQuantity: explicitQuantity ?? { count: target.count, servingLabel: candidate.servingLabel },
    },
  });
}

async function recreateAfterFailure(deps: FoodClarificationDependencies, userId: number, target: PendingFoodClarificationTarget, occurredAt: Date) {
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
  const quantities = extractExplicitQuantities(text?.trim() ?? "");
  if (quantities.length !== 1) return null;
  return { quantity: quantities[0].quantity, unit: quantities[0].unit };
}

function parseSelectionReply(text?: string | null, candidateCount = 0) {
  const normalized = normalizeStandaloneWhatsappCommand(text);
  const match = normalized.match(/^(?:opcao\s*)?(\d{1,2})$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < candidateCount ? index : -1;
}

function isFullNewCommand(text?: string | null) {
  const normalized = text?.trim() ?? "";
  return Boolean(normalized && !isStandaloneWhatsappCommandWord(normalized) && /\p{L}/u.test(normalized) && normalized.split(/\s+/).length >= 2);
}

async function resolvePending(
  deps: FoodClarificationDependencies,
  userId: number,
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  text: string | null | undefined,
  occurredAt: Date,
  timeZone: string,
): Promise<WhatsappFoodClarificationResult | null | "new_command"> {
  if (isStandaloneWhatsappCancellationWord(text)) {
    const cancelled = await deps.repository.cancelPendingOperation(pending.id);
    if (!cancelled.cancelled) {
      return buildResult({
        action: "food_clarification_unavailable",
        reply: buildWhatsAppCallbackUnavailableReplyMessage(),
        eventType: "whatsapp.food_clarification.unavailable",
        detail: "Pendência alimentar não pôde ser cancelada porque já foi resolvida, substituída ou expirou.",
      });
    }
    return buildResult({
      action: "food_clarification_cancelled",
      reply: buildWhatsAppActionCancelledReplyMessage("Não registrei o alimento pendente."),
      eventType: "whatsapp.food_clarification.cancelled",
      detail: "Pendência alimentar cancelada sem mutação.",
      data: pendingData({ ...pending, state: "cancelled" }, target),
    });
  }

  if (target.pendingKind === "quantity") {
    const quantity = parseQuantityReply(text);
    if (!quantity) {
      if (isFullNewCommand(text)) return "new_command";
      return buildResult({
        action: "food_clarification_reprompted",
        reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
        eventType: "whatsapp.food_clarification.invalid_quantity_response",
        detail: "Resposta incompatível não consumiu a pendência aberta de quantidade.",
        data: pendingData(pending, target),
      });
    }
    const claimed = await deps.repository.claimPendingOperation({ id: pending.id, expectedVersion: pending.version });
    if (!claimed.claimed) {
      return buildResult({
        action: "food_clarification_unavailable",
        reply: buildWhatsAppCallbackUnavailableReplyMessage(),
        eventType: "whatsapp.food_clarification.unavailable",
        detail: "Claim atômico da pendência alimentar falhou.",
      });
    }
    const candidate = target.candidates[target.selectedCandidateIndex ?? 0]
      ?? { name: target.normalizedCandidate, servingLabel: `${quantity.quantity} ${quantity.unit}`, gramsPerServing: quantity.quantity, brandName: null, isBrandedProduct: false };
    try {
      return await persistResolvedFood(deps, userId, target, candidate, occurredAt, timeZone, quantity);
    } catch {
      await recreateAfterFailure(deps, userId, target, occurredAt);
      return buildResult({
        action: "food_clarification_retryable_failure",
        reply: buildWhatsAppRecoverableErrorReplyMessage(`Não consegui concluir o registro agora. Mantive ${target.normalizedCandidate} pendente; envie novamente a quantidade.`),
        eventType: "whatsapp.food_clarification.retryable_failure",
        detail: "Falha de domínio após claim recriou a pendência sem descartar o texto original.",
      });
    }
  }

  let selectedIndex = target.selectedCandidateIndex ?? 0;
  if (target.pendingKind === "confirmation") {
    if (!isStandaloneWhatsappConfirmationWord(text)) {
      if (isFullNewCommand(text)) return "new_command";
      return buildResult({
        action: "food_clarification_reprompted",
        reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
        eventType: "whatsapp.food_clarification.invalid_confirmation_response",
        detail: "Resposta incompatível não consumiu a confirmação alimentar.",
        data: pendingData(pending, target),
      });
    }
  } else {
    const selection = parseSelectionReply(text, target.candidates.length);
    if (selection === null || selection < 0) {
      if (isFullNewCommand(text)) return "new_command";
      return buildResult({
        action: "food_clarification_reprompted",
        reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
        eventType: "whatsapp.food_clarification.invalid_selection_response",
        detail: "Opção inválida não consumiu a seleção alimentar.",
        data: pendingData(pending, target),
      });
    }
    selectedIndex = selection;
  }

  const candidate = target.candidates[selectedIndex];
  if (!candidate || !hasSafeCanonicalPortion(candidate)) {
    return buildResult({
      action: "food_clarification_reprompted",
      reply: buildWhatsAppClarificationReplyMessage(buildQuantityInstruction(target.normalizedCandidate)),
      eventType: "whatsapp.food_clarification.canonical_portion_missing",
      detail: "Candidato selecionado não possui porção canônica segura; nenhuma unidade foi inferida.",
      data: pendingData(pending, target),
    });
  }

  const claimed = await deps.repository.claimPendingOperation({ id: pending.id, expectedVersion: pending.version });
  if (!claimed.claimed) {
    return buildResult({
      action: "food_clarification_unavailable",
      reply: buildWhatsAppCallbackUnavailableReplyMessage(),
      eventType: "whatsapp.food_clarification.unavailable",
      detail: "Claim atômico da pendência alimentar falhou.",
    });
  }
  try {
    return await persistResolvedFood(deps, userId, { ...target, selectedCandidateIndex: selectedIndex }, candidate, occurredAt, timeZone);
  } catch {
    await recreateAfterFailure(deps, userId, target, occurredAt);
    return buildResult({
      action: "food_clarification_retryable_failure",
      reply: buildWhatsAppRecoverableErrorReplyMessage(`Não consegui concluir o registro agora. Mantive ${target.normalizedCandidate} pendente; confirme novamente.`),
      eventType: "whatsapp.food_clarification.retryable_failure",
      detail: "Falha de domínio após claim recriou a pendência sem descartar o texto original.",
    });
  }
}

async function createPending(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  occurredAt: Date,
): Promise<WhatsappFoodClarificationResult> {
  const replaced = await supersedeActiveWhatsappPendingOperations(userId, occurredAt);
  if (!replaced) {
    return buildResult({
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage("Não consegui substituir a operação pendente com segurança. Cancele a anterior e envie o alimento novamente."),
      eventType: "whatsapp.food_clarification.pending_replacement_blocked",
      detail: "Criação da pendência alimentar bloqueada porque uma operação anterior não pôde ser substituída.",
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
    return buildResult({
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage("Não consegui guardar o contexto do alimento com segurança. Envie a mensagem completa novamente."),
      eventType: "whatsapp.food_clarification.persistence_unavailable",
      detail: "Persistência da pendência alimentar indisponível; fallback nutricional bloqueado.",
    });
  }
  return buildResult({
    action: "food_clarification_requested",
    reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
    eventType: "whatsapp.food_clarification.requested",
    detail: "Pergunta alimentar específica criada em whatsappPendingOperations com contrato consumível pela #858.",
    data: pendingData(created, target),
  });
}

export function createWhatsappFoodClarificationService(overrides: Partial<FoodClarificationDependencies> = {}) {
  const deps = { ...defaultDependencies, ...overrides };

  return async function handleWhatsappFoodClarification(input: {
    userId: number;
    text?: string | null;
    receivedAt?: Date;
    userTimezone: string;
    messageId?: string | null;
  }): Promise<WhatsappFoodClarificationResult | null> {
    const occurredAt = input.receivedAt ?? new Date();
    const text = input.text?.trim() ?? "";
    const active = await deps.repository.getActivePendingOperation(input.userId, occurredAt);

    if (active?.type === PENDING_FOOD_CLARIFICATION_TYPE && isPendingFoodClarificationTarget(active.target)) {
      const pendingResult = await resolvePending(deps, input.userId, active, active.target, text, occurredAt, input.userTimezone);
      if (pendingResult !== "new_command") return pendingResult;
      const superseded = await deps.repository.supersedePendingOperation(active.id);
      if (!superseded.superseded) {
        return buildResult({
          action: "food_clarification_blocked",
          reply: buildWhatsAppRecoverableErrorReplyMessage("Não consegui substituir a operação pendente com segurança. Cancele a anterior e tente novamente."),
          eventType: "whatsapp.food_clarification.pending_replacement_blocked",
          detail: "Novo comando completo foi bloqueado porque a pendência alimentar não pôde ser substituída.",
        });
      }
    }

    if (isStandaloneWhatsappCommandWord(text)) {
      return buildResult({
        action: "food_clarification_standalone_command_blocked",
        reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma operação compatível pendente. Envie a mensagem completa, por exemplo: registrar 100 g de arroz."),
        eventType: "whatsapp.food_clarification.standalone_command_blocked",
        detail: "Comando isolado bloqueado antes de parser, LLM e persistência nutricional.",
      });
    }

    const request = parseCountedFoodRequest(text);
    if (!request) return null;

    const candidates = resolveFoodClarificationCandidates(request.normalizedCandidate);
    const safeCandidates = resolveSafeCandidates(candidates);

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

    if (safeCandidates.length === 1 && request.normalizationChanged) {
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
}

export const handleWhatsappFoodClarification = createWhatsappFoodClarificationService();
