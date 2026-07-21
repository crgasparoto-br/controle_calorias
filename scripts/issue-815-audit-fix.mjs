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

function replaceBetween(path, content, startMarker, endMarker, replacement, label) {
  const start = content.indexOf(startMarker);
  const endStart = content.indexOf(endMarker, start);
  if (start < 0 || endStart < 0) {
    throw new Error(`${path}: could not locate ${label}`);
  }
  return `${content.slice(0, start)}${replacement}${content.slice(endStart + endMarker.length)}`;
}

{
  const path = "server/repositories/professionalRepository.ts";
  let content = read(path);
  content = replaceExact(
    path,
    content,
    "  migrateLegacyUser(userId: number): Promise<ProfessionalLegacyMigrationResult>;\n",
    "",
    "per-user legacy repository contract"
  );
  content = content.replace(
    /\n  async function migrateLegacyUser\(userId: number\) \{[\s\S]*?\n  \}\n  async function getProfile/,
    "\n  async function getProfile"
  );
  if (content.includes("async function migrateLegacyUser")) {
    throw new Error(`${path}: per-user legacy migration implementation remains`);
  }
  content = replaceExact(
    path,
    content,
    "    migrateLegacyUser,\n",
    "",
    "per-user legacy repository export"
  );
  write(path, content);
}

{
  const path = "server/modules/professionals/persistenceService.ts";
  let content = read(path);
  content = content.replace(
    /\nexport function migrateLegacyProfessionalDataForUser\(userId: number\) \{\n  return professionalRepository\.migrateLegacyUser\(userId\);\n\}\n/,
    "\n"
  );
  if (content.includes("migrateLegacyProfessionalDataForUser")) {
    throw new Error(`${path}: per-user legacy migration facade remains`);
  }
  write(path, content);
}

{
  const path = "scripts/test-professional-persistence-tidb.ts";
  let content = read(path);
  content = replaceExact(
    path,
    content,
    `import assert from "node:assert/strict";\n`,
    `import assert from "node:assert/strict";\nimport { execFileSync } from "node:child_process";\n`,
    "child process import"
  );

  const helperMarker = `\nasync function main() {`;
  const helper = `\nfunction runLegacyRetirement(apply = false) {\n  const output = execFileSync(\n    "pnpm",\n    [\n      "exec",\n      "tsx",\n      "scripts/retire-professional-legacy-preferences.ts",\n      ...(apply ? ["--apply"] : []),\n    ],\n    {\n      cwd: process.cwd(),\n      env: { ...process.env, DATABASE_URL: databaseUrl },\n      encoding: "utf8",\n    }\n  );\n  const jsonLine = output.trim().split("\\n").at(-1);\n  assert.ok(jsonLine, "legacy retirement command must emit a JSON result");\n  return JSON.parse(jsonLine) as {\n    apply: boolean;\n    legacyRowsBeforeCleanup: number;\n    legacyRowsRemaining: number;\n  };\n}\n\nasync function main() {`;
  content = replaceExact(
    path,
    content,
    helperMarker,
    helper,
    "retirement command helper insertion"
  );

  const startMarker = `    const professionalRead =\n      await repository.listAuthorizationsByProfessional(8061);`;
  const endMarker = `    assert.equal(\n      warnings.some(item => item.error.includes("sensitive-invalid-json")),\n      false,\n      "warnings must not contain raw preference content"\n    );`;
  const replacement = `    const professionalReadBeforeBackfill =\n      await repository.listAuthorizationsByProfessional(8061);\n    assert.equal(\n      professionalReadBeforeBackfill.some(item => item.id === patientOnly.id),\n      false,\n      "runtime reads must not lazily consume professional legacy preferences"\n    );\n    const patientReadBeforeBackfill =\n      await repository.listAuthorizationsByPatient(8064);\n    assert.equal(\n      patientReadBeforeBackfill.some(item => item.id === professionalOnly.id),\n      false,\n      "runtime reads must not lazily consume patient legacy preferences"\n    );\n\n    const firstBackfill = await repository.migrateAllLegacyData();\n    const professionalRead =\n      await repository.listAuthorizationsByProfessional(8061);\n    assert.equal(\n      professionalRead.some(item => item.id === patientOnly.id),\n      true,\n      "explicit backfill must make patient-side-only access visible to the professional"\n    );\n    const patientRead = await repository.listAuthorizationsByPatient(8064);\n    assert.equal(\n      patientRead.some(item => item.id === professionalOnly.id),\n      true,\n      "explicit backfill must make professional-side-only access visible to the patient"\n    );\n    const [rowsAfterFirst] = await connection.query<mysql.RowDataPacket[]>(\n      "SELECT COUNT(*) AS total FROM \\`professionalPatientAuthorizations\\` WHERE \\`id\\` = ?",\n      [untouched.id]\n    );\n    assert.equal(Number(rowsAfterFirst[0]?.total), 1);\n    const secondBackfill = await repository.migrateAllLegacyData();\n    const [rowsAfterSecond] = await connection.query<mysql.RowDataPacket[]>(\n      "SELECT COUNT(*) AS total FROM \\`professionalPatientAuthorizations\\` WHERE \\`id\\` = ?",\n      [untouched.id]\n    );\n    assert.equal(\n      Number(rowsAfterSecond[0]?.total),\n      1,\n      "repeated backfill must not duplicate authorization"\n    );\n    assert.equal(\n      secondBackfill.migratedAuthorizations,\n      0,\n      "second backfill must not rewrite canonical authorizations"\n    );\n    assert.equal(firstBackfill.invalidPreferences >= 1, true);\n    assert.equal(\n      warnings.some(item => item.error.includes("sensitive-invalid-json")),\n      false,\n      "warnings must not contain raw preference content"\n    );\n\n    await connection.query(\n      "DELETE FROM \\`userPreferences\\` WHERE \\`userId\\` = ? AND \\`preferenceKey\\` = ?",\n      [8067, "professional_profile_v1"]\n    );\n    const retirementDryRun = runLegacyRetirement();\n    assert.equal(retirementDryRun.apply, false);\n    assert.equal(retirementDryRun.legacyRowsBeforeCleanup > 0, true);\n    assert.equal(\n      retirementDryRun.legacyRowsRemaining,\n      retirementDryRun.legacyRowsBeforeCleanup,\n      "verification mode must not delete legacy rows"\n    );\n    const retirementApply = runLegacyRetirement(true);\n    assert.equal(retirementApply.apply, true);\n    assert.equal(retirementApply.legacyRowsRemaining, 0);\n    const [legacyRowsAfterRetirement] =\n      await connection.query<mysql.RowDataPacket[]>(\n        "SELECT COUNT(*) AS total FROM \\`userPreferences\\` WHERE \\`preferenceKey\\` IN (?, ?, ?)",\n        [\n          "professional_profile_v1",\n          "professional_accesses_v1",\n          "patient_professional_access_requests_v1",\n        ]\n      );\n    assert.equal(\n      Number(legacyRowsAfterRetirement[0]?.total),\n      0,\n      "apply mode must remove only fully covered professional legacy preferences"\n    );`;
  content = replaceBetween(
    path,
    content,
    startMarker,
    endMarker,
    replacement,
    "legacy read and backfill integration block"
  );

  content = replaceExact(
    path,
    content,
    "    await repository.migrateLegacyUser(8071);",
    "    await repository.migrateAllLegacyData();",
    "stale legacy migration invocation"
  );
  write(path, content);
}

{
  const path = "server/modules/professionals/legacyRetirement.test.ts";
  let content = read(path);
  content = replaceExact(
    path,
    content,
    `    const service = source("server/modules/professionals/service.ts");\n`,
    `    const service = source("server/modules/professionals/service.ts");\n    const persistenceService = source(\n      "server/modules/professionals/persistenceService.ts"\n    );\n`,
    "persistence service static test source"
  );
  content = replaceExact(
    path,
    content,
    `    expect(repository).not.toContain("await migrateRelatedAuthorizations(");\n`,
    `    expect(repository).not.toContain("await migrateRelatedAuthorizations(");\n    expect(repository).not.toContain("migrateLegacyUser");\n    expect(persistenceService).not.toContain(\n      "migrateLegacyProfessionalDataForUser"\n    );\n`,
    "per-user migration architecture assertions"
  );
  write(path, content);
}

{
  const path = "docs/runbooks/professional-legacy-retirement.md";
  let content = read(path);
  const before = `1. Execute \`pnpm db:migrate:professionals\` no ambiente alvo.\n2. Execute \`pnpm db:retire-professional-legacy\`. O comando migra novamente de forma idempotente e verifica cobertura canônica; ele não exclui dados.\n3. Interrompa o rollout se houver preferência inválida, perfil ausente ou autorização ausente. Corrija a origem e repita a verificação.\n4. Execute \`pnpm db:retire-professional-legacy:apply\` para remover somente as três chaves antigas de \`userPreferences\`.\n5. Publique a versão da issue #815, que não possui migração lazy nem dual-write em runtime.\n6. Valide perfil profissional, solicitação/aprovação/revogação, carteira, prontuário, metas, alertas, mensagens, relatórios, IA e configurações.\n7. Monitore erros de autorização, falhas de persistência e tentativas de acesso a \`/professional/legacy\`.`;
  const after = `1. Execute \`pnpm db:migrate:professionals\` no ambiente alvo.\n2. Execute \`pnpm db:retire-professional-legacy\`. O comando migra novamente de forma idempotente, compara versão, identidade e estado dos registros canônicos e não exclui dados.\n3. Interrompa o rollout se houver preferência inválida ou cobertura canônica ausente, desatualizada ou incompatível. Corrija a origem e repita a verificação.\n4. Publique a versão da issue #815, que não possui migração lazy nem dual-write em runtime. Não execute ainda o modo \`--apply\`.\n5. Valide perfil profissional, solicitação/aprovação/revogação, carteira, prontuário, metas, alertas, mensagens, relatórios, IA e configurações.\n6. Execute \`pnpm db:retire-professional-legacy:apply\` somente após a versão canônica estar saudável em produção. Isso evita que instâncias antigas recriem os JSONs durante o rollout.\n7. Execute novamente \`pnpm db:retire-professional-legacy:apply\` após encerrar todas as instâncias da versão anterior e confirme \`legacyRowsRemaining: 0\`.\n8. Monitore erros de autorização, falhas de persistência e tentativas de acesso a \`/professional/legacy\`.`;
  content = replaceExact(path, content, before, after, "rollout sequence");
  write(path, content);
}

console.log("Issue #815 audit corrections applied.");
