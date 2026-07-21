import {
  hasSafeCanonicalPortion,
  type CountedFoodRequest,
  type FoodClarificationCandidate,
} from "./foodClarificationContract";

export type FoodClarificationPlan =
  | { kind: "register"; candidate: FoodClarificationCandidate }
  | { kind: "confirmation"; candidate: FoodClarificationCandidate }
  | { kind: "selection"; candidates: FoodClarificationCandidate[] }
  | { kind: "quantity"; candidates: FoodClarificationCandidate[] };

/**
 * Decide a única próxima ação permitida sem misturar transporte ou domínio.
 * Erro ortográfico com múltiplos candidatos nunca escolhe silenciosamente um
 * alimento; a seleção ocorre antes de uma eventual pergunta aberta de tamanho.
 */
export function planFoodClarification(
  request: CountedFoodRequest,
  candidates: FoodClarificationCandidate[],
): FoodClarificationPlan {
  const safeCandidates = candidates.filter(hasSafeCanonicalPortion);

  if (safeCandidates.length === 1 && !request.normalizationChanged) {
    return { kind: "register", candidate: safeCandidates[0] };
  }
  if (safeCandidates.length === 1) {
    return { kind: "confirmation", candidate: safeCandidates[0] };
  }
  if (safeCandidates.length > 1) {
    return { kind: "selection", candidates: safeCandidates };
  }
  if (request.normalizationChanged && candidates.length > 1) {
    return { kind: "selection", candidates };
  }
  return { kind: "quantity", candidates };
}
