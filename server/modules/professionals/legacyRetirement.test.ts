import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("professional legacy retirement architecture", () => {
  it("keeps legacy JSON access behind explicit migration commands only", () => {
    const repository = source("server/repositories/professionalRepository.ts");
    const service = source("server/modules/professionals/service.ts");
    const persistenceService = source(
      "server/modules/professionals/persistenceService.ts"
    );
    const migration = source(
      "scripts/retire-professional-legacy-preferences.ts"
    );

    expect(repository).not.toContain("writeLegacyProfile");
    expect(repository).not.toContain("writeLegacyAuthorization");
    expect(repository).not.toContain("await migrateLegacyUser(");
    expect(repository).not.toContain("await migrateRelatedAuthorizations(");
    expect(repository).not.toContain("migrateLegacyUser");
    expect(persistenceService).not.toContain(
      "migrateLegacyProfessionalDataForUser"
    );
    expect(service).not.toContain("userPreferences");
    expect(service).not.toContain("professional_profile_v1");
    expect(migration).toContain("migrateAllLegacyProfessionalData");
    expect(migration).toContain("--apply");
  });

  it("does not expose the retired page or legacy professional AI endpoint", () => {
    const layout = source("client/src/components/ProfessionalLayout.tsx");
    const router = source("server/nutritionRouter.ts");
    const schemas = source("server/modules/professionals/schemas.ts");

    expect(layout).not.toContain("Experiência legada");
    expect(router).not.toContain("askPatientQuestion");
    expect(schemas).not.toContain("professionalPatientQuestionSchema");
    expect(
      fs.existsSync(
        path.join(process.cwd(), "client/src/pages/ProfessionalPage.tsx")
      )
    ).toBe(false);
  });
});
