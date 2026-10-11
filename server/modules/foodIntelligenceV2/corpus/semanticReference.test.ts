import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { goldenFoodCorpus } from "./data";
import semanticReviewLedger from "./semantic-review-ledger.json";
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
  it("checks source traceability and case identity throughout the corpus", () => {
    // Structural guard only: independent semantic sign-off remains separate.
    expect(goldenFoodCorpus.cases).toHaveLength(75);
    const ids = new Set<string>();
    for (const item of goldenFoodCorpus.cases) {
      expect(ids.has(item.caseId), `duplicate case ID: ${item.caseId}`).toBe(false);
      ids.add(item.caseId);
      expect(item.adrSections.length, `missing ADR link: ${item.caseId}`).toBeGreaterThan(0);
      for (const section of item.adrSections) {
        expect(section, `invalid ADR link: ${item.caseId}`).toMatch(/^§[0-9]+/);
      }
      expect(item.expected.decisions.length, `missing expected decisions: ${item.caseId}`).toBeGreaterThan(0);
      for (const decision of item.expected.decisions) {
        expect(decision.label.trim().length, `missing expected label: ${item.caseId}`).toBeGreaterThan(0);
      }
    }
  });

  it("tracks every case without treating unreviewed labels as independently certified", () => {
    const expectedIds = goldenFoodCorpus.cases.map(item => item.caseId).sort();
    const trackedIds = semanticReviewLedger.cases.map(item => item.caseId).sort();
    expect(trackedIds).toEqual(expectedIds);
    expect(new Set(trackedIds).size).toBe(trackedIds.length);
    expect(semanticReviewLedger.independentReviewRequired).toBe(true);
    const controlledIds = new Set([
      "c-panco-pao-forma",
      "c-wickbold-pao-forma",
      "c-amendoim-rotulo",
    ]);
    for (const review of semanticReviewLedger.cases) {
      expect(["pending-independent-review", "independent-control-tested"]).toContain(review.status);
      if (controlledIds.has(review.caseId)) {
        expect(review.status).toBe("independent-control-tested");
        expect(review.evidence).toBe("semanticReference.test.ts");
      } else {
        expect(review.status).toBe("pending-independent-review");
        expect(review.evidence).toBeNull();
      }
    }
  });

  it("preserves cultivar distinctions and orthographic equivalence", () => {
    const packham = findCase("c-pera-packham");
    const unaccented = findCase("c-pera-sem-acento");
    const williams = findCase("c-pera-williams");
    const fuji = findCase("c-maca-fuji");
    expect(packham.input.text).toBe("1 pêra packham");
    expect(unaccented.input.text).toBe("1 pera packham");
    expect(williams.input.text).toBe("1 pêra williams");
    expect(packham.expected.decisions[0].identity).toMatchObject({ canonicalName: "pêra", variant: "packham" });
    expect(unaccented.expected.decisions[0].identity).toMatchObject({ canonicalName: "pêra", variant: "packham" });
    expect(williams.expected.decisions[0].identity).toMatchObject({ canonicalName: "pêra", variant: "williams" });
    expect(williams.negativeControlOf).toBe(packham.caseId);
    expect(fuji.input.text).toBe("1 maçã fuji");
    expect(fuji.expected.decisions[0].identity).toMatchObject({ canonicalName: "maçã", variant: "fuji" });
    for (const item of [packham, unaccented, williams, fuji]) {
      expect(item.expected.decisions[0].quantity).toMatchObject({ value: 1, unit: "unidade" });
    }
  });

  it("preserves decimal slice quantities across Portuguese surfaces", () => {
    const surfaces: Array<[string, string]> = [
      ["c-mortadela-1-5-virgula", "1,5 fatias de mortadela"],
      ["c-mortadela-1-5-ponto", "1.5 fatias de mortadela"],
      ["c-mortadela-uma-fatia-e-meia", "uma fatia e meia de mortadela"],
    ];
    for (const [id, surface] of surfaces) {
      const item = findCase(id);
      expect(item.input.text).toBe(surface);
      const expected = item.expected.decisions[0];
      expect(expected.identity.canonicalName).toBe("mortadela");
      expect(expected.quantity).toMatchObject({ value: 1.5, unit: "fatia" });
    }
  });

  it("does not confuse package size with consumed amount on image input", () => {
    const beer = findCase("c-cerveja-imagem");
    expect(beer.input.ocrText).toBe("CERVEJA ORIGINAL 355 ml");
    expect(beer.expected.decisions[0].identity).toMatchObject({
      canonicalName: "cerveja", brand: "Original",
    });
    expect(beer.expected.decisions[0].quantity).toMatchObject({ presence: "unspecified", value: null, grams: null, milliliters: null });
    expect(beer.input.text).not.toMatch(/\\b(?:bebi|tomei|consumi)\\b/i);
    const peanut = findCase("c-amendoim-rotulo");
    expect(peanut.input.ocrText).toContain("400 g");
    expect(peanut.expected.decisions[0].quantity.presence).toBe("unspecified");
  });

});
