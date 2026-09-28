import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildCsvImportPayload } from "../../../scripts/import-foods/csv_food_adapters.ts";
import {
  importFoods,
  previewFoods,
} from "../../../scripts/import-foods/run_food_import.ts";
import type { ImportFoodsOptions } from "../../../scripts/import-foods/run_food_import.ts";
import type {
  ImportPayload,
  ImportReport,
} from "../../../scripts/import-foods/types.ts";
import type {
  PreviewFoodImportJobInput,
  PublishFoodImportJobInput,
  RunFoodImportJobInput,
} from "./schemas";
import type { ImportPreviewReport } from "../../../scripts/import-foods/run_food_import.ts";

type CsvFoodImportJobInput = Extract<
  RunFoodImportJobInput,
  { job: "import_taco" | "import_tbca" }
>;

const COMMON_BRAZIL_FOODS_SEED_PATH = path.join(
  process.cwd(),
  "scripts",
  "import-foods",
  "common_brazil_foods.seed.json"
);
const ADMIN_CSV_IMPORT_TRANSACTION_BATCH_SIZE = 50;

async function runCommonBrazilSeed(options: ImportFoodsOptions) {
  const content = await readFile(COMMON_BRAZIL_FOODS_SEED_PATH, "utf8");
  const payload = JSON.parse(content) as ImportPayload;
  return importFoods(payload, options);
}

async function runCsvImport(
  input: CsvFoodImportJobInput,
  options: ImportFoodsOptions,
  mode: "preview" | "publish" = "publish",
  previewHash?: string
) {
  const csvContent = input.csvContent.trim();
  if (!csvContent) {
    throw new Error("Envie um arquivo CSV para executar esta importação.");
  }

  const payload = buildCsvImportPayload({
    source: input.job === "import_taco" ? "taco" : "tbca",
    csvContent,
    sourceVersion:
      input.sourceVersion?.trim() || `admin-upload-${new Date().toISOString().slice(0, 10)}`,
    sourceReference: input.sourceReference,
    fileName: input.fileName,
  });
  const importOptions = {
    ...options,
    transactionBatchSize: ADMIN_CSV_IMPORT_TRANSACTION_BATCH_SIZE,
    ...(previewHash ? { expectedPreviewHash: previewHash } : {}),
  };
  return mode === "preview"
    ? previewFoods(payload, options)
    : importFoods(payload, importOptions);
}

export async function previewFoodImportJob(
  input: PreviewFoodImportJobInput,
  options: ImportFoodsOptions = {}
): Promise<ImportPreviewReport> {
  return (await runCsvImport(input, options, "preview")) as ImportPreviewReport;
}

export async function publishFoodImportJob(
  input: PublishFoodImportJobInput,
  options: ImportFoodsOptions = {}
): Promise<ImportReport> {
  return (await runCsvImport(
    input,
    options,
    "publish",
    input.previewHash
  )) as ImportReport;
}

export async function runFoodImportJob(
  input: RunFoodImportJobInput,
  options: ImportFoodsOptions = {}
): Promise<ImportReport> {
  if (input.job === "seed_common_br") {
    return runCommonBrazilSeed(options);
  }

  return (await runCsvImport(input, options)) as ImportReport;
}
