import type { MealDraftItem } from "./nutritionEngineTypes";
import {
  listUserMeals,
  logInferenceEvent,
  updateUserMeal,
} from "./db";
import { supersedeActiveWhatsappPendingOperations } from "./modules/whatsapp/pendingOperationPrecedence";
import { NUTRITION_LABEL_PHOTO_REQUEST_ORIGIN } from "./modules/whatsapp/nutritionLabelPhotoInteraction";
import {
  NUTRITION_LABEL_PHOTO_REQUEST_TTL_MS,
  NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
  applyNutritionLabelPhotoToCandidate,
  buildCandidateIdentityKey,
  isNutritionLabelPhotoRequestTarget,
  normalize,
  pendingOperationRepository,
  type NutritionLabelPhotoClarificationCandidate,
  type NutritionLabelPhotoClarificationTarget,
  type NutritionLabelPhotoRequestTarget,
} from "./nutritionLabelCandidateService";

export async function listActiveNutritionLabelOperations(userId: number) {
  const pending = pendingOperationRepository.listActivePendingOperationsByType
    ? await pendingOperationRepository.listActivePendingOperationsByType(
        userId,
        NUTRITION_LABEL_PHOTO_REQUEST_TYPE
      )
    : pendingOperationRepository.getActivePendingOperationByType
      ? [
          await pendingOperationRepository.getActivePendingOperationByType(
            userId,
            NUTRITION_LABEL_PHOTO_REQUEST_TYPE
          ),
        ]
      : [await pendingOperationRepository.getActivePendingOperation(userId)];
  return pending.filter(
    (operation): operation is NonNullable<typeof operation> =>
      Boolean(
        operation &&
          operation.userId === userId &&
          operation.type === NUTRITION_LABEL_PHOTO_REQUEST_TYPE
      )
  );
}

export async function listActiveNutritionLabelPhotoRequests(userId: number) {
  return (await listActiveNutritionLabelOperations(userId)).filter(operation =>
    isNutritionLabelPhotoRequestTarget(operation.target)
  );
}

export function matchesNutritionLabelPhotoTarget(
  target: NutritionLabelPhotoRequestTarget,
  labelItem?: MealDraftItem
) {
  if (!labelItem) return target.candidateId != null;
  if (target.candidateId != null) return true;
  if (target.identityKey === buildCandidateIdentityKey(labelItem)) return true;
  const targetName = normalize(target.originalFoodName);
  const labelNames = [labelItem.foodName, labelItem.canonicalName]
    .map(normalize)
    .filter(Boolean);
  return labelNames.some(
    name => name.includes(targetName) || targetName.includes(name)
  );
}

export async function claimNutritionLabelPhotoRequest(
  userId: number,
  labelItem?: MealDraftItem
) {
  const requests = await listActiveNutritionLabelPhotoRequests(userId);
  const matching = requests.filter(request =>
    matchesNutritionLabelPhotoTarget(
      request.target as NutritionLabelPhotoRequestTarget,
      labelItem
    )
  );
  const pending =
    matching.length === 1
      ? matching[0]
      : requests.length === 1 &&
          (Boolean(labelItem) ||
            (requests[0].target as NutritionLabelPhotoRequestTarget).candidateId != null)
        ? requests[0]
        : null;
  if (!pending) return null;
  const claimed = await pendingOperationRepository.claimPendingOperation({
    id: pending.id,
    expectedVersion: pending.version,
  });
  return claimed.claimed ? pending : null;
}

export async function hasActiveNutritionLabelPhotoRequest(userId: number) {
  return (await listActiveNutritionLabelPhotoRequests(userId)).length > 0;
}

export function roundNutritionValue(value: number) {
  return Math.round(value * 10) / 10;
}

export function buildMealItemFromNutritionLabel(
  original: MealDraftItem,
  label: MealDraftItem
): MealDraftItem {
  const originalGrams = Number(original.estimatedGrams);
  const labelGrams = Number(label.estimatedGrams);
  const ratio =
    originalGrams > 0 && labelGrams > 0 ? originalGrams / labelGrams : 1;
  return {
    ...original,
    calories: roundNutritionValue(label.calories * ratio),
    protein: roundNutritionValue(label.protein * ratio),
    carbs: roundNutritionValue(label.carbs * ratio),
    fat: roundNutritionValue(label.fat * ratio),
    confidence: Math.max(original.confidence, label.confidence),
    source: label.source,
    resolution: {
      ...original.resolution,
      nutritionOrigin: "nutrition_label",
      nutritionVerified: true,
      productVariant:
        original.resolution?.productVariant ?? original.productVariant ?? null,
      barcode: original.resolution?.barcode ?? null,
      sourceUrls:
        label.resolution?.sourceUrls ?? original.resolution?.sourceUrls,
      sourceEvidence:
        label.resolution?.sourceEvidence ?? original.resolution?.sourceEvidence,
      sourceVerifiedAt:
        label.resolution?.sourceVerifiedAt ??
        original.resolution?.sourceVerifiedAt,
      sourceConfidence:
        label.resolution?.sourceConfidence ?? label.confidence,
    },
  };
}

export async function applyNutritionLabelPhotoToMeal(input: {
  mealId: number;
  itemIndex: number;
  userId: number;
  item: MealDraftItem;
  expectedIdentityKey?: string | null;
}) {
  const meal = (await listUserMeals(input.userId)).find(
    candidate => candidate.id === input.mealId
  );
  const original = meal?.items?.[input.itemIndex];
  if (!meal || !original) return null;
  if (
    original.resolution?.nutritionOrigin !== "provisional_estimate" ||
    original.resolution.nutritionVerified !== false
  ) {
    return null;
  }
  if (
    input.expectedIdentityKey &&
    buildCandidateIdentityKey(original) !== input.expectedIdentityKey
  ) {
    return null;
  }
  if (
    input.item.resolution?.nutritionOrigin !== "nutrition_label" ||
    input.item.resolution.nutritionVerified !== true ||
    !input.item.resolution.sourceEvidence?.trim() ||
    !Number.isFinite(input.item.estimatedGrams) ||
    input.item.estimatedGrams <= 0
  ) {
    return null;
  }

  const updatedItem = buildMealItemFromNutritionLabel(original, input.item);
  const updatedMeal = await updateUserMeal(
    {
      userId: input.userId,
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      occurredAt: new Date(meal.occurredAt).toISOString(),
      notes: meal.notes,
      items: meal.items.map((item, index) =>
        index === input.itemIndex ? updatedItem : item
      ),
    },
    { logEvent: false }
  );

  await recordNutritionLabelCandidates({
    userId: input.userId,
    mealId: meal.id,
    sourceText: meal.sourceText,
    items: [updatedItem],
    itemIndexes: [input.itemIndex],
  });
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "success",
    eventType: "nutrition_label_photo.meal_item_updated",
    detail: JSON.stringify({
      mealId: input.mealId,
      itemIndex: input.itemIndex,
      correctionOrigin: "nutrition_label",
      previousNutrition: {
        calories: original.calories,
        protein: original.protein,
        carbs: original.carbs,
        fat: original.fat,
      },
      updatedNutrition: {
        calories: updatedItem.calories,
        protein: updatedItem.protein,
        carbs: updatedItem.carbs,
        fat: updatedItem.fat,
      },
      commercialIdentityPreserved: true,
    }),
  });
  return updatedMeal;
}

export function nutritionLabelIdentityTokens(value: string | null | undefined) {
  return normalize(value)
    .split(" ")
    .filter(token =>
      token.length >= 3 &&
      !["tipo", "produto", "marca", "porcao"].includes(token)
    );
}

const NUTRITION_LABEL_GENERIC_PRODUCT_TOKENS = new Set([
  "alimento",
  "embalado",
  "embalada",
  "embalagem",
  "nutricional",
  "rotulo",
  "tabela",
]);

export function nutritionLabelProductTokens(
  value: string | null | undefined,
  excludedIdentities: Array<string | null | undefined> = []
) {
  const excluded = new Set(
    excludedIdentities.flatMap(identity => nutritionLabelIdentityTokens(identity))
  );
  return nutritionLabelIdentityTokens(value).filter(
    token =>
      !excluded.has(token) &&
      !NUTRITION_LABEL_GENERIC_PRODUCT_TOKENS.has(token)
  );
}

export function nutritionLabelTokenOverlap(left: string[], right: string[]) {
  return left.filter(token =>
    right.some(candidate =>
      token === candidate ||
      (token.length >= 4 &&
        candidate.length >= 4 &&
        (token.startsWith(candidate) || candidate.startsWith(token)))
    )
  ).length;
}

export function nutritionLabelIdentityScore(
  text: string | null | undefined,
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  const normalizedText = normalize(text);
  if (!normalizedText) return 0;
  let score = 0;
  const brand = normalize(candidate.originalBrand);
  if (brand && normalizedText.includes(brand)) score += 8;
  const canonical = normalize(candidate.originalCanonicalName);
  if (canonical && normalizedText.includes(canonical)) score += 6;
  score += nutritionLabelTokenOverlap(
    nutritionLabelIdentityTokens(normalizedText),
    [
      ...nutritionLabelIdentityTokens(candidate.originalFoodName),
      ...nutritionLabelIdentityTokens(candidate.originalCanonicalName),
    ]
  );
  return score;
}

export function nutritionLabelProductOverlap(
  text: string | null | undefined,
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  const candidateTokens = nutritionLabelProductTokens(
    [candidate.originalFoodName, candidate.originalCanonicalName]
      .filter(Boolean)
      .join(" "),
    [candidate.originalBrand]
  );
  const textTokens = nutritionLabelProductTokens(text, [candidate.originalBrand]);
  if (!candidateTokens.length || !textTokens.length) return 0;
  return nutritionLabelTokenOverlap(textTokens, candidateTokens);
}

export function nutritionLabelValuesCompatible(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

export function nutritionLabelCommercialConflictDimensions(
  item: MealDraftItem,
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  const brandConflict =
    Boolean(item.brand && candidate.originalBrand) &&
    !nutritionLabelValuesCompatible(item.brand, candidate.originalBrand);
  const candidateProductTokens = nutritionLabelProductTokens(
    [candidate.originalFoodName, candidate.originalCanonicalName]
      .filter(Boolean)
      .join(" "),
    [candidate.originalBrand]
  );
  const labelProductTokens = nutritionLabelProductTokens(
    [item.foodName, item.canonicalName].filter(Boolean).join(" "),
    [item.brand, candidate.originalBrand]
  );
  const productConflict =
    candidateProductTokens.length > 0 &&
    labelProductTokens.length > 0 &&
    nutritionLabelTokenOverlap(labelProductTokens, candidateProductTokens) === 0;
  const variant =
    item.productVariant ?? item.resolution?.productVariant ?? null;
  const variantConflict =
    Boolean(variant && candidate.originalProductVariant) &&
    !nutritionLabelValuesCompatible(
      variant,
      candidate.originalProductVariant
    );
  return { brandConflict, productConflict, variantConflict };
}

export function nutritionLabelCommercialConflict(
  item: MealDraftItem,
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  const conflicts = nutritionLabelCommercialConflictDimensions(item, candidate);
  return (
    conflicts.brandConflict ||
    conflicts.productConflict ||
    conflicts.variantConflict
  );
}

export function nutritionLabelConflictResolutionSatisfied(
  item: MealDraftItem,
  candidate: NutritionLabelPhotoClarificationCandidate,
  text?: string | null
) {
  const conflicts = nutritionLabelCommercialConflictDimensions(item, candidate);
  if (
    !conflicts.brandConflict &&
    !conflicts.productConflict &&
    !conflicts.variantConflict
  ) {
    return true;
  }

  const normalizedText = normalize(text);
  if (conflicts.brandConflict) {
    const brand = normalize(candidate.originalBrand);
    if (!brand || !normalizedText.includes(brand)) return false;
  }
  if (
    conflicts.productConflict &&
    nutritionLabelProductOverlap(text, candidate) === 0
  ) {
    return false;
  }
  if (conflicts.variantConflict) {
    const variant = normalize(candidate.originalProductVariant);
    if (!variant || !normalizedText.includes(variant)) return false;
  }
  return true;
}

export function isValidNutritionLabelEvidence(
  item?: MealDraftItem | null
): item is MealDraftItem {
  if (!item) return false;
  return Boolean(
    item.resolution?.nutritionOrigin === "nutrition_label" &&
      item.resolution.nutritionVerified === true &&
      item.resolution.sourceEvidence?.trim() &&
      Number.isFinite(item.estimatedGrams) &&
      item.estimatedGrams > 0 &&
      [item.calories, item.protein, item.carbs, item.fat].every(
        value => Number.isFinite(value) && value >= 0
      )
  );
}

export function nutritionLabelCandidateLabel(
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  const brand = candidate.originalBrand?.trim();
  return brand &&
    !normalize(candidate.originalFoodName).includes(normalize(brand))
    ? candidate.originalFoodName + " (" + brand + ")"
    : candidate.originalFoodName;
}

export async function buildNutritionLabelClarificationCandidates(
  userId: number,
  requests: Awaited<ReturnType<typeof listActiveNutritionLabelPhotoRequests>>
) {
  const meals = await listUserMeals(userId);
  const candidates: NutritionLabelPhotoClarificationCandidate[] = [];
  for (const request of requests) {
    const target = request.target as NutritionLabelPhotoRequestTarget;
    const meal = Number.isInteger(target.mealId)
      ? meals.find(candidate => candidate.id === target.mealId)
      : null;
    const original =
      meal && Number.isInteger(target.itemIndex)
        ? meal.items?.[target.itemIndex!]
        : null;
    if (
      Number.isInteger(target.mealId) &&
      Number.isInteger(target.itemIndex) &&
      !original
    ) {
      continue;
    }
    candidates.push({
      sourcePendingOperationId: request.id,
      sourceLocked: false,
      candidateId: target.candidateId,
      mealId: target.mealId,
      itemIndex: target.itemIndex,
      identityKey: target.identityKey,
      originalFoodName: target.originalFoodName,
      originalCanonicalName:
        target.originalCanonicalName ??
        original?.canonicalName ??
        target.originalFoodName,
      originalBrand: target.originalBrand ?? original?.brand ?? null,
      originalProductVariant:
        target.originalProductVariant ??
        original?.productVariant ??
        original?.resolution?.productVariant ??
        null,
    });
  }
  return candidates;
}

export async function createNutritionLabelPhotoClarification(input: {
  userId: number;
  candidates: NutritionLabelPhotoClarificationCandidate[];
  item: MealDraftItem;
  sourceText?: string | null;
  sourceMessageId?: string | null;
  conflict?: boolean;
  retry?: boolean;
}) {
  const labels = input.candidates.map(nutritionLabelCandidateLabel);
  const singleCandidateConflicts =
    input.candidates.length === 1
      ? nutritionLabelCommercialConflictDimensions(
          input.item,
          input.candidates[0]
        )
      : null;
  const instructionText =
    input.candidates.length > 1
      ? "Recebi o rótulo, mas há mais de um item provisório possível. Qual item devo atualizar? " +
        labels.map((label, index) => String(index + 1) + ". " + label).join(" | ") +
        ". Responda com o número ou o nome do item. A foto ficará guardada até a escolha."
      : input.retry
        ? "Não consegui concluir a atualização de " +
          labels[0] +
          ". A foto do rótulo continua guardada. Confirme o nome ou a marca para tentar novamente, ou envie CANCELAR."
        : input.conflict && singleCandidateConflicts?.productConflict
          ? "O rótulo recebido parece corresponder a outro produto, embora possa compartilhar a mesma marca de " +
            labels[0] +
            ". Não vou aplicar esses nutrientes automaticamente. Confirme o nome do produto correto, ou envie CANCELAR."
        : input.conflict
          ? "O rótulo recebido conflita com a identidade já confirmada de " +
            labels[0] +
            ". Não vou trocar a marca ou a variante automaticamente. Confirme o nome, a marca ou a variante correta, ou envie CANCELAR."
          : "Recebi o rótulo, mas a identidade não ficou inequívoca. A foto continua guardada. Confirme que ele pertence a " +
            labels[0] +
            ", ou envie CANCELAR.";
  const target: NutritionLabelPhotoClarificationTarget = {
    kind: "nutrition_label_photo_clarification",
    candidates: input.candidates,
    evidenceItem: input.item,
    sourceText: input.sourceText ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    instructionText,
    actions: [{ id: "cancel", title: "Cancelar" }],
  };
  const pending = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
    origin: NUTRITION_LABEL_PHOTO_REQUEST_ORIGIN,
    target,
    ttlMs: NUTRITION_LABEL_PHOTO_REQUEST_TTL_MS,
  });
  return pending ? { pending, target } : null;
}

export async function claimNutritionLabelClarificationSource(
  userId: number,
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  if (candidate.sourceLocked) return true;
  if (!candidate.sourcePendingOperationId) return false;
  const source = await pendingOperationRepository.getPendingOperationById(
    candidate.sourcePendingOperationId
  );
  if (
    !source ||
    source.userId !== userId ||
    source.state !== "active" ||
    source.type !== NUTRITION_LABEL_PHOTO_REQUEST_TYPE ||
    new Date(source.expiresAt).getTime() < Date.now() ||
    !isNutritionLabelPhotoRequestTarget(source.target)
  ) {
    return false;
  }
  const claimed = await pendingOperationRepository.claimPendingOperation({
    id: source.id,
    expectedVersion: source.version,
  });
  return claimed.claimed;
}

export async function applyNutritionLabelClarificationCandidate(input: {
  userId: number;
  candidate: NutritionLabelPhotoClarificationCandidate;
  item: MealDraftItem;
  sourceText?: string | null;
}) {
  if (
    Number.isInteger(input.candidate.mealId) &&
    Number.isInteger(input.candidate.itemIndex)
  ) {
    return applyNutritionLabelPhotoToMeal({
      mealId: input.candidate.mealId!,
      itemIndex: input.candidate.itemIndex!,
      userId: input.userId,
      item: input.item,
      expectedIdentityKey: input.candidate.identityKey,
    });
  }
  if (Number.isInteger(input.candidate.candidateId)) {
    return applyNutritionLabelPhotoToCandidate({
      candidateId: input.candidate.candidateId!,
      userId: input.userId,
      sourceText: input.sourceText,
      item: input.item,
    });
  }
  return null;
}
