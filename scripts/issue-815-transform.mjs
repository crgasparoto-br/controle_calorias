import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceExact(path, content, before, after, label) {
  const count = content.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${path}: expected one ${label}, found ${count}`);
  }
  return content.replace(before, after);
}

function replaceRegex(path, content, regex, after, label, expected = 1) {
  const matches = content.match(regex) ?? [];
  if (matches.length !== expected) {
    throw new Error(`${path}: expected ${expected} ${label}, found ${matches.length}`);
  }
  return content.replace(regex, after);
}

function assertAbsent(path, content, values) {
  for (const value of values) {
    if (content.includes(value)) throw new Error(`${path}: residual value ${value}`);
  }
}

{
  const path = "client/src/App.tsx";
  let content = read(path);
  content = replaceExact(
    path,
    content,
    `function LegacyProfessionalRedirect() {\n  const [, setLocation] = useLocation();\n  useEffect(() => setLocation("/professional/reports"), [setLocation]);\n  return <PageLoadingFallback />;\n}`,
    `function RetiredProfessionalBookmarkRedirect() {\n  const [, setLocation] = useLocation();\n  useEffect(() => setLocation("/professional"), [setLocation]);\n  return <PageLoadingFallback />;\n}`,
    "legacy redirect component"
  );
  content = replaceExact(
    path,
    content,
    `<Route path="/professional/legacy" component={LegacyProfessionalRedirect} />`,
    `<Route path="/professional/legacy" component={RetiredProfessionalBookmarkRedirect} />`,
    "legacy route tombstone"
  );
  write(path, content);
}

{
  const path = "client/src/components/ProfessionalLayout.tsx";
  let content = read(path);
  content = replaceRegex(
    path,
    content,
    /\n\s*<Button\n\s*variant="outline"\n\s*className="shrink-0"\n\s*onClick=\{\(\) => \{\n\s*clearPatient\(\);\n\s*setLocation\("\/professional\/legacy"\);\n\s*\}\}\n\s*>\n\s*Experiência legada\n\s*<\/Button>/g,
    "",
    "visible legacy experience button"
  );
  assertAbsent(path, content, ["Experiência legada", "setLocation(\"/professional/legacy\")"]);
  write(path, content);
}

{
  const path = "client/src/App.professionalNavigation.test.tsx";
  let content = read(path);
  content = replaceRegex(
    path,
    content,
    /\n\s*it\("redirects the retired legacy entry to the current professional reports",[\s\S]*?\n\s*\}\);/g,
    `\n  it("redirects an old professional bookmark without exposing legacy UI", async () => { window.history.replaceState({}, "", "/professional/legacy"); const { default: App } = await import("./App"); render(<App />); await waitFor(() => expect(window.location.pathname).toBe("/professional")); expect(await screen.findByRole("heading", { name: "Início profissional" })).toBeTruthy(); expect(screen.queryByRole("button", { name: "Experiência legada" })).toBeNull(); });`,
    "legacy navigation test"
  );
  write(path, content);
}

{
  const path = "server/repositories/professionalRepository.ts";
  let content = read(path);
  content = replaceExact(path, content, "  canonicalAuthorizationToLegacy,\n", "", "legacy serializer import");
  content = replaceRegex(
    path,
    content,
    /\nfunction mergeLegacyAccesses\([\s\S]*?\n\}\n\nconst fallbackProfiles/g,
    "\nconst fallbackProfiles",
    "legacy merge helper"
  );
  content = replaceRegex(
    path,
    content,
    /\nasync function readLegacyPreference\([\s\S]*?\nexport function createDrizzleProfessionalRepository/g,
    "\nexport function createDrizzleProfessionalRepository",
    "legacy runtime read/write helpers"
  );
  content = replaceExact(path, content, "    await migrateLegacyUser(userId);\n", "", "lazy profile migration");
  content = replaceExact(
    path,
    content,
    `    await migrateLegacyUser(professionalUserId);\n    await migrateRelatedAuthorizations(professionalUserId, "professional");\n`,
    "",
    "lazy professional authorization migration"
  );
  content = replaceExact(
    path,
    content,
    `    await migrateLegacyUser(patientUserId);\n    await migrateRelatedAuthorizations(patientUserId, "patient");\n`,
    "",
    "lazy patient authorization migration"
  );
  content = replaceRegex(
    path,
    content,
    /\n\s*await Promise\.all\(\[\n\s*migrateLegacyUser\(professionalUserId\),\n\s*migrateLegacyUser\(patientUserId\),\n\s*migrateRelatedAuthorizations\(professionalUserId, "professional"\),\n\s*migrateRelatedAuthorizations\(patientUserId, "patient"\),\n\s*\]\);/g,
    "",
    "lazy approved authorization migration"
  );
  content = replaceRegex(
    path,
    content,
    /\n\s*try \{\n\s*await writeLegacyProfile\(db, profile\);\n\s*\} catch \{\n\s*warning\([\s\S]*?"legacy_write_failed"\n\s*\);\n\s*\}/g,
    "",
    "legacy profile dual-write"
  );
  content = replaceRegex(
    path,
    content,
    /\n\s*try \{\n\s*await writeLegacyAuthorization\(db, authorization\);\n\s*\} catch \{\n\s*warning\([\s\S]*?"legacy_write_failed"\n\s*\);\n\s*\}/g,
    "",
    "legacy authorization dual-writes",
    3
  );
  assertAbsent(path, content, [
    "writeLegacyProfile",
    "writeLegacyAuthorization",
    "canonicalAuthorizationToLegacy",
    "legacy_profile_dual_write_failed",
    "legacy_authorization_dual_write_failed",
    "await migrateLegacyUser(",
    "await migrateRelatedAuthorizations(",
  ]);
  write(path, content);
}

{
  const path = "server/modules/professionals/service.ts";
  let content = read(path);
  content = replaceExact(path, content, `import { and, eq, or } from "drizzle-orm";`, `import { eq, or } from "drizzle-orm";`, "drizzle imports");
  content = replaceExact(
    path,
    content,
    `import {\n  userPreferences,\n  users,\n  whatsappConnections,\n} from "../../../drizzle/schema";`,
    `import { users, whatsappConnections } from "../../../drizzle/schema";`,
    "legacy preference import"
  );
  content = replaceExact(path, content, `import { invokeLLM } from "../../_core/llm";\n`, "", "legacy AI import");
  content = replaceExact(path, content, `import { redactSensitiveText } from "../../privacy";\n`, "", "legacy redaction import");
  for (const line of [
    "  professionalPatientAnswerSchema,\n",
    "  type ProfessionalPatientAnswer,\n",
    "  type ProfessionalPatientQuestionInput,\n",
  ]) content = replaceExact(path, content, line, "", `schema import ${line.trim()}`);
  content = replaceRegex(
    path,
    content,
    /\nexport type ProfessionalAccessReconciliationResult = \{[\s\S]*?\n\};/g,
    "",
    "reconciliation result type"
  );
  content = replaceRegex(
    path,
    content,
    /\nconst PROFESSIONAL_AI_NOTICE =[\s\S]*?const PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY =\n\s*"patient_professional_access_requests_v1";/g,
    `\ntype AccessOwner = "professional" | "patient";`,
    "legacy constants"
  );
  content = replaceRegex(
    path,
    content,
    /\nconst profiles = new Map[\s\S]*?\n\}/g,
    "",
    "process-local compatibility stores"
  );
  content = replaceRegex(
    path,
    content,
    /function rememberCanonicalAuthorization\([\s\S]*?\n\}/g,
    `function rememberCanonicalAuthorization(\n  authorization: CanonicalProfessionalAuthorization\n) {\n  return canonicalAuthorizationToAccess(authorization);\n}`,
    "canonical authorization adapter"
  );
  content = replaceRegex(
    path,
    content,
    /async function loadPersistedAccesses\([\s\S]*?\n\}\n\nasync function loadProfessionalAccessesForPatient/g,
    `async function loadPersistedAccesses(userId: number, owner: AccessOwner) {\n  const canonical =\n    owner === "professional"\n      ? await professionalRepository.listAuthorizationsByProfessional(userId)\n      : await professionalRepository.listAuthorizationsByPatient(userId);\n  return canonical\n    .map(rememberCanonicalAuthorization)\n    .sort((a, b) => b.requestedAt - a.requestedAt);\n}\n\nasync function loadProfessionalAccessesForPatient`,
    "canonical access loader"
  );
  content = replaceRegex(
    path,
    content,
    /async function loadProfessionalAccessesForPatient\([\s\S]*?\n\}\n\nasync function loadPatientAccessRequestState/g,
    `async function loadProfessionalAccessesForPatient(\n  patientUserId: number\n): Promise<ProfessionalPatientAccess[]> {\n  const canonical =\n    await professionalRepository.listAuthorizationsByPatient(patientUserId);\n  return canonical.map(rememberCanonicalAuthorization);\n}\n\nasync function loadPatientAccessRequestState`,
    "canonical patient access loader"
  );
  content = replaceRegex(
    path,
    content,
    /\nasync function loadPatientAccessRequestState[\s\S]*?\nasync function persistProfessionalProfile/g,
    "\nasync function persistProfessionalProfile",
    "legacy reconciliation and profile parser"
  );
  content = replaceExact(path, content, "  profiles.set(persisted.userId, persisted);\n", "", "profile memory cache write");
  content = replaceRegex(
    path,
    content,
    /async function loadPersistedProfessionalProfile\(userId: number\) \{[\s\S]*?\n\}/g,
    `async function loadPersistedProfessionalProfile(userId: number) {\n  const canonical = await professionalRepository.getProfile(userId);\n  if (!canonical) return null;\n  return {\n    userId: canonical.userId,\n    displayName: canonical.displayName,\n    registrationNumber: canonical.registrationNumber,\n    active: canonical.active,\n    createdAt: canonical.createdAt.getTime(),\n    updatedAt: canonical.updatedAt.getTime(),\n  } satisfies ProfessionalProfile;\n}`,
    "canonical profile loader"
  );
  content = replaceRegex(
    path,
    content,
    /\nfunction parseAssistantContent\([\s\S]*?\n\}/g,
    "",
    "legacy AI parser"
  );
  content = replaceExact(
    path,
    content,
    `export async function upsertProfessionalProfile(\n  userId: number,\n  input: ProfessionalProfileInput\n) {\n  const now = Date.now();`,
    `export async function upsertProfessionalProfile(\n  userId: number,\n  input: ProfessionalProfileInput\n) {\n  const current = await getProfessionalProfile(userId);\n  const now = Date.now();`,
    "profile upsert prelude"
  );
  content = replaceExact(path, content, "    createdAt: profiles.get(userId)?.createdAt ?? now,", "    createdAt: current?.createdAt ?? now,", "profile createdAt source");
  content = replaceRegex(
    path,
    content,
    /export async function getProfessionalProfile\(userId: number\) \{[\s\S]*?\n\}/g,
    `export async function getProfessionalProfile(userId: number) {\n  return loadPersistedProfessionalProfile(userId);\n}`,
    "profile read fallback"
  );
  content = content.replaceAll("PROFESSIONAL_ACCESSES_PREFERENCE_KEY", `"professional"`);
  content = content.replaceAll("PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY", `"patient"`);
  content = replaceExact(
    path,
    content,
    `export async function listPatientAccessRequests(patientUserId: number) {\n  const { patientAccesses } =\n    await loadPatientAccessRequestState(patientUserId);`,
    `export async function listPatientAccessRequests(patientUserId: number) {\n  const patientAccesses = await loadPersistedAccesses(patientUserId, "patient");`,
    "patient access canonical listing"
  );
  content = content.replaceAll(` ??\n    accesses.get(accessId)`, "");
  content = replaceRegex(
    path,
    content,
    /\ntype ProfessionalPatientDashboard =[\s\S]*?\nexport async function addProfessionalComment/g,
    "\nexport async function addProfessionalComment",
    "legacy AI context helpers"
  );
  content = replaceRegex(
    path,
    content,
    /\nexport async function answerProfessionalPatientQuestion\([\s\S]*?\n\}\n\nexport async function listProfessionalHistory/g,
    "\nexport async function listProfessionalHistory",
    "legacy AI endpoint service"
  );
  assertAbsent(path, content, [
    "userPreferences",
    "PROFESSIONAL_PROFILE_PREFERENCE_KEY",
    "PROFESSIONAL_ACCESSES_PREFERENCE_KEY",
    "PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY",
    "profiles.",
    "accesses.",
    "reconcilePatientAccessRequests",
    "loadPatientAccessRequestState",
    "answerProfessionalPatientQuestion",
    "PROFESSIONAL_AI_NOTICE",
    "invokeLLM",
    "redactSensitiveText",
  ]);
  write(path, content);
}

{
  const path = "server/nutritionRouter.ts";
  let content = read(path);
  content = replaceExact(path, content, "  professionalPatientQuestionSchema,\n", "", "legacy question schema import");
  content = replaceExact(path, content, "  answerProfessionalPatientQuestion,\n", "", "legacy question service import");
  content = replaceRegex(
    path,
    content,
    /\n\s*askPatientQuestion: protectedProcedure[\s\S]*?\n\s*\),/g,
    "",
    "legacy question route"
  );
  assertAbsent(path, content, ["askPatientQuestion", "answerProfessionalPatientQuestion", "professionalPatientQuestionSchema"]);
  write(path, content);
}

{
  const path = "server/modules/professionals/schemas.ts";
  let content = read(path);
  content = replaceRegex(
    path,
    content,
    /\nexport const professionalPatientQuestionSchema =[\s\S]*?\nexport const professionalPatientAnswerSchema = z\.object\([\s\S]*?\n\}\);/g,
    "",
    "legacy question schemas"
  );
  content = replaceRegex(
    path,
    content,
    /\nexport type ProfessionalPatientQuestionInput =[\s\S]*?\nexport type ProfessionalPatientAnswer = z\.infer<[\s\S]*?;$/g,
    "\n",
    "legacy question types"
  );
  assertAbsent(path, content, ["professionalPatientQuestionSchema", "professionalPatientAnswerSchema", "ProfessionalPatientQuestionInput", "ProfessionalPatientAnswer"]);
  write(path, content);
}

{
  const path = "server/modules/professionals/service.test.ts";
  let content = read(path);
  for (const line of [
    "  _forTestOnly_setAccessInMap,\n",
    "  answerProfessionalPatientQuestion,\n",
    "  type ProfessionalPatientAccess,\n",
  ]) content = replaceExact(path, content, line, "", `legacy test import ${line.trim()}`);
  content = replaceRegex(
    path,
    content,
    /\n\s*it\("exibe vínculo na aba Perfil quando cópia do lado do paciente está ausente \(backfill assimétrico\)",[\s\S]*?\n\s*\}\);/g,
    "",
    "asymmetric legacy fallback test"
  );
  content = replaceRegex(
    path,
    content,
    /\n\ndescribe\("professional patient AI questions",[\s\S]*?\n\}\);\s*$/g,
    "\n",
    "legacy AI service tests"
  );
  write(path, content);
}

fs.rmSync("server/modules/professionals/service.reconciliation.test.ts");

write(
  "scripts/retire-professional-legacy-preferences.ts",
  `import "dotenv/config";\nimport { eq, inArray } from "drizzle-orm";\nimport { professionalPatientAuthorizations, professionalProfiles } from "../drizzle/professional-schema";\nimport { userPreferences } from "../drizzle/schema";\nimport { getDb } from "../server/db";\nimport {\n  PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,\n  PROFESSIONAL_ACCESSES_PREFERENCE_KEY,\n  PROFESSIONAL_PROFILE_PREFERENCE_KEY,\n  parseLegacyProfessionalAccesses,\n  parseLegacyProfessionalProfile,\n} from "../server/modules/professionals/persistence";\nimport { migrateAllLegacyProfessionalData } from "../server/modules/professionals/persistenceService";\n\nconst legacyKeys = [\n  PROFESSIONAL_PROFILE_PREFERENCE_KEY,\n  PROFESSIONAL_ACCESSES_PREFERENCE_KEY,\n  PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,\n] as const;\n\nasync function verifyCanonicalCoverage(db: any, rows: any[]) {\n  const missingProfiles: number[] = [];\n  const expectedAuthorizationIds = new Set<string>();\n  let invalidPreferences = 0;\n\n  for (const row of rows) {\n    if (row.preferenceKey === PROFESSIONAL_PROFILE_PREFERENCE_KEY) {\n      const parsed = parseLegacyProfessionalProfile(\n        row.userId,\n        row.preferenceValue,\n        new Date(row.updatedAt ?? row.createdAt ?? Date.now())\n      );\n      if (!parsed.value) {\n        invalidPreferences += 1;\n        continue;\n      }\n      const [profile] = await db\n        .select({ userId: professionalProfiles.userId })\n        .from(professionalProfiles)\n        .where(eq(professionalProfiles.userId, row.userId))\n        .limit(1);\n      if (!profile) missingProfiles.push(row.userId);\n      continue;\n    }\n\n    const parsed = parseLegacyProfessionalAccesses(\n      row.userId,\n      row.preferenceKey,\n      row.preferenceValue\n    );\n    if (!parsed.value) {\n      invalidPreferences += 1;\n      continue;\n    }\n    if (parsed.issue) invalidPreferences += 1;\n    for (const access of parsed.value) expectedAuthorizationIds.add(access.id);\n  }\n\n  const ids = [...expectedAuthorizationIds];\n  const canonicalIds = new Set<string>();\n  if (ids.length) {\n    const authorizations = await db\n      .select({ id: professionalPatientAuthorizations.id })\n      .from(professionalPatientAuthorizations)\n      .where(inArray(professionalPatientAuthorizations.id, ids));\n    for (const authorization of authorizations) canonicalIds.add(authorization.id);\n  }\n  const missingAuthorizations = ids.filter(id => !canonicalIds.has(id));\n\n  return { invalidPreferences, missingProfiles, missingAuthorizations };\n}\n\nasync function main() {\n  const apply = process.argv.includes("--apply");\n  const db = await getDb();\n  if (!db) throw new Error("DATABASE_URL indisponível para aposentar a persistência legada profissional.");\n\n  const migration = await migrateAllLegacyProfessionalData();\n  const rows = await db\n    .select()\n    .from(userPreferences)\n    .where(inArray(userPreferences.preferenceKey, [...legacyKeys]));\n  const verification = await verifyCanonicalCoverage(db, rows);\n\n  if (migration.invalidPreferences > 0 || verification.invalidPreferences > 0) {\n    throw new Error("Existem preferências profissionais legadas inválidas; nenhuma exclusão foi executada.");\n  }\n  if (verification.missingProfiles.length || verification.missingAuthorizations.length) {\n    throw new Error(\n      \`A cobertura canônica está incompleta: perfis=\${verification.missingProfiles.length}, autorizações=\${verification.missingAuthorizations.length}.\`\n    );\n  }\n\n  if (apply && rows.length) {\n    await db\n      .delete(userPreferences)\n      .where(inArray(userPreferences.preferenceKey, [...legacyKeys]));\n  }\n\n  const remaining = await db\n    .select({ preferenceKey: userPreferences.preferenceKey })\n    .from(userPreferences)\n    .where(inArray(userPreferences.preferenceKey, [...legacyKeys]));\n  if (apply && remaining.length) {\n    throw new Error("A limpeza das preferências profissionais legadas não foi concluída.");\n  }\n\n  console.log(JSON.stringify({\n    event: apply ? "professional.persistence.legacy_retirement.applied" : "professional.persistence.legacy_retirement.verified",\n    apply,\n    scannedPreferences: migration.scannedPreferences,\n    migratedProfiles: migration.migratedProfiles,\n    migratedAuthorizations: migration.migratedAuthorizations,\n    legacyRowsBeforeCleanup: rows.length,\n    legacyRowsRemaining: remaining.length,\n  }));\n}\n\nvoid main().then(() => process.exit(0)).catch(error => {\n  console.error(JSON.stringify({\n    event: "professional.persistence.legacy_retirement.failed",\n    error: error instanceof Error ? error.message : "UnknownError",\n  }));\n  process.exit(1);\n});\n`
);

write(
  "server/modules/professionals/legacyRetirement.test.ts",
  `import fs from "node:fs";\nimport path from "node:path";\nimport { describe, expect, it } from "vitest";\n\nfunction source(relativePath: string) {\n  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");\n}\n\ndescribe("professional legacy retirement architecture", () => {\n  it("keeps legacy JSON access behind explicit migration commands only", () => {\n    const repository = source("server/repositories/professionalRepository.ts");\n    const service = source("server/modules/professionals/service.ts");\n    const migration = source("scripts/retire-professional-legacy-preferences.ts");\n\n    expect(repository).not.toContain("writeLegacyProfile");\n    expect(repository).not.toContain("writeLegacyAuthorization");\n    expect(repository).not.toContain("await migrateLegacyUser(");\n    expect(repository).not.toContain("await migrateRelatedAuthorizations(");\n    expect(service).not.toContain("userPreferences");\n    expect(service).not.toContain("professional_profile_v1");\n    expect(migration).toContain("migrateAllLegacyProfessionalData");\n    expect(migration).toContain("--apply");\n  });\n\n  it("does not expose the retired page or legacy professional AI endpoint", () => {\n    const layout = source("client/src/components/ProfessionalLayout.tsx");\n    const router = source("server/nutritionRouter.ts");\n    const schemas = source("server/modules/professionals/schemas.ts");\n\n    expect(layout).not.toContain("Experiência legada");\n    expect(router).not.toContain("askPatientQuestion");\n    expect(schemas).not.toContain("professionalPatientQuestionSchema");\n    expect(fs.existsSync(path.join(process.cwd(), "client/src/pages/ProfessionalPage.tsx"))).toBe(false);\n  });\n});\n`
);

{
  const path = "package.json";
  const packageJson = JSON.parse(read(path));
  packageJson.scripts["db:retire-professional-legacy"] = "tsx scripts/retire-professional-legacy-preferences.ts";
  packageJson.scripts["db:retire-professional-legacy:apply"] = "tsx scripts/retire-professional-legacy-preferences.ts --apply";
  write(path, `${JSON.stringify(packageJson, null, 2)}\n`);
}

write(
  "docs/runbooks/professional-legacy-retirement.md",
  `# Aposentadoria da compatibilidade profissional legada\n\n## Objetivo\n\nEncerrar a leitura e a escrita em JSON de perfil e autorizações profissionais sem perder histórico, identificadores ou vínculos já migrados para as tabelas canônicas.\n\n## Pré-condições\n\n- todas as migrations da Área Profissional aplicadas;\n- backup recente do banco;\n- versão anterior disponível para rollback;\n- CI da issue #815 aprovado;\n- nenhuma preferência inválida reportada pelo backfill.\n\n## Rollout\n\n1. Execute \`pnpm db:migrate:professionals\` no ambiente alvo.\n2. Execute \`pnpm db:retire-professional-legacy\`. O comando migra novamente de forma idempotente e verifica cobertura canônica; ele não exclui dados.\n3. Interrompa o rollout se houver preferência inválida, perfil ausente ou autorização ausente. Corrija a origem e repita a verificação.\n4. Execute \`pnpm db:retire-professional-legacy:apply\` para remover somente as três chaves antigas de \`userPreferences\`.\n5. Publique a versão da issue #815, que não possui migração lazy nem dual-write em runtime.\n6. Valide perfil profissional, solicitação/aprovação/revogação, carteira, prontuário, metas, alertas, mensagens, relatórios, IA e configurações.\n7. Monitore erros de autorização, falhas de persistência e tentativas de acesso a \`/professional/legacy\`.\n\n## Rollback\n\n1. Reverta a aplicação para a versão anterior sem restaurar parcialmente tabelas.\n2. As tabelas canônicas permanecem como fonte de verdade e preservam os mesmos identificadores.\n3. Restaure o backup apenas se a verificação canônica ou a validação funcional apontar perda de dados.\n4. Não recrie manualmente JSONs em \`userPreferences\`; execute o backfill idempotente da versão anterior somente quando uma análise de incidente exigir.\n\n## Evidências obrigatórias\n\nRegistre a saída JSON dos dois comandos, o SHA publicado, o resultado das validações funcionais e a decisão de prosseguir ou reverter. Nunca execute o modo \`--apply\` quando a verificação apontar dados inválidos ou cobertura incompleta.\n`
);

{
  const path = "docs/README.md";
  let content = read(path);
  content = replaceExact(
    path,
    content,
    `| \`runbooks/\` | Checklists e evidências operacionais de rollout. |`,
    `| \`runbooks/\` | Checklists e evidências operacionais de rollout. A aposentadoria do legado profissional está em \`runbooks/professional-legacy-retirement.md\`. |`,
    "runbook index"
  );
  write(path, content);
}

for (const path of ["ARCHITECTURE.md", "docs/product-specs/professionals.md", "docs/design-docs/database-persistence.md"]) {
  let content = read(path).trimEnd();
  if (!content.includes("## Aposentadoria do legado profissional")) {
    content += `\n\n## Aposentadoria do legado profissional\n\nA experiência profissional atual é a única interface funcional. O endereço \`/professional/legacy\` existe apenas como redirecionamento de bookmark para \`/professional\` e não carrega componentes, estado ou APIs antigos. Perfil, autorizações e acompanhamento usam exclusivamente as tabelas canônicas em runtime; leitura, migração e remoção das três chaves JSON antigas são permitidas somente pelos comandos operacionais documentados em \`docs/runbooks/professional-legacy-retirement.md\`.\n`;
  }
  write(path, content);
}

console.log("Issue #815 transform applied.");
