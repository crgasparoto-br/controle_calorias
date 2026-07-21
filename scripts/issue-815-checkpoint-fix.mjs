import fs from "node:fs";

{
  const path = "server/modules/professionals/service.ts";
  let content = fs.readFileSync(path, "utf8");

  const legacyPersist =
    "  const persistedAccess = await persistAccessForBothSides(access);";
  const canonicalPersist = `  const persistedAccess = rememberCanonicalAuthorization(\n    await professionalRepository.upsertAuthorization({\n      id: access.id,\n      professionalUserId: access.professionalUserId,\n      patientUserId: access.patientUserId,\n      status: access.status,\n      reason: access.reason,\n      requestedAt: new Date(access.requestedAt),\n      approvedAt: access.approvedAt ? new Date(access.approvedAt) : null,\n      rejectedAt: access.rejectedAt ? new Date(access.rejectedAt) : null,\n      revokedAt: access.revokedAt ? new Date(access.revokedAt) : null,\n      respondedAt: access.respondedAt ? new Date(access.respondedAt) : null,\n      responseOrigin: access.responseOrigin,\n      responseDecision: access.responseDecision,\n      authorizationMessageStatus: access.authorizationMessageStatus,\n      authorizationMessageSentAt: access.authorizationMessageSentAt\n        ? new Date(access.authorizationMessageSentAt)\n        : null,\n      authorizationMessageError: access.authorizationMessageError,\n      sourceUpdatedAt: new Date(),\n    })\n  );`;

  if (content.includes(legacyPersist)) {
    content = content.replace(legacyPersist, canonicalPersist);
  } else if (!content.includes("await professionalRepository.upsertAuthorization({")) {
    throw new Error("Could not locate the professional access persistence block.");
  }

  const legacyProfileMap = `  const professionalMap = new Map(\n    professionalProfiles\n      .filter((profile): profile is ProfessionalProfile => Boolean(profile))\n      .map(profile => [profile.userId, profile])\n  );`;
  const canonicalProfileMap = `  const professionalMap = new Map<number, ProfessionalProfile>();\n  for (const profile of professionalProfiles) {\n    if (profile) professionalMap.set(profile.userId, profile);\n  }`;

  if (content.includes(legacyProfileMap)) {
    content = content.replace(legacyProfileMap, canonicalProfileMap);
  } else if (
    !content.includes("const professionalMap = new Map<number, ProfessionalProfile>();")
  ) {
    throw new Error("Could not locate the professional profile map block.");
  }

  fs.writeFileSync(path, content);
}

{
  const path = "server/modules/professionals/schemas.test.ts";
  let content = fs.readFileSync(path, "utf8");
  content = content.replace("  professionalPatientQuestionSchema,\n", "");
  content = content.replace(
    /\n\s*it\("blocks the deprecated professional AI question contract",[\s\S]*?\n\s*\}\);(?=\n\s*it\("limits the configurable portfolio report period)/,
    "\n"
  );

  if (content.includes("professionalPatientQuestionSchema")) {
    throw new Error("Retired professional question schema test is still present.");
  }

  fs.writeFileSync(path, content);
}

console.log("Issue #815 checkpoint fixes applied.");
