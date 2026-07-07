const ptBrNumberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

export function formatNumber(value: number) {
  return ptBrNumberFormatter.format(value);
}

export function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

export function cleanCatalogFoodName(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTargetFoodText(value?: string) {
  return value
    ?.replace(/\b(?:ontem|hoje|agora|por favor|pfv)\b/gi, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^\b(?:o|a|os|as|do|da|de|dos|das)\b\s+/i, "")
    .trim() || null;
}
