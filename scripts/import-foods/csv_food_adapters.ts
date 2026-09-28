import { parseCsvContent, parseNumber, pick, type CsvRow } from "./csv.ts";
import { normalizeSourceCode } from "./normalize_food_name.ts";
import type { ImportFood, ImportPayload } from "./types.ts";

export type CsvFoodSource = "taco" | "tbca";

const SOURCE_METADATA: Record<
  CsvFoodSource,
  { name: string; codeCandidates: string[] }
> = {
  taco: {
    name: "Tabela Brasileira de Composicao de Alimentos (TACO)",
    codeCandidates: ["codigo", "cod", "id", "source_food_code"],
  },
  tbca: {
    name: "Tabela Brasileira de Composicao de Alimentos (TBCA)",
    codeCandidates: ["codigo", "cod", "id", "tbca_id", "source_food_code"],
  },
};

const FOOD_NAME_CANDIDATES = [
  "nome",
  "alimento",
  "descricao",
  "description",
  "name",
];

function mapFoodRow(
  source: CsvFoodSource,
  row: CsvRow,
  index: number
): ImportFood {
  const metadata = SOURCE_METADATA[source];
  const name = pick(row, FOOD_NAME_CANDIDATES);
  const code = pick(row, metadata.codeCandidates);
  const sourcePrefix = source.toUpperCase();
  return {
    sourceFoodCode: code
      ? normalizeSourceCode(code)
      : `${sourcePrefix}-${String(index + 1).padStart(5, "0")}`,
    name,
    category: pick(row, ["categoria", "grupo", "category"]),
    caloriesKcalPer100g: parseNumber(
      pick(row, ["energia_kcal", "kcal", "calorias", "calories"])
    ),
    proteinGramsPer100g: parseNumber(
      pick(row, ["proteina_g", "proteina", "protein_g", "protein"])
    ),
    carbsGramsPer100g: parseNumber(
      pick(row, ["carboidrato_g", "carboidratos", "carbs_g", "carbs"])
    ),
    fatGramsPer100g: parseNumber(
      pick(row, ["lipideos_g", "gordura_g", "fat_g", "fat"])
    ),
    fiberGramsPer100g: parseNumber(
      pick(row, ["fibra_g", "fiber_g", "fiber"])
    ),
    sugarGramsPer100g: parseNumber(
      pick(row, ["acucares_g", "açucares_g", "sugar_g", "sugar"])
    ),
    sodiumMgPer100g: parseNumber(
      pick(row, ["sodio_mg", "sodium_mg", "sodium"])
    ),
    nutrients: row,
    portions: [
      { label: "100 g", unit: "g", quantity: 100, grams: 100, isDefault: true },
    ],
  };
}

export function mapTacoFood(row: CsvRow, index: number) {
  return mapFoodRow("taco", row, index);
}

export function mapTbcaFood(row: CsvRow, index: number) {
  return mapFoodRow("tbca", row, index);
}

export function buildCsvImportPayload(input: {
  source: CsvFoodSource;
  csvContent: string;
  sourceVersion: string;
  sourceReference?: string | null;
  fileName?: string | null;
}): ImportPayload {
  const csvContent = input.csvContent.trim();
  if (!csvContent) {
    throw new Error("Envie um arquivo CSV para executar esta importação.");
  }
  const rows = parseCsvContent(csvContent);
  const metadata = SOURCE_METADATA[input.source];
  const sourceReference =
    input.sourceReference?.trim() || "admin-upload";
  const mapper = input.source === "taco" ? mapTacoFood : mapTbcaFood;
  return {
    source: {
      slug: input.source,
      name: metadata.name,
      version: input.sourceVersion.trim(),
      countryCode: "BR",
      sourceReference,
      notes: "Carga CSV administrativa; origem informada pelo operador.",
    },
    foods: rows.map(mapper),
  };
}
