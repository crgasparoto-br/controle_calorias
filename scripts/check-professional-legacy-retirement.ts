import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures: string[] = [];

function source(relativePath: string) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute)) {
    failures.push(`Arquivo obrigatório ausente: ${relativePath}`);
    return "";
  }
  return readFileSync(absolute, "utf8");
}

function requireText(relativePath: string, expected: string) {
  if (!source(relativePath).includes(expected)) {
    failures.push(`${relativePath} não contém: ${expected}`);
  }
}

function forbidText(relativePath: string, forbidden: string) {
  if (source(relativePath).includes(forbidden)) {
    failures.push(`${relativePath} ainda contém legado proibido: ${forbidden}`);
  }
}

for (const [file, marker] of [
  [
    "client/src/pages/nutritionPages.test.tsx",
    "renderiza o dashboard com visão diária",
  ],
  [
    "client/src/pages/nutritionPages.test.tsx",
    "renderiza a página de registro multimodal",
  ],
  [
    "client/src/pages/nutritionPages.test.tsx",
    "renderiza registros de refeições e todos os exercícios do intervalo",
  ],
  ["client/src/pages/nutritionPages.test.tsx", "renderiza a página de metas"],
  [
    "client/src/pages/nutritionPages.test.tsx",
    "renderiza a página de relatórios",
  ],
  ["client/src/pages/nutritionPages.test.tsx", "renderiza as configurações"],
  [
    "client/src/App.professionalNavigation.test.tsx",
    "redirects the retired follow-up bookmark to the portfolio",
  ],
  [
    "client/src/App.professionalNavigation.test.tsx",
    "does not substitute a neighboring entitlement for the route entitlement",
  ],
  [
    "client/src/components/ProfessionalLayout.test.tsx",
    "blocks inactive profiles without exposing professional content",
  ],
  [
    "client/src/components/ProfessionalLayout.test.tsx",
    "recognizes canonical authorization and entitlement revocation errors",
  ],
  [
    "client/src/components/ProfessionalLayout.test.tsx",
    "removes context immediately when a query reports revoked access",
  ],
  [
    "client/src/components/ProfessionalLayout.test.tsx",
    "removes context immediately when a mutation reports revoked access",
  ],
  [
    "client/src/components/ProfessionalLayout.test.tsx",
    "ignores late query and mutation errors from another patient",
  ],
  [
    "client/src/components/ProfessionalLayout.test.tsx",
    "ignores an id-less mutation submitted before the current patient became ready",
  ],
  [
    "client/src/components/ProfessionalLayout.historyNavigation.test.tsx",
    "ignores a late patient transition after rapid back and forward navigation",
  ],
  [
    "client/src/components/ProfessionalAiWorkspace.test.tsx",
    "keeps an AI draft local until the professional explicitly saves it",
  ],
  [
    "client/src/components/ProfessionalReportsWorkspace.test.tsx",
    "shows aggregate indicators through the reports resource",
  ],
] as const) {
  requireText(file, marker);
}

for (const [file, forbidden] of [
  ["server/modules/professionals/service.ts", "userPreferences"],
  ["server/modules/professionals/service.ts", "professional_profile_v1"],
  ["server/repositories/professionalRepository.ts", "migrateLegacyUser"],
  [
    "server/repositories/professionalContentRepository.ts",
    "syncLegacyGoalSuggestions",
  ],
  [
    "server/repositories/professionalContentRepository.ts",
    "migrateLegacyGoalSuggestions",
  ],
  ["server/nutritionRouter.ts", "askPatientQuestion"],
  ["client/src/components/ProfessionalLayout.tsx", "Experiência legada"],
  ["docs/design-docs/database-persistence.md", "recebe dual-write temporário"],
  [
    "docs/design-docs/database-persistence.md",
    "manter a importação lazy e o dual-write",
  ],
  ["docs/design-docs/database-persistence.md", "três chaves JSON antigas"],
] as const) {
  forbidText(file, forbidden);
}

for (const contract of [
  "PROFESSIONAL_PROFILE_PREFERENCE_KEY",
  "PROFESSIONAL_ACCESSES_PREFERENCE_KEY",
  "PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY",
  "PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY",
]) {
  requireText("scripts/retire-professional-legacy-preferences.ts", contract);
}

requireText(
  "scripts/retire-professional-legacy-preferences.ts",
  "goalSuggestionIsCovered"
);
requireText("scripts/retire-professional-legacy-preferences.ts", "stableJson");

for (const key of [
  "professional_profile_v1",
  "professional_accesses_v1",
  "patient_professional_access_requests_v1",
  "patient_professional_goal_suggestions_v1",
]) {
  requireText("docs/design-docs/database-persistence.md", key);
}

requireText(
  "docs/testing/professional-legacy-retirement-regression.md",
  "Inventário de artefatos legados"
);
requireText(
  "docs/testing/professional-legacy-retirement-regression.md",
  "Matriz de regressão reproduzível"
);
requireText(
  "docs/testing/professional-legacy-retirement-regression.md",
  "Metas JSON semanticamente equivalentes"
);
requireText(
  "docs/testing/professional-legacy-retirement-regression.md",
  "Ordenação de resultados canônicos"
);

if (failures.length) {
  console.error("Falhas no gate de aposentadoria profissional:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Gate de aposentadoria profissional validado com sucesso.");
