import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const STILL_LEGACY_CONSUMER_FILES = [
  "server/_core/aiProvider.ts",
];

const CAPABILITY_IMPORT_PATTERN =
  /from\s+["'](?:\.{1,2}\/)*_core\/ai\/(configResolver|capabilityExecutor|capabilities|supportMatrix)["']/;

describe("AI consumer migration boundaries (#921/#922)", () => {
  for (const relativePath of STILL_LEGACY_CONSUMER_FILES) {
    it(`${relativePath} remains outside the #922 consumer migration`, () => {
      const source = readFileSync(join(REPO_ROOT, relativePath), "utf8");
      expect(source).not.toMatch(CAPABILITY_IMPORT_PATTERN);
    });
  }

  it.each([
    "server/mealAiExtraction.ts",
    "server/modules/whatsapp/intentInterpreter.ts",
    "server/modules/whatsapp/aiQuestionAssistantCore.ts",
    "server/catalogSemanticSearch.ts",
  ])("%s uses the capability resolver and canonical executor", relativePath => {
    const source = readFileSync(join(REPO_ROOT, relativePath), "utf8");
    expect(source).toContain("resolveCapabilityConfig");
    expect(source).toContain("executeResolvedCapability");
    expect(source).not.toContain("getAiProvider(");
    expect(source).not.toContain("executeWithPolicy(");
  });

  it("keeps the QUESTION wrapper delegated to the capability-backed core", () => {
    const source = readFileSync(
      join(REPO_ROOT, "server/modules/whatsapp/aiQuestionAssistant.ts"),
      "utf8",
    );
    expect(source).toContain('from "./aiQuestionAssistantCore"');
    expect(source).toContain("executeWhatsappAiQuestionIntentCore");
    expect(source).not.toContain("getAiProvider(");
    expect(source).not.toContain("executeWithPolicy(");
  });

  it("keeps provider/model binding centralized in capabilityExecutor", () => {
    const source = readFileSync(join(REPO_ROOT, "server/_core/ai/capabilityExecutor.ts"), "utf8");
    expect(source).toContain("getAiProviderById");
    expect(source).toContain("target.model");
  });
});
