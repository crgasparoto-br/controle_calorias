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
    const contentRepository = source(
      "server/repositories/professionalContentRepository.ts"
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
    expect(migration).toContain("patient_professional_goal_suggestions_v1");
    expect(contentRepository).not.toContain("syncLegacyGoalSuggestions");
    expect(contentRepository).not.toContain(
      "await migrateLegacyGoalSuggestions"
    );
    expect(contentRepository).not.toContain("migrateLegacyGoalSuggestions");
    expect(contentRepository).toContain("migrateAllLegacyGoalSuggestions");
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

  it("keeps a versioned inventory and reproducible regression gate", () => {
    const inventory = source(
      "docs/testing/professional-legacy-retirement-regression.md"
    );
    const gate = source("scripts/check-professional-legacy-retirement.ts");

    expect(inventory).toContain("patient_professional_goal_suggestions_v1");
    expect(inventory).toContain("nutrition.professionals.askPatientQuestion");
    expect(inventory).toContain("Área do Paciente");
    expect(inventory).toContain("Área Profissional");
    expect(gate).toContain("App.professionalNavigation.test.tsx");
    expect(gate).toContain("nutritionPages.test.tsx");
  });
});
