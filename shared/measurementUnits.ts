export const MEASUREMENT_UNIT_SUGGESTIONS = [
  "g",
  "gr",
  "kg",
  "mg",
  "ml",
  "l",
  "un",
  "unidade",
  "fatia",
  "colher de sopa",
  "colher de chá",
  "xícara",
  "copo",
  "dose",
  "scoop",
  "long neck",
  "lata",
  "garrafa",
  "porção",
] as const;

const UNIT_ALIASES = new Map<string, string>([
  ["grama", "g"],
  ["gramas", "g"],
  ["gr", "g"],
  ["grs", "g"],
  ["g", "g"],
  ["kilograma", "kg"],
  ["kilogramas", "kg"],
  ["quilograma", "kg"],
  ["quilogramas", "kg"],
  ["quilo", "kg"],
  ["quilos", "kg"],
  ["kg", "kg"],
  ["kgs", "kg"],
  ["miligrama", "mg"],
  ["miligramas", "mg"],
  ["mg", "mg"],
  ["mililitro", "ml"],
  ["mililitros", "ml"],
  ["ml", "ml"],
  ["mo", "ml"],
  ["litro", "l"],
  ["litros", "l"],
  ["lt", "l"],
  ["lts", "l"],
  ["l", "l"],
  ["un", "un"],
  ["unidade", "un"],
  ["unidades", "un"],
  ["fatia", "fatia"],
  ["fatias", "fatia"],
  ["colher", "colher"],
  ["colheres", "colher"],
  ["colher de sopa", "colher de sopa"],
  ["colheres de sopa", "colher de sopa"],
  ["colher de cha", "colher de chá"],
  ["colheres de cha", "colher de chá"],
  ["xicara", "xícara"],
  ["xicaras", "xícara"],
  ["copo", "copo"],
  ["copos", "copo"],
  ["dose", "dose"],
  ["doses", "dose"],
  ["scoop", "scoop"],
  ["scoops", "scoop"],
  ["long neck", "long neck"],
  ["longneck", "long neck"],
  ["lata", "lata"],
  ["latas", "lata"],
  ["garrafa", "garrafa"],
  ["garrafas", "garrafa"],
  ["porcao", "porção"],
  ["porcoes", "porção"],
  ["porção", "porção"],
  ["porções", "porção"],
]);

const UNIT_TOKEN_PATTERN = [
  "colheres?\\s+de\\s+sopa",
  "colheres?\\s+de\\s+ch[aá]",
  "mililitros?",
  "m\\s*l",
  "ml",
  "mo",
  "litros?",
  "lts?",
  "l",
  "gramas?",
  "grs?",
  "g",
  "quilogramas?",
  "quilos?",
  "kgs?",
  "kilogramas?",
  "kg",
  "miligramas?",
  "mg",
  "unidades?",
  "un",
  "fatias?",
  "x[ií]caras?",
  "copos?",
  "doses?",
  "scoops?",
  "long\\s*neck",
  "longneck",
  "latas?",
  "garrafas?",
  "por[cç][oõ]es?",
  "por[cç][aã]o",
].join("|");

const LIQUID_DENSITY_G_PER_ML: Array<{ pattern: RegExp; density: number }> = [
  { pattern: /\bagua\b/i, density: 1 },
  { pattern: /\bleite\s+integral\b/i, density: 1.03 },
  { pattern: /\bleite\b/i, density: 1.03 },
  { pattern: /\bcafe\b/i, density: 1 },
  { pattern: /\bcha\b/i, density: 1 },
];

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function formatPtBrNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

function findDensityGPerMl(foodName: string) {
  const normalized = normalizeKey(foodName);
  return LIQUID_DENSITY_G_PER_ML.find(entry => entry.pattern.test(normalized))?.density ?? null;
}

export function normalizeMeasurementUnit(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return cleaned;
  }

  return UNIT_ALIASES.get(normalizeKey(cleaned)) ?? cleaned;
}

export function normalizeTextMeasurementUnits(text: string) {
  return text.replace(
    new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${UNIT_TOKEN_PATTERN})(?=\\b|\\s|$)`, "giu"),
    (_match, quantity: string, unit: string) => `${quantity} ${normalizeMeasurementUnit(unit)}`,
  );
}

export function getFoodDensityGPerMl(foodName: string) {
  return findDensityGPerMl(foodName);
}

export function convertFoodQuantityForRegistration(input: {
  foodName: string;
  quantity: number;
  unit: string;
}) {
  const unit = normalizeMeasurementUnit(input.unit);
  const density = findDensityGPerMl(input.foodName);
  if (!density) {
    return null;
  }

  if (unit === "g") {
    const volumeMl = input.quantity / density;
    return {
      quantity: Number(volumeMl.toFixed(1)),
      unit: "ml",
      estimatedGrams: input.quantity,
      portionText: `${formatPtBrNumber(volumeMl)} ml (convertido de ${formatPtBrNumber(input.quantity)} g)`,
      conversionNote: `Converti ${formatPtBrNumber(input.quantity)} g de ${input.foodName} para aproximadamente ${formatPtBrNumber(volumeMl)} ml.`,
    };
  }

  if (unit === "ml") {
    return {
      quantity: input.quantity,
      unit,
      estimatedGrams: input.quantity * density,
      portionText: `${formatPtBrNumber(input.quantity)} ml`,
      conversionNote: null,
    };
  }

  if (unit === "l") {
    const volumeMl = input.quantity * 1000;
    return {
      quantity: volumeMl,
      unit: "ml",
      estimatedGrams: volumeMl * density,
      portionText: `${formatPtBrNumber(volumeMl)} ml`,
      conversionNote: null,
    };
  }

  return null;
}
