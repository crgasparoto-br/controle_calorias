import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseCsvContent, parseNumber, pick } from "../../../scripts/import-foods/csv.ts";
import { normalizeSourceCode } from "../../../scripts/import-foods/normalize_food_name.ts";
import { importFoods } from "../../../scripts/import-foods/run_food_import.ts";
import type { ImportFood, ImportPayload, ImportReport } from "../../../scripts/import-foods/types.ts";
import type { RunFoodImportJobInput } from "./schemas";

type CsvFoodImportJobInput = Extract<RunFoodImportJobInput, { job: "import_taco" | "import_tbca" }>;

const COMMON_BRAZIL_FOODS_SEED_PATH = path.join(process.cwd(), "scripts", "import-foods", "common_brazil_foods.seed.json");

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

function mapTbcaFood(row: Record<string, string>, index: number): ImportFood {
  const name = pick(row, ["nome", "alimento", "descricao", "description", "name"]);
  const code = pick(row, ["codigo", "cod", "id", "tbca_id", "source_food_code"]);

  return {
    sourceFoodCode: code ? normalizeSourceCode(code) : `TBCA-${String(index + 1).padStart(5, "0")}`,
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

async function runCommonBrazilSeed() {
  const content = await readFile(COMMON_BRAZIL_FOODS_SEED_PATH, "utf8");
  const payload = JSON.parse(content) as ImportPayload;
  return importFoods(payload);
}

async function runCsvImport(input: CsvFoodImportJobInput) {
  const csvContent = input.csvContent.trim();
  if (!csvContent) {
    throw new Error("Envie um arquivo CSV para executar esta importação.");
  }

  const rows = parseCsvContent(csvContent);
  const sourceVersion = input.sourceVersion?.trim() || `admin-upload-${new Date().toISOString().slice(0, 10)}`;
  const sourceUrl = input.fileName ? `admin-upload:${input.fileName}` : undefined;

  const payload: ImportPayload = input.job === "import_taco"
    ? {
        source: {
          slug: "taco",
          name: "Tabela Brasileira de Composicao de Alimentos (TACO)",
          version: sourceVersion,
          countryCode: "BR",
          sourceUrl,
          notes: `Importacao CSV TACO executada pelo painel admin em ${new Date().toISOString()}`,
        },
        foods: rows.map(mapTacoFood),
      }
    : {
        source: {
          slug: "tbca",
          name: "Tabela Brasileira de Composicao de Alimentos (TBCA)",
          version: sourceVersion,
          countryCode: "BR",
          sourceUrl,
          notes: `Importacao CSV TBCA executada pelo painel admin em ${new Date().toISOString()}`,
        },
        foods: rows.map(mapTbcaFood),
      };

  return importFoods(payload);
}

export async function runFoodImportJob(input: RunFoodImportJobInput): Promise<ImportReport> {
  if (input.job === "seed_common_br") {
    return runCommonBrazilSeed();
  }

  return runCsvImport(input);
}
