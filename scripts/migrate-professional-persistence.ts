import "dotenv/config";
import { getDb } from "../server/db";
import { migrateAllLegacyProfessionalData } from "../server/modules/professionals/persistenceService";

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "DATABASE_URL indisponível para executar o backfill profissional."
    );
  }

  const result = await migrateAllLegacyProfessionalData();
  console.log(
    JSON.stringify({
      event: "professional.persistence.migration.completed",
      scannedPreferences: result.scannedPreferences,
      migratedProfiles: result.migratedProfiles,
      migratedAuthorizations: result.migratedAuthorizations,
      invalidPreferences: result.invalidPreferences,
    })
  );
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "professional.persistence.migration.failed",
      error: error instanceof Error ? error.name : "UnknownError",
    })
  );
  process.exitCode = 1;
});
