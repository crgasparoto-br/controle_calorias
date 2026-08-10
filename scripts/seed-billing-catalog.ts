import "dotenv/config";
import { billingCatalogService } from "../server/modules/billing/catalogRuntime";

async function main() {
  const result = await billingCatalogService.seedInitialCatalog();
  console.log(
    JSON.stringify({
      event: "billing.catalog.seed.completed",
      insertedProducts: result.products,
      insertedVersions: result.versions,
    })
  );
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "billing.catalog.seed.failed",
      errorType: error instanceof Error ? error.name : "unknown",
    })
  );
  process.exitCode = 1;
});
