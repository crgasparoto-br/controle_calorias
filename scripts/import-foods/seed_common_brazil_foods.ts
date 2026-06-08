import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importFoods, printImportReport } from "./run_food_import.ts";
import type { ImportPayload } from "./types.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(currentDir, "common_brazil_foods.seed.json");

async function main() {
  const content = await readFile(seedPath, "utf8");
  const payload = JSON.parse(content) as ImportPayload;
  const report = await importFoods(payload);
  printImportReport(report);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
