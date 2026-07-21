import "dotenv/config";
import { getDb } from "../server/db";
import { migrateAllLegacyProfessionalGoalSuggestions } from "../server/modules/professionals/contentPersistenceService";
import { migrateAllLegacyProfessionalData } from "../server/modules/professionals/persistenceService";

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "DATABASE_URL indisponível para executar o backfill profissional."
    );
  }

  const result = await migrateAllLegacyProfessionalData();
  const goalSuggestions = await migrateAllLegacyProfessionalGoalSuggestions();
  console.log(
    JSON.stringify({
      event: "professional.persistence.migration.completed",
      scannedPreferences: result.scannedPreferences,
      migratedProfiles: result.migratedProfiles,
      migratedAuthorizations: result.migratedAuthorizations,
      invalidPreferences: result.invalidPreferences,
      scannedGoalSuggestionPreferences: goalSuggestions.scannedPreferences,
      migratedGoalSuggestions: goalSuggestions.migrated,
      invalidGoalSuggestionPreferences: goalSuggestions.invalid,
    })
  );
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(
      JSON.stringify({
        event: "professional.persistence.migration.failed",
        error: error instanceof Error ? error.name : "UnknownError",
      })
    );
    process.exit(1);
  });
