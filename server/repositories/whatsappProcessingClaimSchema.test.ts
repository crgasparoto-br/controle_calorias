import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("WhatsApp processing claim schema", () => {
  it("mantém schema, migração, journal e snapshot derivado alinhados", () => {
    const schema = read("drizzle/whatsapp-processing-schema.ts");
    const migration = read("drizzle/0050_whatsapp_processing_owner_claim.sql");
    const journal = read("drizzle/meta/_journal.json");
    const config = read("drizzle.config.ts");

    expect(schema).toContain('mysqlTable("whatsappMessageProcessingClaims"');
    expect(schema).toContain('name: "waProcessingClaim_messageId_fk"');
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `whatsappMessageProcessingClaims`");
    expect(migration).toContain("CONSTRAINT `waProcessingClaim_messageId_fk`");
    expect(journal).toContain('"tag": "0050_whatsapp_processing_owner_claim"');
    expect(config).toContain('"./drizzle/whatsapp-processing-schema.ts"');
    expect(config).toContain('"./drizzle/meta/0050_snapshot.json"');
    expect(config).toContain('waProcessingClaim_messageId_fk');
  });

  it("não ultrapassa o limite de 64 caracteres dos identificadores MySQL/TiDB", () => {
    const migration = read("drizzle/0050_whatsapp_processing_owner_claim.sql");
    const identifiers = Array.from(
      migration.matchAll(/(?:CONSTRAINT|INDEX)\s+`([^`]+)`/g),
      match => match[1],
    );

    expect(identifiers.length).toBeGreaterThan(0);
    for (const identifier of identifiers) {
      expect(identifier.length, identifier).toBeLessThanOrEqual(64);
    }
  });
});
