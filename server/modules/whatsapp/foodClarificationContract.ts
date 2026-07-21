import { findCatalogFood } from "../../catalogMatching";
import { FOOD_CATALOG_REFERENCE } from "../../foodCatalogReference";
import {
  cleanFoodName,
  extractExplicitQuantities,
  normalizeText,
  parseQuantityUnitFromPortionText,
} from "../../mealTextParsing";
import type { CatalogFood } from "../../nutritionEngineTypes";
import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { findTacoFood } from "../../tacoLookup";
import {
  isStandaloneWhatsappCommandWord,
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

export type CountedFoodRequest = {
  originalText: string;
  originalCandidate: string;
  normalizedCandidate: string;
  normalizationChanged: boolean;
  count: number;
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
const DESTRUCTIVE_OR_QUERY_COMMAND = /\b(?:excluir|remover|apagar|deletar|trocar|corrigir|alterar|consultar|resumo|relatorio)\b/i;
const COMPLETE_COMMAND_SIGNAL = /\b(?:registrar|registre|registra|adicionar|adicione|adiciona|incluir|inclua|comi|bebi|tomei|excluir|remover|apagar|deletar|trocar|corrigir|alterar|consultar|resumo|relatorio)\b/i;
const COUNTABLE_SERVING = /\b(?:unidade|unid|und|fatia|pedaco|x[ií]cara|copo|colher|dose|scoop|lata|garrafa|long\s*neck|por[cç][aã]o)\b/i;
const EXPLICIT_MASS_OR_VOLUME = /^(\d+(?:[,.]\d+)?)\s*(g|gramas?|ml|mililitros?|l|litros?)\b/i;
const QUANTITY_ONLY_REPLY = /^\s*\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?)\s*$/i;
const COMPLETE_EXPLICIT_FOOD = /^\s*\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?)\s+(?:de\s+)?[\p{L}][\p{L}\p{N}\s'’-]*$/iu;

function normalizeCandidate(value: string) {
  return cleanFoodName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(word => SAFE_TYPO_REPLACEMENTS[normalizeText(word)] ?? word)
    .join(" ");
}

/**
 * Normalização lexical usada somente para comparar identidade de catálogo.
 * Não altera o texto preservado e não é tratada como correção ortográfica.
 */
function normalizeFoodIdentity(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(word => {
      if (word.length <= 3 || !word.endsWith("s")) return word;
      return word.slice(0, -1);
    })
    .join(" ");
}

function parseCount(value: string) {
  const normalized = normalizeStandaloneWhatsappCommand(value);
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return COUNT_WORDS[normalized] ?? null;
}

export function parseCountedFoodRequest(text?: string | null): CountedFoodRequest | null {
  const originalText = text?.trim() ?? "";
  if (!originalText || DESTRUCTIVE_OR_QUERY_COMMAND.test(originalText)) return null;
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
  const normalized = normalizeFoodIdentity(candidate);
  return [food.name, ...food.aliases].some(name => normalizeFoodIdentity(name) === normalized);
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
    ...(taco ? [toCandidate(taco, normalizeFoodIdentity(taco.name) === normalizeFoodIdentity(candidate) ? "exact" : "fallback")] : []),
  ]);
}

export function hasSafeCanonicalPortion(candidate: FoodClarificationCandidate) {
  if (candidate.matchKind !== "exact") return false;
  if (!Number.isFinite(candidate.gramsPerServing) || candidate.gramsPerServing <= 0) return false;
  if (/^100\s*g$/i.test(candidate.servingLabel.trim())) return false;
  if (COUNTABLE_SERVING.test(candidate.servingLabel)) return true;
  return candidate.isBrandedProduct && EXPLICIT_MASS_OR_VOLUME.test(candidate.servingLabel.trim()) !== null;
}

export function buildQuantityInstruction(candidate: string) {
  return `Qual é o tamanho, peso ou volume de ${candidate}? Responda, por exemplo, 170 g ou 200 ml. Não vou assumir 100 g como uma unidade.`;
}

export function buildConfirmationInstruction(candidate: string) {
  return `Você quis dizer ${candidate}? Responda SIM para registrar o alimento original ou CANCELAR para desistir.`;
}

export function buildSelectionInstruction(candidates: FoodClarificationCandidate[]) {
  const options = candidates.map((candidate, index) => `${index + 1}. ${candidate.name} — ${candidate.servingLabel}`).join("\n");
  return `Encontrei mais de um alimento possível. Qual deles você quis dizer?\n${options}\n\nResponda com o número ou CANCELAR.`;
}

export function buildFoodClarificationActions(kind: FoodClarificationKind, candidates: FoodClarificationCandidate[]) {
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

export function buildPendingFoodClarificationTarget(input: {
  interactionId: string;
  request: CountedFoodRequest;
  pendingKind: FoodClarificationKind;
  candidates: FoodClarificationCandidate[];
  selectedCandidateIndex?: number | null;
  instructionText: string;
  messageId?: string | null;
}): PendingFoodClarificationTarget {
  return {
    contractVersion: 1,
    interactionId: input.interactionId,
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
    actions: buildFoodClarificationActions(input.pendingKind, input.candidates),
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

export function buildFoodClarificationPendingData(
  pending: Pick<WhatsAppPendingOperationRecord, "id" | "type" | "state" | "version">,
  target: PendingFoodClarificationTarget,
) {
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

export function buildFoodClarificationRegistrationText(
  target: PendingFoodClarificationTarget,
  candidate: FoodClarificationCandidate,
  explicitQuantity?: { quantity: number; unit: string },
) {
  if (explicitQuantity) return `${explicitQuantity.quantity} ${explicitQuantity.unit} de ${candidate.name}`;
  if (COUNTABLE_SERVING.test(candidate.servingLabel)) {
    return `${target.count} ${inferCountUnit(candidate)} de ${candidate.name}`;
  }
  const grams = Math.round(candidate.gramsPerServing * target.count * 100) / 100;
  return `${grams} g de ${candidate.name}`;
}

export function parseFoodClarificationQuantityReply(text?: string | null) {
  const raw = normalizeStandaloneWhatsappCommand(text);
  if (!QUANTITY_ONLY_REPLY.test(raw)) return null;
  const quantities = extractExplicitQuantities(raw);
  return quantities.length === 1
    ? { quantity: quantities[0].quantity, unit: quantities[0].unit }
    : null;
}

export function parseFoodClarificationSelectionReply(text?: string | null, candidateCount = 0) {
  const match = normalizeStandaloneWhatsappCommand(text).match(/^(?:opcao\s*)?(\d{1,2})$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < candidateCount ? index : -1;
}

export function isCompleteWhatsappCommand(text?: string | null) {
  const raw = text?.trim() ?? "";
  if (!raw || isStandaloneWhatsappCommandWord(raw)) return false;
  const normalized = normalizeStandaloneWhatsappCommand(raw);
  const explicitFood = COMPLETE_EXPLICIT_FOOD.test(normalized);
  const countedFood = parseCountedFoodRequest(raw) !== null;
  const operationalCommand = COMPLETE_COMMAND_SIGNAL.test(normalized) && normalized.split(/\s+/).length >= 2;
  return explicitFood || countedFood || operationalCommand;
}

export function isExpectedWhatsappFoodClarificationAction(target: PendingFoodClarificationTarget, action: string) {
  if (target.pendingKind === "quantity") return action === "cancel";
  return target.actions.some(candidate => candidate.id === action);
}
