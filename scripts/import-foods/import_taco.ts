import { readCsv, parseNumber, pick } from "./csv.ts";
import { importFoods, printImportReport } from "./run_food_import.ts";
import { normalizeSourceCode } from "./normalize_food_name.ts";
import type { ImportFood, ImportPayload } from "./types.ts";

function usage() {
  console.error("Uso: pnpm foods:import:taco ./caminho/taco.csv");
}

function mapTacoFood(row: Record<string, string>, index: number): ImportFood {
  const name = pick(row, ["nome", "alimento", "descricao", "description", "name"]);
  const code = pick(row, ["codigo", "cod", "id", "source_food_code"]);

  return {
    sourceFoodCode: code ? normalizeSourceCode(code) : `TACO-${String(index + 1).padStart(5, "0")}`,
    name,
    category: pick(row, ["categoria", "grupo", "category"]),
    caloriesKcalPer100g: parseNumber(pick(row, ["energia_kcal", "kcal", "calorias", "calories"])),
    proteinGramsPer100g: parseNumber(pick(row, ["proteina_g", "proteina", "protein_g", "protein"])),
    carbsGramsPer100g: parseNumber(pick(row, ["carboidrato_g", "carboidratos", "carbs_g", "carbs"])),
    fatGramsPer100g: parseNumber(pick(row, ["lipideos_g", "gordura_g", "fat_g", "fat"])),
    fiberGramsPer100g: parseNumber(pick(row, ["fibra_g", "fiber_g", "fiber"])),
    sodiumMgPer100g: parseNumber(pick(row, ["sodio_mg", "sodium_mg", "sodium"])),
    nutrients: row,
    portions: [{ label: "100 g", unit: "g", quantity: 100, grams: 100, isDefault: true }],
  };
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    usage();
    process.exit(1);
  }

  const rows = await readCsv(csvPath);
  const payload: ImportPayload = {
    source: {
      slug: "taco",
      name: "Tabela Brasileira de Composicao de Alimentos (TACO)",
      version: process.env.FOOD_SOURCE_VERSION ?? "csv-local",
      countryCode: "BR",
      sourceUrl: process.env.FOOD_SOURCE_URL,
      notes: `Importacao CSV TACO executada em ${new Date().toISOString()}`,
    },
    foods: rows.map(mapTacoFood),
  };

  printImportReport(await importFoods(payload));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
