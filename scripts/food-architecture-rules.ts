/**
 * ADR Food Intelligence V2 §19.0.2: declarative wave-one detector registry.
 * ADR §25 item 25 decided 2026-10-12: block new production violations.
 * Runtime promotion governed independently by decision 26.
 * Every rule has a layer, scope, failure class and matching strategy.
 */
type FoodOwnerFunction = "lexical-knowledge" | "attribute-materiality" |
  "portion-knowledge" | "food-knowledge" | "food-resolution" |
  "decision-roundtrip" | "nutrition-source-selection";
export const FOOD_WAVE_ONE_RULES = [
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "collection",
    symbolPattern: "food|alimento|brand|marca|variant|nutrition|nutrient|macro|portion|porcao|porção|classification|processingLevel|alias|synonym|lexicon|vocab|ingredient|catalog|serving",
    detectorKey: "food-static-collection",
    description: "Coleção literal de conhecimento alimentar em produção",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "C", kind: "numeric-map",
    symbolPattern: "food|alimento|portion|porc|serving|nutrition|nutrient|macro|gram|catalog",
    detectorKey: "food-numeric-map-food",
    description: "Mapa numerico de porcao ou nutricao indexado por identidade alimentar",
  },
  {
    id: "5", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "C", kind: "numeric-map",
    symbolPattern: "food|alimento|portion|porc|serving|nutrition|nutrient|macro|gram|catalog",
    detectorKey: "food-numeric-map-portions",
    description: "Tabela numerica de porcoes ou macros codificada no dominio alimentar",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "scalar",
    symbolPattern: "food|alimento|portion|porcao|porção|nutrition|nutrient|macro|classification|alias|synonym|brand|marca|lexicon|vocab",
    description: "Valor alimentar individual codificado em constante produtiva",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "domain-field",
    symbolPattern: "classification|processingLevel|alias|aliases|synonym|synonyms|lexicon|vocab",
    fieldPattern: "^(?:classification|processingLevel|aliases?|synonyms?|lexicon|vocab)$",
    valueKind: "collection",
    contextPattern: "food|alimento|meal|nutrition|nutrient|ingredient|portion|serving|recipe|foodId|foodName|productName",
    description: "Campo de classificação ou vocabulário alimentar codificado em produção",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "C", kind: "domain-field",
    symbolPattern: "portion|portionGrams|servingGrams|grams|calories|kcal|protein|carbs|fat|nutrition|nutrient",
    fieldPattern: "^(?:portion|portionGrams|portion_grams|serving|servingGrams|serving_grams|grams|calories|kcal|protein|carbs|fat|nutrition|nutrient)$",
    valueKind: "numeric",
    contextPattern: "food|alimento|meal|nutrition|nutrient|ingredient|portion|serving|recipe|foodId|foodName|productName",
    description: "Campo de porção ou nutrição alimentar codificado em produção",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "C", kind: "numeric-return",
    symbolPattern: "portion|porcao|porção|serving|nutrition|nutrient|macro|kcal|calor|grams",
    description: "Porção ou valor nutricional literal retornado por decisão alimentar",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "literal-branch",
    symbolPattern: "foodName|foodLabel|foodType|alimento|productName|portion|porcao|porção|brandName|macroType|processingLevel|classification|alias|synonym",
    description: "Comparação literal de alimento ou porção em código produtivo",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "literal-switch",
    symbolPattern: "foodName|foodLabel|foodType|alimento|productName|portion|porcao|porção|brandName|macroType|processingLevel|classification|alias|synonym",
    description: "Chave alimentar ou porção decidida por switch/case literal",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "lexical-lookup",
    symbolPattern: "food|alimento|nutrition|nutrition|alias|lexicon|ingredient|normaliz",
    description: "Mapa lexical alimentar com nome genérico aplicado em produção",
  },
  {
    id: "11", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "lexical-lookup", pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "food|alimento|normaliz|language|lexicon|input|word|term|text",
    ownerFunction: "lexical-knowledge",
    description: "Mapa lexical alimentar anônimo usado diretamente em canal",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "lexical-lookup",
    symbolPattern: "material|attribute|qualifier|packag|commercial",
    ownerFunction: "attribute-materiality",
    description: "Materialidade codificada em dicionário lexical de produção",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "collection",
    symbolPattern: "materiality|materialidade|nutritionally[_-]?neutral|neutral[_-]?packaging|commercial[_-]?category|attribute[_-]?material|material[_-]?attribute|broad[_-]?commercial|identity[_-]?stop[_-]?words",
    evidencePattern: "token|term|word|keyword|lexical|lexic|descriptor|qualifier|packag|neutral|material|categor|stop",
    ownerFunction: "attribute-materiality",
    description: "Materialidade/identidade comercial decidida por léxico estático",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "literal-branch",
    // Semantic food/materiality context, regardless of source filename.
    symbolPattern: "material|neutral|nutrition|packag|commercial|attribute|qualifier|food|alimento|ingredient",
    ownerFunction: "attribute-materiality",
    description: "Comparação literal potencialmente definindo materialidade de atributo",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "literal-switch",
    symbolPattern: "material|neutral|nutrition|packag|commercial|attribute|qualifier|food|alimento|ingredient",
    ownerFunction: "attribute-materiality",
    description: "Materialidade lexical decidida por switch/case",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "literal-membership",
    // Semantic food/materiality context, regardless of source filename.
    symbolPattern: "material|neutral|nutrition|packag|commercial|attribute|qualifier|food|alimento|ingredient",
    // Reuse the declarative lexical materiality evidence used by regex gates.
    evidencePattern: "integral|light|diet|desnatad|sem[\\s_-]*a[cç][uú]car|zero[\\s_-]*(?:acucar|a[cç][uú]car|lactose)|sem[\\s_-]*lactose",
    ownerFunction: "attribute-materiality",
    description: "Materialidade alimentar decidida por consulta a coleção lexical inline",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "literal-regex-test",
    symbolPattern: "food|alimento|nutrition|meal|ingredient|portion|porc|serving|alias|lexic|normaliz",
    description: "Decisão lexical alimentar usando regex literal",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "literal-regex-test",
    // Semantic food/materiality context, regardless of source filename.
    symbolPattern: "material|neutral|nutrition|packag|commercial|attribute|qualifier|food|alimento|ingredient",
    // Detector-only lexical evidence; not a runtime vocabulary of food rules.
    evidencePattern: "integral|light|diet|desnatad|sem[\\s_-]*a[cç][uú]car|zero[\\s_-]*(?:acucar|a[cç][uú]car|lactose)|sem[\\s_-]*lactose",
    // In anonymous functions, lexical cues require an entrypoint surface.
    // Account/status helpers remain out of scope without food-domain evidence.
    lexicalEvidencePathPattern: "(?:^|/)(?:handlers?|routes?|controllers?|adapters?|api)(?:/|\\.)",
    ownerFunction: "attribute-materiality",
    description: "Materialidade lexical codificada em expressão regular",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "literal-string-method",
    symbolPattern: "food|alimento|nutrition|meal|ingredient|portion|porc|serving|recipe|lexic|alias|normaliz",
    description: "Decisão alimentar lexical por includes/startsWith/endsWith em string",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "literal-string-method",
    symbolPattern: "material|neutral|nutrition|attribute|qualifier|packag|commercial|food|alimento",
    evidencePattern: "integral|light|diet|desnatad|sem[\\s_-]*a[cç][uú]car|zero[\\s_-]*(?:acucar|a[cç][uú]car|lactose)|sem[\\s_-]*lactose",
    ownerFunction: "attribute-materiality",
    description: "Materialidade lexical por método de string em código produtivo",
  },
  {
    id: "11", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "literal-string-method",
    pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "food|alimento|normaliz|language|lexicon|input|word|term|text",
    ownerFunction: "lexical-knowledge",
    description: "Canal aplicando vocabulário alimentar literal por método de string",
  },
  {
    id: "5", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "C", kind: "collection",
    symbolPattern: "FOOD_CATALOG_REFERENCE|CURATED.*PORTION|COMMON.*FOOD|STATIC.*FOOD|FOOD.*DEFAULT",
    detectorKey: "food-static-table",
    description: "Tabela alimentar específica codificada em TypeScript",
  },
  {
    id: "11", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "collection",
    pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "alias|synonym|lexicon|vocab|informal|slang|language|abbrev|typo|replacements|uncertain.*portion|stop.*words",
    ownerFunction: "lexical-knowledge",
    description: "Léxico ou normalização de domínio codificada no canal",
  },
  {
    id: "11", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "literal-membership",
    pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "alias|synonym|lexic|vocab|informal|slang|language|abbrev|typo|normaliz|food|alimento",
    ownerFunction: "lexical-knowledge",
    description: "Canal decidindo vocabulário alimentar por coleção lexical inline",
  },
  {
    id: "11", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "literal-regex-test",
    pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "food|alimento|alias|synonym|lexic|vocab|informal|slang|language|abbrev|typo|normaliz",
    ownerFunction: "lexical-knowledge",
    description: "Canal mantendo léxico alimentar em expressão regular",
  },
  {
    id: "3", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "call",
    symbolPattern: "parseFoodText|extractExplicitQuantities|infer.*Food|resolve.*Food",
    evidencePattern: "decision|resolution|resolved|normalizedText|JSON.stringify",
    ownerFunction: "decision-roundtrip",
    description: "Possível reinferência textual a partir de decisão estruturada",
  },
  {
    id: "10", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "E", kind: "import",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio|(?:^|/)(?:web|mobile|api|routes?|handlers?|controllers?|adapters?)(?:/|\\.)",
    symbolPattern: "nutritionEngine|foodItemResolution|catalogMatching|foodSemanticCompatibility",
    detectorKey: "alternative-resolver-import",
    ownerFunction: "food-resolution",
    description: "Canal multimodal importando resolvedor alternativo",
  },
  {
    id: "1", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "function",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio|(?:^|/)(?:web|mobile|api|routes?|handlers?|controllers?|adapters?)(?:/|\\.)",
    symbolPattern: "resolve.*(?:Food|Nutrition)|decide.*(?:Food|Nutrition)|find.*Nutrition",
    ownerFunction: "food-resolution",
    description: "Função de decisão alimentar declarada dentro de canal",
  },
  {
    id: "2", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "function",
    symbolPattern: "create.*Resolver|resolveFood|resolveNutrition|(?:make|build|select|identify|decide|infer|match).*?(?:Food|Nutrition).*Resolver",
    ownerFunction: "food-resolution",
    description: "Possível resolvedor alimentar concorrente em qualquer módulo produtivo",
  },
  {
    id: "4", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "call",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio|(?:^|/)(?:web|mobile|api|routes?|handlers?|controllers?|adapters?)(?:/|\\.)",
    symbolPattern: "findLocalNutritionReference|findCompatibleGenericReferenceForCommercialIdentity|selectNutritionSource|chooseNutritionSource",
    ownerFunction: "nutrition-source-selection",
    description: "Adapter de canal selecionando fonte nutricional",
  },
] as const;

export type FoodWaveOneRuleId = typeof FOOD_WAVE_ONE_RULES[number]["id"];
export type FoodRuleKind = typeof FOOD_WAVE_ONE_RULES[number]["kind"];
export type FoodWaveOneRule = typeof FOOD_WAVE_ONE_RULES[number];

export const FOOD_WAVE_ONE_IDS: readonly FoodWaveOneRuleId[] = [...new Set(
  FOOD_WAVE_ONE_RULES.map(rule => rule.id),
)];

export function findFoodRule(predicate: (rule: FoodWaveOneRule) => boolean): FoodWaveOneRule | undefined {
  return FOOD_WAVE_ONE_RULES.find(predicate);
}

export function validateFoodWaveOneRegistry(): string[] {
  const errors: string[] = [];
  const ids = new Set(FOOD_WAVE_ONE_RULES.map(rule => rule.id));
  if (ids.size !== FOOD_WAVE_ONE_IDS.length || FOOD_WAVE_ONE_IDS.some(id => !ids.has(id))) {
    errors.push("Food wave-one rule IDs are not derived consistently from the registry");
  }
  for (const rule of FOOD_WAVE_ONE_RULES) {
    if (!rule.description.trim() || !rule.symbolPattern.trim()) {
      errors.push("Food rule is missing description or symbolPattern: " + rule.id);
    }
    if (["function", "call", "import"].includes(rule.kind) && !rule.ownerFunction) {
      errors.push("Food rule is missing declarative ownerFunction: " + rule.description);
    }
    if (rule.kind === "domain-field" &&
        (!rule.fieldPattern || !rule.valueKind || !rule.contextPattern)) {
      errors.push("Food domain-field rule is missing field/value/context metadata");
    }
  }
  return [...new Set(errors)];
}
