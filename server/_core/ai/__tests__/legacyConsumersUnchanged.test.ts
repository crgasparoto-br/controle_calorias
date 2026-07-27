import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #921 explicitly forbids silently migrating any existing consumer to the
 * new capability resolver/executor in this subissue. Every other test in
 * this suite exercises the new modules in isolation, which cannot detect a
 * consumer accidentally being wired to them. This test ties that acceptance
 * criterion directly to the source of the legacy entry points instead of
 * relying on "the diff didn't touch them" as indirect evidence.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const LEGACY_CONSUMER_FILES = [
  "server/_core/aiProvider.ts",
  "server/mealAiExtraction.ts",
  "server/catalogSemanticSearch.ts",
  "server/modules/whatsapp/aiQuestionAssistant.ts",
];

const NEW_MODULE_IMPORT_PATTERN =
  /from\s+["'](?:\.{1,2}\/)*_core\/ai\/(configResolver|policyExecutor|capabilities|supportMatrix)["']/;

describe("legacy AI consumers remain unmigrated (#921 scope)", () => {
  for (const relativePath of LEGACY_CONSUMER_FILES) {
    it(`${relativePath} does not import the new capability resolver/executor`, () => {
      const source = readFileSync(join(REPO_ROOT, relativePath), "utf8");
      expect(source).not.toMatch(NEW_MODULE_IMPORT_PATTERN);
    });
  }

  it("server/_core/aiProvider.ts still resolves the provider from ENV.aiVisionProvider only", () => {
    const source = readFileSync(join(REPO_ROOT, "server/_core/aiProvider.ts"), "utf8");
    expect(source).toContain("ENV.aiVisionProvider");
    expect(source).not.toContain("resolveCapabilityConfig");
    expect(source).not.toContain("executeWithPolicy");
  });
});
