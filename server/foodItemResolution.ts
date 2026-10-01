/**
 * Fronteira canônica de resolução de item alimentar (#1244).
 *
 * Este módulo é o owner único de três decisões que antes eram reexecutadas por
 * caminhos parcialmente paralelos (registro, adição, imagem e simulador):
 *
 * 1. **quantidade/medida** — precedência entre massa/volume explícitos, porção
 *    canônica local e medida caseira (`resolveCanonicalFoodQuantity`);
 * 2. **especificidade comercial** — quando uma marca exige variante adicional,
 *    quando a identidade já basta para uma referência provisória compatível e
 *    quando a pendência é apenas nutricional (`decideCommercialNutritionPolicy`);
 * 3. **contrato de paridade** — a projeção `FoodResolutionResult`, usada para
 *    comparar semanticamente a decisão de entrypoints diferentes.
 *
 * Adapters de canal/operação apenas traduzem entrada e saída; não redefinem
 * identidade, quantidade, compatibilidade comercial, fallback nutricional ou
 * motivo de clarificação.
 */
import {
  findCatalogFood,
  findGenericCatalogFood,
  findNaturalProduceCatalogFood,
} from "./catalogMatching";
import { detectKnownBrand } from "./foodBrandDetection";
import {
  resolveHouseholdMeasure,
  type HouseholdMeasureResolution,
  type HouseholdMeasureResolutionInput,
  type HouseholdMeasureResolutionKind,
} from "./householdMeasureResolution";
import {
  normalizeForMatching,
  normalizeUnit,
  parseQuantityUnitFromPortionText,
} from "./mealTextParsing";
import type {
  CatalogFood,
  LlmItem,
  MealDraftItem,
  MealSemanticAlternative,
  MealSemanticClarificationCode,
  MealSemanticEvidenceOrigin,
} from "./nutritionEngineTypes";
import { findTacoFood } from "./tacoLookup";

const MASS_VOLUME_UNITS = new Set(["mg", "g", "kg", "ml", "l"]);

// ---------------------------------------------------------------------------
// Quantidade: porção canônica local
// ---------------------------------------------------------------------------

const CURATED_COMMON_COUNTABLE_PORTIONS: Array<{
  aliases: string[];
  food: CatalogFood;
}> = [
  {
    aliases: ["mussarela", "muçarela", "mozarela", "queijo mussarela", "queijo muçarela", "queijo mozarela"],
    food: {
      slug: "curated-queijo-mussarela-fatia",
      name: "Queijo mussarela",
      aliases: ["mussarela", "muçarela", "mozarela"],
      servingLabel: "1 fatia",
      gramsPerServing: 20,
      calories: 65.97,
      protein: 4.53,
      carbs: 0.61,
      fat: 5.04,
    },
  },
  {
    aliases: ["presunto", "presunto cozido", "fatia de presunto"],
    food: {
      slug: "curated-presunto-fatia",
      name: "Presunto cozido",
      aliases: ["presunto", "presunto cozido"],
      servingLabel: "1 fatia",
      gramsPerServing: 18,
      calories: 23.01,
      protein: 2.59,
      carbs: 0.25,
      fat: 1.22,
    },
  },
  {
    aliases: ["mortadela", "fatia de mortadela"],
    food: {
      slug: "curated-mortadela-fatia",
      name: "Mortadela",
      aliases: ["mortadela"],
      servingLabel: "1 fatia",
      gramsPerServing: 15,
      calories: 40.32,
      protein: 1.79,
      carbs: 0.87,
      fat: 3.25,
    },
  },
];

function normalizeCuratedFoodName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findCuratedCommonPortion(foodName: string) {
  const normalized = normalizeCuratedFoodName(foodName);
  return CURATED_COMMON_COUNTABLE_PORTIONS.find(item =>
    item.aliases.some(alias => normalizeCuratedFoodName(alias) === normalized),
  )?.food;
}

export function findCountableCatalogReference(foodName: string) {
  const direct = findCatalogFood(foodName);
  if (direct) return direct;

  // O catálogo de nutrição mantém o preparo frito no TACO, mas a porção de
  // unidade pertence à referência genérica de ovo. A referência é usada
  // somente para converter a unidade em gramas; a identidade do item preserva
  // o preparo para que o motor nutricional selecione a composição correta.
  const normalized = normalizeCuratedFoodName(foodName);
  if (!/^ovos?(?: (?:frit[oa]s?|cozid[oa]s?|mexid[oa]s?))?$/u.test(normalized)) {
    return undefined;
  }

  return findCatalogFood("ovo");
}

/**
 * Resolve a nutrition reference for a countable item after its quantity has
 * already been accepted. This is deliberately owned by the canonical food
 * resolution boundary so adapters can materialize the decision without
 * rediscovering nutrition from rewritten registration text.
 */
export function findCountableNutritionReference(foodName: string): CatalogFood | undefined {
  return findCatalogFood(foodName) ?? findTacoFood(foodName) ?? undefined;
}

export type CountableFoodQuantityRequest = {
  segment: string;
  foodName: string;
  brand: string | null;
  count: number;
  requestedUnit: string;
};

export function getSafeCatalogCountableGrams(
  food: CatalogFood | null | undefined,
  request: CountableFoodQuantityRequest,
  includeCuratedCommonPortion = false,
) {
  if (request.brand) return null;
  const effectiveFood = food ?? (
    includeCuratedCommonPortion ? findCuratedCommonPortion(request.foodName) : undefined
  );
  if (!effectiveFood || !effectiveFood.servingLabel || !effectiveFood.gramsPerServing) return null;
  const serving = parseQuantityUnitFromPortionText(effectiveFood.servingLabel);
  if (!serving || !serving.quantity || !serving.unit) return null;
  const servingUnit = normalizeUnit(serving.unit);
  const requestedUnit = normalizeUnit(request.requestedUnit);
  if (MASS_VOLUME_UNITS.has(servingUnit) || servingUnit !== requestedUnit) return null;
  const grams = (effectiveFood.gramsPerServing * request.count) / serving.quantity;
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

export function resolveSafeCountableCatalogGrams(
  foodName: string,
  count: number,
  requestedUnit = "un",
  includeCuratedCommonPortion = false,
) {
  const request: CountableFoodQuantityRequest = {
    segment: foodName,
    foodName,
    brand: detectKnownBrand(foodName),
    count,
    requestedUnit,
  };
  const food = findCountableCatalogReference(foodName) ?? (
    includeCuratedCommonPortion ? findCuratedCommonPortion(foodName) : undefined
  );
  const grams = getSafeCatalogCountableGrams(
    food,
    request,
    includeCuratedCommonPortion,
  );
  return grams && food ? { food, grams } : null;
}

// ---------------------------------------------------------------------------
// Quantidade: precedência canônica
// ---------------------------------------------------------------------------

export type FoodQuantityResolutionKind =
  | "explicit_mass_or_volume"
  | HouseholdMeasureResolutionKind;

export type FoodQuantityResolution = {
  kind: FoodQuantityResolutionKind;
  originalQuantity: number;
  originalUnit: string;
  grams: number;
  evidence: string | null;
  sourceUrls: string[];
  referenceCount: number;
  /** Resolução de medida caseira completa, quando a unidade não é massa/volume. */
  householdMeasure: HouseholdMeasureResolution | null;
};

export function isMassOrVolumeUnit(unit: string) {
  return MASS_VOLUME_UNITS.has(normalizeUnit(unit));
}

function explicitMassOrVolumeGrams(quantity: number, unit: string) {
  switch (unit) {
    case "kg": return quantity * 1000;
    case "mg": return quantity / 1000;
    case "l": return quantity * 1000;
    default: return quantity;
  }
}

export type CanonicalFoodQuantityInput = Omit<
  HouseholdMeasureResolutionInput,
  "quantity" | "unit"
> & {
  quantity: number;
  unit: string;
};

type CanonicalFoodQuantityRuntime = {
  resolveHouseholdMeasure: typeof resolveHouseholdMeasure;
};

const defaultQuantityRuntime: CanonicalFoodQuantityRuntime = {
  resolveHouseholdMeasure,
};

/**
 * Owner único da precedência de quantidade de um item:
 *
 * ```text
 * massa/volume explícitos
 * -> porção canônica local (sem identidade comercial pendente)
 * -> medida caseira (produto comercial aceito, catálogo, pessoal, pesquisa)
 * -> null (clarificação de quantidade)
 * ```
 *
 * Massa/volume explícitos nunca são reabertos. A porção canônica local fornece
 * apenas gramatura; o nome recebido (por exemplo `ovo frito`) permanece a
 * identidade nutricional do item.
 */
export async function resolveCanonicalFoodQuantity(
  input: CanonicalFoodQuantityInput,
  runtime: CanonicalFoodQuantityRuntime = defaultQuantityRuntime,
): Promise<FoodQuantityResolution | null> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  const unit = normalizeUnit(input.unit);

  if (MASS_VOLUME_UNITS.has(unit)) {
    return {
      kind: "explicit_mass_or_volume",
      originalQuantity: input.quantity,
      originalUnit: unit,
      grams: explicitMassOrVolumeGrams(input.quantity, unit),
      evidence: null,
      sourceUrls: [],
      referenceCount: 0,
      householdMeasure: null,
    };
  }

  if (!input.brand && !input.commercialFood) {
    const local = resolveSafeCountableCatalogGrams(input.foodName, input.quantity, unit, true);
    if (local) {
      const grams = Number(local.grams.toFixed(2));
      const householdMeasure: HouseholdMeasureResolution = {
        kind: "canonical_portion",
        grams,
        requestedQuantity: input.quantity,
        requestedUnit: unit,
        evidence: `${local.food.servingLabel} = ${local.food.gramsPerServing} g`,
        sourceUrls: [],
        referenceCount: 1,
      };
      return fromHouseholdMeasure(householdMeasure, input.quantity, unit);
    }
  }

  const measure = await runtime.resolveHouseholdMeasure({ ...input, unit });
  return measure ? fromHouseholdMeasure(measure, input.quantity, unit) : null;
}

function fromHouseholdMeasure(
  measure: HouseholdMeasureResolution,
  quantity: number,
  unit: string,
): FoodQuantityResolution {
  return {
    kind: measure.kind,
    originalQuantity: quantity,
    originalUnit: unit,
    grams: measure.grams,
    evidence: measure.evidence,
    sourceUrls: [...measure.sourceUrls],
    referenceCount: measure.referenceCount,
    householdMeasure: measure,
  };
}

// ---------------------------------------------------------------------------
// Especificidade comercial
// ---------------------------------------------------------------------------

/**
 * Categorias cujo produto de marca abrange linhas nutricionalmente distintas.
 * Com uma dessas categorias, a marca sozinha não identifica a composição; a
 * variante explícita passa a ser materialmente necessária (#1158).
 */
const BROAD_COMMERCIAL_CATEGORY_TOKENS = new Set([
  "alimento", "amendoim", "barra", "bebida", "biscoito", "bombom", "cerveja",
  "chocolate", "cookie", "refrigerante", "salgadinho", "wafer", "queijo",
  "requeijao", "iogurte", "leite", "pao",
]);

const COMMERCIAL_MEASURE_TOKENS = new Set([
  "g", "gr", "grama", "gramas", "kg", "quilo", "quilos", "mg", "ml",
  "mililitro", "mililitros", "l", "litro", "litros",
]);

/**
 * Descritores de processamento/embalagem que não alteram a composição
 * nutricional da categoria (`leite UHT integral` ≡ `leite integral`). São
 * regras de categoria, não exceções por produto ou marca.
 */
const NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS = new Set([
  "uht", "longa", "vida", "pasteurizado", "pasteurizada", "esterilizado",
  "esterilizada", "tipo", "garrafa", "caixa", "embalagem", "pacote", "lata",
]);

const IDENTITY_STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "marca"]);

function identityTokens(value: string) {
  return normalizeForMatching(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(token =>
      !COMMERCIAL_MEASURE_TOKENS.has(token)
      && !/^\d+(?:[.,]\d+)?(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?)?$/u.test(token)
    );
}

export function hasSpecificCommercialProductName(
  identitySource: string,
  brand: string,
  variant: string | null,
  foodClassification: LlmItem["foodClassification"],
  requireExplicitCategory = false,
) {
  const sourceTokens = identityTokens(identitySource);
  const brandTokens = identityTokens(brand);
  const variantTokens = identityTokens(variant ?? "");
  const includesAll = (tokens: string[]) =>
    tokens.length > 0 && tokens.every(token => sourceTokens.includes(token));

  // A generic category becomes specific when the original text also contains
  // the explicit brand and variant required by issue #1158.
  const hasExplicitCategory = sourceTokens.some(
    token => BROAD_COMMERCIAL_CATEGORY_TOKENS.has(token) && !variantTokens.includes(token),
  );
  if (requireExplicitCategory && !hasExplicitCategory) return false;

  if (
    variant
    && hasExplicitCategory
    && includesAll(brandTokens)
    && includesAll(variantTokens)
  ) {
    return true;
  }

  // A single distinctive product token can be enough when the visual extractor
  // identified an ultra-processed packaged product (for example a line name
  // after a generic category). Culinary ingredients still require the stricter
  // evidence path and must not become provisional branded products silently.
  if (
    !variant
    && foodClassification?.processingLevel === "ultra_processed"
    && includesAll(brandTokens)
  ) {
    const genericTokens = new Set([
      ...BROAD_COMMERCIAL_CATEGORY_TOKENS,
      ...COMMERCIAL_MEASURE_TOKENS,
      ...brandTokens,
    ]);
    const distinctiveTokens = sourceTokens.filter(
      token => !genericTokens.has(token) && !variantTokens.includes(token),
    );
    if (distinctiveTokens.length === 1) return true;
  }

  const excluded = new Set([...brandTokens, ...variantTokens]);
  const remaining = sourceTokens
    .filter(token => !excluded.has(token) && !BROAD_COMMERCIAL_CATEGORY_TOKENS.has(token));
  return remaining.length >= 2;
}

/** Tokens da identidade que não pertencem à marca nem a medidas/embalagem. */
function categoryTokens(identitySource: string, brand: string) {
  const brandTokens = new Set(identityTokens(brand));
  return identityTokens(identitySource).filter(token =>
    !brandTokens.has(token)
    && !IDENTITY_STOP_WORDS.has(token)
    && !NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS.has(token)
  );
}

/**
 * Referência genérica compatível com a identidade comercial **inteira** (sem a
 * marca). Todo token remanescente — categoria e variante — precisa estar
 * coberto pela referência; um token não explicado (linha, sabor, `extra`,
 * `zero lactose`) torna a referência incompatível e mantém o fail-closed.
 */
export function findCompatibleGenericReferenceForCommercialIdentity(
  identitySource: string,
  brand: string,
  foodClassification?: LlmItem["foodClassification"],
): CatalogFood | null {
  const tokens = [...new Set(categoryTokens(identitySource, brand))];
  if (!tokens.length) return null;
  const reference = findGenericCatalogFood(tokens.join(" "));
  if (!reference) return null;
  // Uma classificação explícita de produto processado contradiz uma referência
  // de alimento natural (`Melão Dino` como produto industrializado): a
  // referência não é compatível e o fail-closed prevalece (#1194).
  const itemIsProcessed = foodClassification?.processingLevel === "processed"
    || foodClassification?.processingLevel === "ultra_processed";
  if (
    itemIsProcessed
    && (reference.isFruit || reference.isVegetable || findNaturalProduceCatalogFood(tokens.join(" ")))
  ) {
    return null;
  }
  const referenceTokens = new Set(
    [reference.name, ...(reference.aliases ?? [])].flatMap(value => identityTokens(value)),
  );
  return tokens.every(token => referenceTokens.has(token)) ? reference : null;
}

export type CommercialNutritionPolicyInput = {
  /** Identidade textual completa (produto + marca + variante), sem reconstrução. */
  identitySource: string;
  brand: string;
  requestedVariant: string | null;
  alternatives: MealSemanticAlternative[];
  /** Macros inferidos utilizáveis e diferentes do placeholder genérico. */
  hasInferredNutrition: boolean;
  confidence: number;
  /** Evidência visual (imagem/multimodal) em vez de texto/transcrição. */
  visualEvidence: boolean;
  /** A extração alegou tabela nutricional que não pôde ser verificada. */
  hasUnverifiedNutritionLabelClaim: boolean;
  foodClassification: LlmItem["foodClassification"];
};

export type CommercialNutritionPolicyDecision =
  | { kind: "provisional_inferred" }
  | { kind: "provisional_generic_reference"; reference: CatalogFood }
  | { kind: "clarify"; reason: MealSemanticClarificationCode };

const MIN_COMMERCIAL_IDENTITY_CONFIDENCE = 0.5;

/**
 * Decide, para um produto com marca **sem** fonte comercial verificada, qual é
 * a dimensão ainda pendente. A ordem é:
 *
 * 1. alternativas plausíveis ou alegação de rótulo não verificada →
 *    clarificação de identidade/variante (fail-closed);
 * 2. identidade específica com variante escrita pelo usuário, ou identidade
 *    visual confiável com macros inferidos → estimativa provisória
 *    (#1158/#1088); fora desse caminho, baixa confiança mantém a
 *    clarificação de identidade/variante;
 * 3. identidade suficiente com referência genérica compatível → estimativa
 *    provisória ancorada na referência (nunca apresentada como oficial);
 * 4. identidade suficiente sem composição disponível → pendência **nutricional**
 *    (`commercial_nutrition_unverified`), sem negar a identidade lida;
 * 5. categoria ampla sem variante → `brand_variant_unresolved`; variante
 *    informada sem prova de identidade → `commercial_identity_unverified`.
 *
 * A presença da marca, isoladamente, não cria necessidade de variante: ela só
 * é exigida quando a categoria é ampla (linhas nutricionalmente distintas) ou
 * quando o domínio encontrou alternativas concorrentes.
 */
export function decideCommercialNutritionPolicy(
  input: CommercialNutritionPolicyInput,
): CommercialNutritionPolicyDecision {
  // O extrator de variante pode devolver a própria categoria (`leite`); ela não
  // é evidência de variante e não pode satisfazer a exigência da categoria.
  const variantTokens = identityTokens(input.requestedVariant ?? "")
    .filter(token => !BROAD_COMMERCIAL_CATEGORY_TOKENS.has(token));
  const identityFailure: MealSemanticClarificationCode = variantTokens.length
    ? "commercial_identity_unverified"
    : "brand_variant_unresolved";

  if (input.alternatives.length > 0 || input.hasUnverifiedNutritionLabelClaim) {
    return { kind: "clarify", reason: identityFailure };
  }
  const confident = input.confidence >= MIN_COMMERCIAL_IDENTITY_CONFIDENCE;

  // Caminho provisório histórico (#1158/#1088): identidade específica com
  // variante escrita pelo usuário, ou identidade visual confiável com macros.
  const specificIdentity = hasSpecificCommercialProductName(
    input.identitySource,
    input.brand,
    input.requestedVariant,
    input.foodClassification,
    !input.hasInferredNutrition,
  );
  const canUseSpecificIdentity = input.visualEvidence
    ? confident && input.hasInferredNutrition
    : Boolean(input.requestedVariant);
  if (specificIdentity && canUseSpecificIdentity) {
    return { kind: "provisional_inferred" };
  }

  if (!confident) return { kind: "clarify", reason: identityFailure };

  const tokens = categoryTokens(input.identitySource, input.brand);
  const hasBroadCategory = tokens.some(
    token => BROAD_COMMERCIAL_CATEGORY_TOKENS.has(token) && !variantTokens.includes(token),
  );
  const variantIsExplicit = variantTokens.length > 0
    && variantTokens.every(token => tokens.includes(token));
  // Sem categoria/produto além de marca e variante (`Catupiry Light`) não há
  // como escolher referência sem inventar informação.
  const productTokens = tokens.filter(token => !variantTokens.includes(token));
  if (!productTokens.length) return { kind: "clarify", reason: identityFailure };

  const reference = findCompatibleGenericReferenceForCommercialIdentity(
    input.identitySource,
    input.brand,
    input.foodClassification,
  );
  // Categoria ampla só identifica o produto com variante explícita ou com uma
  // referência genérica mais específica que a própria categoria cobrindo todos
  // os tokens (`iogurte natural`); categoria específica (produto de linha
  // única, como `creatina`) é identificada pela própria categoria + marca.
  const identitySufficient = !hasBroadCategory
    || variantIsExplicit
    || Boolean(reference && tokens.length >= 2);
  if (!identitySufficient) {
    return { kind: "clarify", reason: identityFailure };
  }

  if (reference) return { kind: "provisional_generic_reference", reference };

  return { kind: "clarify", reason: "commercial_nutrition_unverified" };
}

// ---------------------------------------------------------------------------
// Contrato de paridade
// ---------------------------------------------------------------------------

export type FoodResolutionClarificationDimension =
  | "identity"
  | "variant"
  | "nutrition"
  | "quantity";

export type FoodResolutionResult = {
  identity: {
    food: string;
    brand: string | null;
    variant: string | null;
  };
  quantity: {
    originalQuantity: number;
    originalUnit: string;
    grams: number;
    source: FoodQuantityResolutionKind | "inferred";
  };
  nutrition: {
    origin: MealSemanticEvidenceOrigin | null;
    verified: boolean;
    provisional: boolean;
  };
  clarification: {
    required: boolean;
    reason: MealSemanticClarificationCode | "quantity_required" | null;
    missingField: FoodResolutionClarificationDimension | null;
    alternatives: string[];
  };
};

export function clarificationDimensionForReason(
  reason: MealSemanticClarificationCode | "quantity_required" | null | undefined,
): FoodResolutionClarificationDimension | null {
  switch (reason) {
    case "brand_variant_unresolved": return "variant";
    case "commercial_identity_unverified":
    case "image_identity_unresolved": return "identity";
    case "commercial_nutrition_unverified": return "nutrition";
    case "quantity_required": return "quantity";
    default: return null;
  }
}

function normalizeIdentityValue(value: string | null | undefined) {
  const normalized = normalizeForMatching(value ?? "").trim();
  return normalized || null;
}

/**
 * Projeta um item resolvido (de qualquer entrypoint) no contrato canônico.
 * Valores textuais são normalizados para que a comparação de paridade não
 * dependa de capitalização, IDs, timestamps ou mensagens da operação.
 */
export function projectFoodResolution(input: {
  item: Pick<MealDraftItem, "foodName" | "brand" | "quantity" | "unit" | "estimatedGrams" | "resolution" | "productVariant">;
  quantitySource?: FoodQuantityResolutionKind | null;
}): FoodResolutionResult {
  const { item } = input;
  const resolution = item.resolution;
  const reason = resolution?.ambiguity?.reason ?? null;
  const origin = resolution?.nutritionOrigin ?? null;
  return {
    identity: {
      food: normalizeIdentityValue(item.foodName) ?? "",
      brand: normalizeIdentityValue(item.brand),
      variant: normalizeIdentityValue(resolution?.productVariant ?? item.productVariant),
    },
    quantity: {
      originalQuantity: item.quantity,
      originalUnit: normalizeUnit(item.unit),
      grams: Number(item.estimatedGrams.toFixed(2)),
      source: input.quantitySource
        ?? (resolution?.measureResolution?.kind as FoodQuantityResolutionKind | undefined)
        ?? "inferred",
    },
    nutrition: {
      origin,
      verified: resolution?.nutritionVerified ?? false,
      provisional: origin === "provisional_estimate",
    },
    clarification: {
      required: Boolean(reason),
      reason,
      missingField: clarificationDimensionForReason(reason),
      alternatives: (resolution?.ambiguity?.alternatives ?? []).map(alternative => alternative.name),
    },
  };
}
