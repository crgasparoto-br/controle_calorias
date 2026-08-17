export type WhatsAppWaterLine = {
  text: string;
  amountMl: number;
};

export type WhatsAppWaterFoodSplit = {
  waterLines: WhatsAppWaterLine[];
  foodText: string;
};

const MAX_WATER_LOG_AMOUNT_ML = 10000;
const WATER_LOG_ALLOWED_WORDS = new Set([
  "agua",
  "aguas",
  "bebi",
  "bebeu",
  "beber",
  "consumi",
  "consumiu",
  "consumir",
  "tomei",
  "tomou",
  "tomar",
  "ml",
  "mililitros",
  "mililitro",
  "l",
  "litro",
  "litros",
  "de",
  "da",
  "do",
  "e",
  "mais",
  "uns",
  "umas",
  "um",
  "uma",
  "copo",
  "copos",
  "garrafa",
  "garrafas",
  "hidratar",
  "hidratacao",
  "registrar",
  "registra",
  "registre",
  "adicione",
  "adicionar",
  "lancar",
  "lancei",
  "hoje",
  "agora",
]);

export function normalizeWhatsAppWaterText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function parseWhatsAppWaterAmountMl(text: string) {
  const normalized = normalizeWhatsAppWaterText(text).replace(/,/g, ".");
  const literMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:l|litro|litros)\b/);
  if (literMatch) {
    const amountMl = Math.round(Number(literMatch[1]) * 1000);
    return amountMl > 0 && amountMl <= MAX_WATER_LOG_AMOUNT_ML ? amountMl : null;
  }

  const mlMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:ml|mililitros?|mili(?:litros?)?)\b/);
  if (mlMatch) {
    const amountMl = Math.round(Number(mlMatch[1]));
    return amountMl > 0 && amountMl <= MAX_WATER_LOG_AMOUNT_ML ? amountMl : null;
  }

  return null;
}

export function isWhatsAppWaterOnlyText(text: string) {
  const normalized = normalizeWhatsAppWaterText(text);
  if (!/\baguas?\b/.test(normalized) && !/\bhidratacao\b/.test(normalized)) {
    return false;
  }

  const words = normalized
    .replace(/\d+(?:[.,]\d+)?/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return words.length > 0 && words.every((word) => WATER_LOG_ALLOWED_WORDS.has(word));
}

export function parseWhatsAppWaterLine(text: string): WhatsAppWaterLine | null {
  const trimmed = text.trim();
  if (!trimmed || !isWhatsAppWaterOnlyText(trimmed)) {
    return null;
  }

  const amountMl = parseWhatsAppWaterAmountMl(trimmed);
  if (!amountMl) {
    return null;
  }

  return {
    text: trimmed,
    amountMl,
  };
}

export function splitWhatsAppWaterAndFoodText(text?: string | null): WhatsAppWaterFoodSplit | null {
  const lines = text
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean) ?? [];

  if (lines.length < 2) {
    return null;
  }

  const waterLines: WhatsAppWaterLine[] = [];
  const foodLines: string[] = [];

  for (const line of lines) {
    const waterLine = parseWhatsAppWaterLine(line);
    if (waterLine) {
      waterLines.push(waterLine);
    } else {
      foodLines.push(line);
    }
  }

  if (waterLines.length === 0 || foodLines.length === 0) {
    return null;
  }

  return {
    waterLines,
    foodText: foodLines.join("\n"),
  };
}
