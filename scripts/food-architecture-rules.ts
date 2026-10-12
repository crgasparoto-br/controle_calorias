/**
 * ADR Food Intelligence V2 §19.0.2: declarative wave-one detector registry.
 * Status "preview" is intentional while ADR §25 items 25 and 26 remain OPEN.
 * Every rule has a layer, scope, failure class and matching strategy.
 */
export type FoodWaveOneRuleId = "17" | "18" | "5" | "11" | "3" | "10" | "1" | "2" | "4";
export type FoodRuleKind = "collection" | "import" | "function" | "call";
export type FoodWaveOneRule = {
  id: FoodWaveOneRuleId;
  layer: 1;
  mode: "preview";
  scope: "server-production";
  failureClass: "A" | "B" | "C" | "E" | "I";
  kind: FoodRuleKind;
  symbolPattern: string;
  pathPattern?: string;
  evidencePattern?: string;
  description: string;
};

export const FOOD_WAVE_ONE_RULES: readonly FoodWaveOneRule[] = [
  {
    id: "17", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "I", kind: "collection",
    symbolPattern: "food|alimento|nutrition|nutrient|macro|portion|porcao|porção|classification|processingLevel|alias|synonym|lexicon|vocab|ingredient|catalog|serving",
    description: "Coleção literal de conhecimento alimentar em produção",
  },
  {
    id: "18", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "B", kind: "collection",
    symbolPattern: "materiality|materialidade|nutritionallyNeutral|neutralPackaging|commercialCategory|attributeMaterial|materialAttribute|broadCommercial|identityStopWords",
    evidencePattern: "token|term|word|keyword|lexical|lexic|descriptor|qualifier|packag|neutral|material|categor|stop",
    description: "Materialidade/identidade comercial decidida por léxico estático",
  },
  {
    id: "5", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "C", kind: "collection",
    symbolPattern: "FOOD_CATALOG_REFERENCE|CURATED.*PORTION|COMMON.*FOOD|STATIC.*FOOD|FOOD.*DEFAULT",
    description: "Tabela alimentar específica codificada em TypeScript",
  },
  {
    id: "11", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "A", kind: "collection",
    pathPattern: "whatsapp|inbound|transcri|image|audio|ocr",
    symbolPattern: "alias|synonym|lexicon|vocab|informal|slang|language|abbrev|typo|replacements|uncertain.*portion|stop.*words",
    description: "Léxico ou normalização de domínio codificada no canal",
  },
  {
    id: "3", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "I", kind: "call",
    symbolPattern: "parseFoodText|extractExplicitQuantities|infer.*Food|resolve.*Food",
    evidencePattern: "decision|resolution|resolved|normalizedText|JSON.stringify",
    description: "Possível reinferência textual a partir de decisão estruturada",
  },
  {
    id: "10", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "E", kind: "import",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio",
    symbolPattern: "nutritionEngine|foodItemResolution|catalogMatching|foodSemanticCompatibility",
    description: "Canal multimodal importando resolvedor alternativo",
  },
  {
    id: "1", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "I", kind: "function",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio",
    symbolPattern: "resolve.*(?:Food|Nutrition)|decide.*(?:Food|Nutrition)|find.*Nutrition",
    description: "Função de decisão alimentar declarada dentro de canal",
  },
  {
    id: "2", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "I", kind: "function",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio",
    symbolPattern: "create.*Resolver|resolveFood|resolveNutrition",
    description: "Possível resolvedor concorrente de canal",
  },
  {
    id: "4", layer: 1, mode: "preview", scope: "server-production",
    failureClass: "B", kind: "call",
    pathPattern: "whatsapp|image|vision|ocr|photo|barcode|audio",
    symbolPattern: "findLocalNutritionReference|findCompatibleGenericReferenceForCommercialIdentity|selectNutritionSource|chooseNutritionSource",
    description: "Adapter de canal selecionando fonte nutricional",
  },
] as const;

export const FOOD_WAVE_ONE_IDS = ["17", "18", "5", "11", "3", "10", "1", "2", "4"] as const;
