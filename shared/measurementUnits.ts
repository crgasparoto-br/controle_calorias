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
  ["g", "g"],
  ["kilograma", "kg"],
  ["kilogramas", "kg"],
  ["quilo", "kg"],
  ["quilos", "kg"],
  ["kg", "kg"],
  ["miligrama", "mg"],
  ["miligramas", "mg"],
  ["mg", "mg"],
  ["mililitro", "ml"],
  ["mililitros", "ml"],
  ["ml", "ml"],
  ["litro", "l"],
  ["litros", "l"],
  ["l", "l"],
  ["un", "un"],
  ["unidade", "un"],
  ["unidades", "un"],
  ["scoop", "scoop"],
  ["scoops", "scoop"],
  ["long neck", "long neck"],
  ["longneck", "long neck"],
]);

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

export function normalizeMeasurementUnit(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return cleaned;
  }

  return UNIT_ALIASES.get(normalizeKey(cleaned)) ?? cleaned;
}
