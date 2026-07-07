export type FoodIconInput = {
  foodName?: string | null;
  canonicalName?: string | null;
  category?: string | null;
  classification?: string | null;
  tags?: string[] | null;
};

export const DEFAULT_FOOD_ICON = "🍽️";

const FOOD_ICON_RULES: Array<{ pattern: RegExp; icon: string }> = [
  { pattern: /\b(banana)\b/, icon: "🍌" },
  { pattern: /\b(maca|apple)\b/, icon: "🍎" },
  { pattern: /\b(laranja|orange|mexerica|tangerina|limao|lemon)\b/, icon: "🍊" },
  { pattern: /\b(morango|strawberry)\b/, icon: "🍓" },
  { pattern: /\b(uva|grape)\b/, icon: "🍇" },
  { pattern: /\b(abacate|avocado)\b/, icon: "🥑" },
  { pattern: /\b(mamao|papaya|manga|abacaxi|pineapple|pera|pear|melancia|watermelon|melao)\b/, icon: "🍎" },
  { pattern: /\b(ovo|omelete)\b/, icon: "🥚" },
  { pattern: /\b(frango|chicken|carne|bife|steak|patinho|maminha|picanha|porco|lombo|bacon)\b/, icon: "🍗" },
  { pattern: /\b(peixe|fish|salmao|atum|tilapia|sardinha|camarao|shrimp)\b/, icon: "🐟" },
  { pattern: /\b(arroz|rice|feijao|lentilha|grao de bico|ervilha|quinoa)\b/, icon: "🍚" },
  { pattern: /\b(macarrao|massa|pasta|lasanha|nhoque)\b/, icon: "🍝" },
  { pattern: /\b(pao|torrada|bisnaguinha|sandui?che|wrap|tapioca|cuscuz)\b/, icon: "🍞" },
  { pattern: /\b(queijo|cheese|requeijao|ricota|cottage)\b/, icon: "🧀" },
  { pattern: /\b(leite|iogurte|whey|coalhada|kefir)\b/, icon: "🥛" },
  { pattern: /\b(cafe|coffee|capuccino|cappuccino|cha|tea)\b/, icon: "☕" },
  { pattern: /\b(agua|water|suco|juice|refrigerante|coca|guarana|cerveja|beer|vinho|wine)\b/, icon: "🥤" },
  { pattern: /\b(salada|alface|legume|brocolis|tomate|cenoura|pepino|abobrinha|berinjela|couve|espinafre|rucula|repolho)\b/, icon: "🥗" },
  { pattern: /\b(batata|mandioca|aipim|inhame|car\s*a|batata doce)\b/, icon: "🥔" },
  { pattern: /\b(chocolate|doce|bolo|cookie|biscoito|bolacha|sorvete|brigadeiro|pudim)\b/, icon: "🍫" },
  { pattern: /\b(amendoim|castanha|nozes|amendoa|pistache|nuts?)\b/, icon: "🥜" },
  { pattern: /\b(azeite|oleo|manteiga|margarina|maionese)\b/, icon: "🧈" },
];

const CATEGORY_ICON_RULES: Array<{ pattern: RegExp; icon: string }> = [
  { pattern: /\b(fruta|fruit)\b/, icon: "🍎" },
  { pattern: /\b(vegetal|verdura|legume|salada|hortalica|vegetable)\b/, icon: "🥗" },
  { pattern: /\b(proteina|protein|carne|ave|meat|poultry)\b/, icon: "🍗" },
  { pattern: /\b(peixe|pescado|seafood|fish)\b/, icon: "🐟" },
  { pattern: /\b(laticinio|dairy|leite|iogurte)\b/, icon: "🥛" },
  { pattern: /\b(cereal|grao|carboidrato|carb|grain|leguminosa)\b/, icon: "🍚" },
  { pattern: /\b(massa|pasta)\b/, icon: "🍝" },
  { pattern: /\b(pao|padaria|bakery|bread)\b/, icon: "🍞" },
  { pattern: /\b(bebida|drink|beverage)\b/, icon: "🥤" },
  { pattern: /\b(cafe|cha|coffee|tea)\b/, icon: "☕" },
  { pattern: /\b(doce|sobremesa|ultraprocessado|snack|dessert|sweet)\b/, icon: "🍫" },
  { pattern: /\b(oleo|gordura|fat|oil)\b/, icon: "🧈" },
  { pattern: /\b(oleaginosa|nuts?|castanha)\b/, icon: "🥜" },
];

function normalizeFoodIconText(input: string | null | undefined) {
  return `${input ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeFoodSearchText(input: FoodIconInput) {
  return normalizeFoodIconText(`${input.foodName ?? ""} ${input.canonicalName ?? ""}`);
}

function normalizeCategorySearchText(input: FoodIconInput) {
  return normalizeFoodIconText([
    input.category,
    input.classification,
    ...(input.tags ?? []),
  ].filter(Boolean).join(" "));
}

export function resolveFoodIcon(input: FoodIconInput) {
  const foodText = normalizeFoodSearchText(input);
  const textIcon = FOOD_ICON_RULES.find(rule => rule.pattern.test(foodText))?.icon;
  if (textIcon) {
    return textIcon;
  }

  const categoryText = normalizeCategorySearchText(input);
  return CATEGORY_ICON_RULES.find(rule => rule.pattern.test(categoryText))?.icon ?? DEFAULT_FOOD_ICON;
}
