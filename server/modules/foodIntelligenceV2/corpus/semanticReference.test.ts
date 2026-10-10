import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { goldenFoodCorpus } from "./data";
import { CANONICAL_ADR_PATH, readCanonicalReference } from "./referenceSource";

/**
 * Cross-check independently curated domain obligations against both the ADR
 * and the expected decisions. This is deliberately distinct from testing a
 * resolver against expectations supplied by that same corpus.
 *
 * Scope: three material historical controls. Other cases still require
 * independent semantic review; this is not a certification of all 75 labels.
 */
describe("independent semantic reference controls", () => {
  const reference = readCanonicalReference();
  const adr = readFileSync(reference.path, "utf8");
  const findCase = (caseId: string) => {
    const entry = goldenFoodCorpus.cases.find(item => item.caseId === caseId);
    expect(entry, `missing reference case: ${caseId}`).toBeDefined();
    return entry!;
  };

  it("anchors material brand and quantity rules in the canonical ADR", () => {
    expect(CANONICAL_ADR_PATH).toBe("docs/design-docs/adr-food-intelligence-resolver-v2.md");
    expect(adr).toContain("mesmos atributos materiais, quantidades e unidades");
    expect(adr).toContain("marca;");
    expect(adr).toContain("Panco Premium 100% Integral");
    expect(reference.sections).toContain("4.1.8");
  });

  it("rejects accidental convergence between Panco and Wickbold labels", () => {
    const panco = findCase("c-panco-pao-forma");
    const wickbold = findCase("c-wickbold-pao-forma");
    const first = panco.expected.decisions[0];
    const second = wickbold.expected.decisions[0];
    expect(panco.input.text).toContain("Panco");
    expect(wickbold.input.text).toContain("Wickbold");
    expect(first.identity.canonicalName).toBe("pão de forma");
    expect(second.identity.canonicalName).toBe("pão de forma");
    expect(first.identity.brand).toBe("Panco");
    expect(second.identity.brand).toBe("Wickbold");
    expect(first.identity.brand).not.toBe(second.identity.brand);
    expect(first.quantity).toMatchObject({ value: 2, unit: "fatia" });
    expect(second.quantity).toMatchObject({ value: 2, unit: "fatia" });
    expect(wickbold.negativeControlOf).toBe(panco.caseId);
  });

  it("keeps label OCR evidence separate from the food item and serving", () => {
    const peanut = findCase("c-amendoim-rotulo");
    const [expected] = peanut.expected.decisions;
    expect(adr).toContain("amendoim torrado sem sal");
    expect(peanut.input.ocrText).toContain("AMENDOIM TORRADO SALGADO");
    expect(peanut.expected.decisions).toHaveLength(1);
    expect(expected.identity).toMatchObject({
      canonicalName: "amendoim",
      preparation: ["torrado"],
      qualifiers: ["salgado"],
    });
    expect(expected.quantity.presence).toBe("unspecified");
    expect(expected.nutrition.allowedOrigins).toContain("nutrition_label");
  });
});
