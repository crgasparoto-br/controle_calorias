import { normalizeText } from "../../mealTextParsing";
import type { MealDraftItem } from "../../nutritionEngineTypes";

const CORE_WATER_TOKENS = new Set([
  "agua",
  "aguas",
  "mineral",
  "com",
  "sem",
  "gas",
  "gaseificada",
  "gaseificado",
  "garrafa",
  "de",
  "natural",
  "pura",
  "puro",
  "potavel",
]);

const PURE_WATER_ANCHOR_TOKENS = new Set([
  "mineral",
  "gas",
  "gaseificada",
  "gaseificado",
  "garrafa",
  "natural",
  "pura",
  "puro",
  "potavel",
]);

const WATER_EXCLUSION_TOKENS = new Set([
  "coco",
  "tonica",
  "sabor",
  "saborizada",
  "saborizado",
  "aroma",
  "aromatizada",
  "aromatizado",
  "cha",
  "hibisco",
  "hortela",
  "infusao",
  "limao",
]);

const WATER_COMPOSITION_CONNECTOR_TOKENS = new Set(["e", "ou"]);

function normalizeWaterTokens(value: string) {
  return normalizeText(value)
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function isWaterMeasurementToken(token: string) {
  return token === "ml" || token === "l" || /^\d+(?:ml|l)?$/.test(token);
}

function hasPlainWaterClassificationEvidence(item: Pick<MealDraftItem, "classification">) {
  return item.classification?.isPlainWater === true;
}

function unknownTokensFormEmbeddedBrandCandidate(tokens: string[], brandTokens: Set<string>) {
  const significantTokens = tokens.filter(token => !isWaterMeasurementToken(token));
  const unknownIndexes = significantTokens.flatMap((token, index) => (
    !CORE_WATER_TOKENS.has(token) && !brandTokens.has(token) ? [index] : []
  ));

  if (!unknownIndexes.length) {
    return true;
  }

  const firstUnknownIndex = unknownIndexes[0];
  const lastUnknownIndex = unknownIndexes[unknownIndexes.length - 1];
  const contiguous = unknownIndexes.every((index, offset) => index === firstUnknownIndex + offset);
  if (!contiguous) {
    return false;
  }

  // Um conector na borda do bloco desconhecido indica composição (ex.:
  // "água mineral e vodka"). Conectores internos continuam permitidos para
  // marcas compostas como "Fonte e Vida" quando há evidência semântica
  // independente de água potável pura.
  if (WATER_COMPOSITION_CONNECTOR_TOKENS.has(significantTokens[firstUnknownIndex])
    || WATER_COMPOSITION_CONNECTOR_TOKENS.has(significantTokens[lastUnknownIndex])) {
    return false;
  }

  return true;
}

export function isPureWaterItem(item: Pick<MealDraftItem, "foodName" | "canonicalName" | "brand" | "classification">) {
  const brandTokens = new Set(item.brand ? normalizeWaterTokens(item.brand) : []);
  const candidateNames = [item.canonicalName, item.foodName].filter((name): name is string => Boolean(name));
  const candidates = candidateNames.map(normalizeWaterTokens);

  if (candidates.some(tokens => tokens.some(token => WATER_EXCLUSION_TOKENS.has(token)))) {
    return false;
  }

  // Evidência semântica negativa explícita é autoritativa para todas as
  // representações do nome, inclusive quando a gramática textual parece água.
  if (item.classification?.isPlainWater === false) {
    return false;
  }

  return candidates.some(tokens => {
    if (!tokens.length || !tokens.includes("agua")) {
      return false;
    }

    const unknownTokens = tokens.filter(token => (
      !CORE_WATER_TOKENS.has(token)
      && !brandTokens.has(token)
      && !isWaterMeasurementToken(token)
    ));

    if (!unknownTokens.length) {
      return true;
    }

    // Marca embutida sem `brand` e uma representação ambígua. Ela só pode ser
    // tolerada quando o extrator declarou separadamente que a identidade é
    // água potável pura; o nível NOVA de processamento não serve como prova
    // de pureza. Os tokens desconhecidos precisam formar um único bloco sem
    // conectores de composição nas bordas, mas a posição desse bloco não é
    // significativa: a inferência visual pode inserir a marca antes, entre ou
    // depois dos qualificadores canônicos da água.
    return tokens.some(token => PURE_WATER_ANCHOR_TOKENS.has(token))
      && hasPlainWaterClassificationEvidence(item)
      && unknownTokensFormEmbeddedBrandCandidate(tokens, brandTokens);
  });
}

function parseVolumeMlFromText(value?: string) {
  if (!value) {
    return null;
  }
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(ml|l)\b/i);
  if (!match) {
    return null;
  }
  const numericValue = Number(match[1].replace(",", "."));
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }
  return match[2].toLowerCase() === "l" ? numericValue * 1000 : numericValue;
}

export function resolveWaterVolumeMl(item: Pick<MealDraftItem, "foodName" | "canonicalName"> & Partial<Pick<MealDraftItem, "quantity" | "unit" | "portionText">>) {
  const representedVolumes: number[] = [];

  if (typeof item.quantity === "number" && item.quantity > 0 && item.unit) {
    const unit = item.unit.trim().toLowerCase();
    if (unit === "ml") {
      representedVolumes.push(item.quantity);
    }
    if (unit === "l") {
      representedVolumes.push(item.quantity * 1000);
    }
  }

  const portionTextVolume = parseVolumeMlFromText(item.portionText);
  if (portionTextVolume != null) {
    representedVolumes.push(portionTextVolume);
  }

  representedVolumes.push(...[item.foodName, item.canonicalName]
    .map(parseVolumeMlFromText)
    .filter((volume): volume is number => volume != null));
  if (!representedVolumes.length) {
    return null;
  }

  const uniqueVolumes = new Set(representedVolumes);
  return uniqueVolumes.size === 1 ? representedVolumes[0] : null;
}

export type WaterHydrationSplit = {
  waterVolumeMl: number;
  remainingItems: MealDraftItem[];
  hasWaterWithoutVolume: boolean;
};

export function splitMealItemsForWaterHydration(items: MealDraftItem[]): WaterHydrationSplit {
  let waterVolumeMl = 0;
  let hasWaterWithoutVolume = false;
  const remainingItems: MealDraftItem[] = [];

  for (const item of items) {
    if (!isPureWaterItem(item)) {
      remainingItems.push(item);
      continue;
    }

    const volumeMl = resolveWaterVolumeMl(item);
    if (volumeMl == null) {
      hasWaterWithoutVolume = true;
      continue;
    }

    waterVolumeMl += volumeMl;
  }

  return { waterVolumeMl, remainingItems, hasWaterWithoutVolume };
}
