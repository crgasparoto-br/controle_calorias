/**
 * ADR Food Intelligence V2 §19.0.2: declarative wave-one detector registry.
 * ADR §25 item 25 decided 2026-10-12: block new production violations.
 * Runtime promotion governed independently by decision 26.
 * Every rule has a layer, scope, failure class and matching strategy.
 */
export type FoodWaveOneRuleId = "17" | "18" | "5" | "11" | "3" | "10" | "1" | "2" | "4";
export type FoodRuleKind = "collection" | "scalar" | "import" | "function" | "call" | "literal-branch" | "literal-switch" | "literal-membership" | "literal-regex-test" | "lexical-lookup" | "numeric-map" | "numeric-return";
export type FoodWaveOneRule = {
  id: FoodWaveOneRuleId;
  layer: 1;
  severity: "warning" | "error";
  mode: "block-new";
  scope: "production-runtime";
  failureClass: "A" | "B" | "C" | "E" | "I";
  kind: FoodRuleKind;
  symbolPattern: string;
  pathPattern?: string;
  evidencePattern?: string;
  lexicalEvidencePathPattern?: string;
  contentPattern?: string;
  description: string;
};

export const FOOD_WAVE_ONE_RULES: readonly FoodWaveOneRule[] = [
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "collection",
    symbolPattern: "food|alimento|brand|marca|variant|nutrition|nutrient|macro|portion|porcao|porção|classification|processingLevel|alias|synonym|lexicon|vocab|ingredient|catalog|serving",
    description: "Coleção literal de conhecimento alimentar em produção",
  },
  {
    id: "17", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "C", kind: "numeric-map",
    symbolPattern: "food|alimento|portion|porc|serving|nutrition|nutrient|macro|gram|catalog",
    description: "Mapa numerico de porcao ou nutricao indexado por identidade alimentar",
  },
  {
    id: "5", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "C", kind: "numeric-map",
    symbolPattern: "food|alimento|portion|porc|serving|nutrition|nutrient|macro|gram|catalog",
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
    description: "Mapa lexical alimentar anônimo usado diretamente em canal",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "lexical-lookup",
    symbolPattern: "material|attribute|qualifier|packag|commercial",
    description: "Materialidade codificada em dicionário lexical de produção",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "collection",
    symbolPattern: "materiality|materialidade|nutritionally[_-]?neutral|neutral[_-]?packaging|commercial[_-]?category|attribute[_-]?material|material[_-]?attribute|broad[_-]?commercial|identity[_-]?stop[_-]?words",
    evidencePattern: "token|term|word|keyword|lexical|lexic|descriptor|qualifier|packag|neutral|material|categor|stop",
    description: "Materialidade/identidade comercial decidida por léxico estático",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "literal-branch",
    // Semantic food/materiality context, regardless of source filename.
    symbolPattern: "material|neutral|nutrition|packag|commercial|attribute|qualifier|food|alimento|ingredient",
    description: "Comparação literal potencialmente definindo materialidade de atributo",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "literal-switch",
    symbolPattern: "material|neutral|nutrition|packag|commercial|attribute|qualifier|food|alimento|ingredient",
    description: "Materialidade lexical decidida por switch/case",
  },
  {
    id: "18", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "literal-membership",
    // Semantic food/materiality context, regardless of source filename.
    symbolPattern: "material|neutral|nutrition|packag|commercial|attribute|qualifier|food|alimento|ingredient",
    description: "Materialidade alimentar decidida por consulta a coleção lexical inline",
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
    description: "Materialidade lexical codificada em expressão regular",
  },
  {
    id: "5", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "C", kind: "collection",
    symbolPattern: "FOOD_CATALOG_REFERENCE|CURATED.*PORTION|COMMON.*FOOD|STATIC.*FOOD|FOOD.*DEFAULT",
    description: "Tabela alimentar específica codificada em TypeScript",
  },
  {
    id: "11", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "collection",
    pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "alias|synonym|lexicon|vocab|informal|slang|language|abbrev|typo|replacements|uncertain.*portion|stop.*words",
    description: "Léxico ou normalização de domínio codificada no canal",
  },
  {
    id: "11", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "literal-membership",
    pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "alias|synonym|lexic|vocab|informal|slang|language|abbrev|typo|normaliz|food|alimento",
    description: "Canal decidindo vocabulário alimentar por coleção lexical inline",
  },
  {
    id: "11", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "A", kind: "literal-regex-test",
    pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "food|alimento|alias|synonym|lexic|vocab|informal|slang|language|abbrev|typo|normaliz",
    description: "Canal mantendo léxico alimentar em expressão regular",
  },
  {
    id: "3", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "call",
    symbolPattern: "parseFoodText|extractExplicitQuantities|infer.*Food|resolve.*Food",
    evidencePattern: "decision|resolution|resolved|normalizedText|JSON.stringify",
    description: "Possível reinferência textual a partir de decisão estruturada",
  },
  {
    id: "10", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "E", kind: "import",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio|(?:^|/)(?:web|mobile|api|routes?|handlers?|controllers?|adapters?)(?:/|\\.)",
    symbolPattern: "nutritionEngine|foodItemResolution|catalogMatching|foodSemanticCompatibility",
    description: "Canal multimodal importando resolvedor alternativo",
  },
  {
    id: "1", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "function",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio|(?:^|/)(?:web|mobile|api|routes?|handlers?|controllers?|adapters?)(?:/|\\.)",
    symbolPattern: "resolve.*(?:Food|Nutrition)|decide.*(?:Food|Nutrition)|find.*Nutrition",
    description: "Função de decisão alimentar declarada dentro de canal",
  },
  {
    id: "2", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "I", kind: "function",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio|(?:^|/)(?:web|mobile|api|routes?|handlers?|controllers?|adapters?)(?:/|\\.)",
    symbolPattern: "create.*Resolver|resolveFood|resolveNutrition",
    description: "Possível resolvedor concorrente de canal",
  },
  {
    id: "4", layer: 1, severity: "error", mode: "block-new", scope: "production-runtime",
    failureClass: "B", kind: "call",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio|(?:^|/)(?:web|mobile|api|routes?|handlers?|controllers?|adapters?)(?:/|\\.)",
    symbolPattern: "findLocalNutritionReference|findCompatibleGenericReferenceForCommercialIdentity|selectNutritionSource|chooseNutritionSource",
    description: "Adapter de canal selecionando fonte nutricional",
  },
] as const;

export const FOOD_WAVE_ONE_IDS = ["17", "18", "5", "11", "3", "10", "1", "2", "4"] as const;
