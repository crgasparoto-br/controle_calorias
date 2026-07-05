export type FoodIconInput = {
  foodName?: string | null;
  canonicalName?: string | null;
};

export const DEFAULT_FOOD_ICON = "🍽️";

const FOOD_ICON_RULES: Array<{ pattern: RegExp; icon: string }> = [
  { pattern: /\b(banana)\b/, icon: "🍌" },
  { pattern: /\b(maca|apple)\b/, icon: "🍎" },
  { pattern: /\b(laranja|orange)\b/, icon: "🍊" },
  { pattern: /\b(morango|strawberry)\b/, icon: "🍓" },
  { pattern: /\b(uva|grape)\b/, icon: "🍇" },
  { pattern: /\b(abacate|avocado)\b/, icon: "🥑" },
  { pattern: /\b(ovo|omelete)\b/, icon: "🥚" },
  { pattern: /\b(frango|chicken|carne|bife|steak)\b/, icon: "🍗" },
  { pattern: /\b(peixe|fish|salmao|atum|tilapia)\b/, icon: "🐟" },
  { pattern: /\b(arroz|rice|feijao|lentilha|grao de bico)\b/, icon: "🍚" },
  { pattern: /\b(macarrao|massa|pasta)\b/, icon: "🍝" },
  { pattern: /\b(pao|torrada|bisnaguinha|sandui?che)\b/, icon: "🍞" },
  { pattern: /\b(queijo|cheese)\b/, icon: "🧀" },
  { pattern: /\b(leite|iogurte|whey)\b/, icon: "🥛" },
  { pattern: /\b(cafe|coffee)\b/, icon: "☕" },
  { pattern: /\b(salada|alface|legume|brocolis|tomate|cenoura)\b/, icon: "🥗" },
  { pattern: /\b(batata|mandioca|aipim)\b/, icon: "🥔" },
  { pattern: /\b(chocolate|doce|bolo)\b/, icon: "🍫" },
];

function normalizeFoodIconText(input: FoodIconInput) {
  return `${input.foodName ?? ""} ${input.canonicalName ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function resolveFoodIcon(input: FoodIconInput) {
  const text = normalizeFoodIconText(input);
  return FOOD_ICON_RULES.find(rule => rule.pattern.test(text))?.icon ?? DEFAULT_FOOD_ICON;
}
