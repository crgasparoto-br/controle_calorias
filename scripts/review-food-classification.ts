import "dotenv/config";
import { getDb } from "../server/db";
import { buildCatalogClassificationReviewQueue } from "../server/modules/foods/catalogClassificationReview";
import { createDrizzleFoodCatalogRepository } from "../server/repositories/foodCatalogRepository";

function summarizeQueue(queue: ReturnType<typeof buildCatalogClassificationReviewQueue>) {
  return queue.reduce<Record<string, number>>((summary, item) => {
    summary[item.state] = (summary[item.state] ?? 0) + 1;
    return summary;
  }, {});
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required to review food classifications.");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database connection is unavailable for food classification review.");
  }

  const repository = createDrizzleFoodCatalogRepository({
    getDb,
    onWarning: (scope, error) => {
      console.warn(`[Classification review] ${scope}:`, error instanceof Error ? error.message : error);
    },
  });
  const rows = await repository.findAll();
  const queue = buildCatalogClassificationReviewQueue(rows);

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "foodCatalog",
    totalCatalogEntries: rows.length,
    pendingReviewEntries: queue.length,
    summary: summarizeQueue(queue),
    items: queue,
  }, null, 2));
}

main().catch(error => {
  console.error(
    "[Classification review] Execution failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
