import { readFile } from "node:fs/promises";

import { buildCsvImportPayload } from "./csv_food_adapters.ts";
import { importFoods, printImportReport } from "./run_food_import.ts";

function usage() {
  console.error("Uso: pnpm foods:import:taco ./caminho/taco.csv");
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    usage();
    process.exit(1);
  }

  const payload = buildCsvImportPayload({
    source: "taco",
    csvContent: await readFile(csvPath, "utf8"),
    sourceVersion: process.env.FOOD_SOURCE_VERSION ?? "csv-local",
    sourceReference: process.env.FOOD_SOURCE_URL ?? csvPath,
  });

  printImportReport(await importFoods(payload));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
