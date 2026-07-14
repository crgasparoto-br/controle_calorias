import "dotenv/config";
import { migrateAllLegacyProfessionalData } from "../server/modules/professionals/persistenceService";

async function main() {
  const result = await migrateAllLegacyProfessionalData();
  console.log(JSON.stringify({
    event: "professional.persistence.migration.completed",
    scannedPreferences: result.scannedPreferences,
    migratedProfiles: result.migratedProfiles,
    migratedAuthorizations: result.migratedAuthorizations,
    invalidPreferences: result.invalidPreferences,
  }));
}

main().catch(error => {
  console.error(JSON.stringify({
    event: "professional.persistence.migration.failed",
    error: error instanceof Error ? error.name : "UnknownError",
  }));
  process.exitCode = 1;
});
