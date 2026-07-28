import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI domain response boundary", () => {
  it.each([
    "server/mealAiExtraction.ts",
    "server/modules/whatsapp/intentInterpreter.ts",
  ])("keeps SDK raw responses out of %s", file => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("createDomainTextResponse");
    expect(source).not.toMatch(/\b(?:response|usage)\.raw\b/);
    expect(source).not.toContain("createTextResponse(");
  });
});
