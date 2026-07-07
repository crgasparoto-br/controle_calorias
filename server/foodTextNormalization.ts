function normalizeFoodLookupText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
};

export function normalizeKnownFoodName(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const normalized = normalizeFoodLookupText(cleaned);

  if (/^maca\s+(?:fuji|fugi)$/.test(normalized)) {
    return "maçã fuji";
  }
  if (normalized === "maca") {
    return "maçã";
  }
  if (normalized === "ovos cozido") {
    return "ovos cozidos";
  }

  return cleaned;
}

export function isLikelyKnownFoodRegistrationText(value?: string | null) {
  const normalized = normalizeFoodLookupText(value ?? "");
  if (!normalized) {
    return false;
  }

  return /\b(?:maca|banana|ovo|ovos)\b/.test(normalized)
    && !/\b(?:como|qual|quais|posso|devo|vale a pena|faz mal|faz bem|calorias)\b/.test(normalized);
}

export function normalizeKnownFoodText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const quantityWithUnit = text.match(/^(\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|un|unidades?|fatias?|colheres?|x[ií]caras?|copos?|por[cç][oõ]es?|por[cç][aã]o))\s+(?:de\s+)?(.+)$/iu);
  if (quantityWithUnit) {
    const foodName = normalizeKnownFoodName(quantityWithUnit[2]);
    return foodName === quantityWithUnit[2].trim()
      ? text
      : `${quantityWithUnit[1]} ${foodName}`;
  }

  const numericQuantity = text.match(/^(\d+(?:[,.]\d+)?)\s+(?:de\s+)?(.+)$/u);
  if (numericQuantity) {
    const foodName = normalizeKnownFoodName(numericQuantity[2]);
    return foodName === numericQuantity[2].trim()
      ? text
      : `${numericQuantity[1]} un ${foodName}`;
  }

  const wordQuantity = text.match(/^(um|uma|dois|duas)\s+(?:de\s+)?(.+)$/iu);
  if (wordQuantity) {
    const quantity = NUMBER_WORDS[normalizeFoodLookupText(wordQuantity[1])];
    const foodName = normalizeKnownFoodName(wordQuantity[2]);
    return quantity && foodName !== wordQuantity[2].trim()
      ? `${quantity} un ${foodName}`
      : text;
  }

  return normalizeKnownFoodName(text);
}
