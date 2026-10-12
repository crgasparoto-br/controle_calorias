import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { goldenFoodCorpus } from "./data";
import semanticReviewLedger from "./semantic-review-ledger.json";
import independentReviewBacklog from "./independent-review-backlog.json";
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


  it("independently rejects four explicitly non-food inputs", () => {
    const controls = [
      ["c-neg-pasta-de-dente", "pasta de dente"],
      ["c-neg-agua-sanitaria", "água sanitária"],
      ["c-neg-cosmetico", "hidratante corporal"],
      ["c-neg-oleo-de-motor", "óleo de motor 5w30"],
    ] as const;
    for (const [caseId, inputText] of controls) {
      const item = findCase(caseId);
      expect(item.input.text).toBe(inputText);
      expect(item.decisionClass).toBe("rejection");
      expect(item.expected.decisions).toHaveLength(1);
      const actual = item.expected.decisions[0];
      expect(actual.nextAction).toBe("reject");
      expect(actual.identity.presence).toBe("forbidden");
      expect(actual.quantity.presence).toBe("forbidden");
      expect(actual.nutrition.requirement).toBe("absent");
      expect(actual.reasonCodes).toContain("non_food");
    }
  });

  it("independently checks Portuguese decimal and verbal slice quantities", () => {
    const controls = [
      ["c-mortadela-1-5-virgula", "1,5 fatias de mortadela"],
      ["c-mortadela-1-5-ponto", "1.5 fatias de mortadela"],
      ["c-mortadela-uma-fatia-e-meia", "uma fatia e meia de mortadela"],
      ["c-mortadela-ordem-invertida", "adicionar mortadela, uma fatia e meia"],
    ] as const;
    for (const [caseId, inputText] of controls) {
      const item = findCase(caseId);
      expect(item.input.text).toBe(inputText);
      expect(item.expected.decisions).toHaveLength(1);
      const actual = item.expected.decisions[0];
      expect(actual.nextAction).toBe("propose");
      expect(actual.identity.canonicalName).toBe("mortadela");
      expect(actual.quantity).toMatchObject({ presence: "expected", value: 1.5, unit: "fatia" });
      expect(actual.quantity.grams).toBeNull();
    }
  });


  it("checks cultivar, accent and singular/plural semantics against literal inputs", () => {
    const reference = [
      ["c-pera-packham", "1 pêra packham", "pêra", "packham", 1, "unidade"],
      ["c-pera-williams", "1 pêra williams", "pêra", "williams", 1, "unidade"],
      ["c-pera-sem-acento", "1 pera packham", "pêra", "packham", 1, "unidade"],
      ["c-maca-fuji", "1 maçã fuji", "maçã", "fuji", 1, "unidade"],
      ["c-ovo-frito", "2 ovos fritos", "ovo", null, 2, "unidade"],
      ["c-ovo-singular", "2 ovo frito", "ovo", null, 2, "unidade"],
      ["c-acento-ausente", "1 pao frances", "pão francês", null, 1, "unidade"],
      ["c-acento-presente", "1 pão francês", "pão francês", null, 1, "unidade"],
    ] as const;
    for (const [caseId, surface, name, variant, value, unit] of reference) {
      const item = findCase(caseId);
      expect(item.input.text).toBe(surface);
      expect(item.expected.decisions).toHaveLength(1);
      const actual = item.expected.decisions[0];
      expect(actual.nextAction).toBe("propose");
      expect(actual.identity).toMatchObject({ canonicalName: name, variant });
      expect(actual.quantity).toMatchObject({ value, unit });
      if (caseId.startsWith("c-ovo-")) expect(actual.identity.preparation).toContain("frito");
    }
  });

  it("keeps zero-sugar soda distinct from unqualified soda", () => {
    const zero = findCase("c-refrigerante-zero");
    const ordinary = findCase("c-refrigerante-comum");
    expect(zero.input.text).toBe("1 copo de refrigerante zero");
    expect(ordinary.input.text).toBe("1 copo de refrigerante");
    for (const item of [zero, ordinary]) {
      const actual = item.expected.decisions[0];
      expect(actual.nextAction).toBe("propose");
      expect(actual.identity.canonicalName).toBe("refrigerante");
      expect(actual.quantity).toMatchObject({ value: 1, unit: "copo" });
    }
    expect(zero.expected.decisions[0].identity.qualifiers).toContain("zero");
    expect(ordinary.expected.decisions[0].identity.qualifiers).not.toContain("zero");
    expect(ordinary.negativeControlOf).toBe(zero.caseId);
  });

  it("AUD-1316-007: clarifies uncertain transcription without unrelated alternatives", () => {
    const item = findCase("c-erro-transcricao");
    expect(adr).toContain("erros de transcrição");
    expect(item.input.transcription).toBe("mordadela");
    expect(item.decisionClass).toBe("clarification");
    const [decision] = item.expected.decisions;
    expect(decision.identity.presence).toBe("forbidden");
    expect(decision.nextAction).toBe("clarify");
    expect(decision.unresolvedFields).toContain("identity");
    expect(decision.alternatives.every(candidate => candidate.name.toLowerCase() === "mortadela")).toBe(true);
  });

  it("keeps the independent evidence backlog exact and fail-closed", () => {
    const pending = semanticReviewLedger.cases
      .filter(item => item.status === "pending-independent-review")
      .map(item => item.caseId).sort();
    const listed = independentReviewBacklog.cases.map(item => item.caseId).sort();
    expect(listed).toEqual(pending);
    expect(new Set(listed).size).toBe(listed.length);
    for (const item of independentReviewBacklog.cases) {
      const corpusCase = findCase(item.caseId);
      expect(item.title).toBe(corpusCase.title);
      expect(item.modality).toBe(corpusCase.modality);
      expect(item.incidentRefs).toEqual(corpusCase.incidentRefs);
      expect(item.adrSections).toEqual(corpusCase.adrSections);
      expect(item.verification).toBe("pending");
      expect(item.independentEvidence).toEqual([]);
      expect(item.decision).toBeNull();
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
      "c-neg-pasta-de-dente",
      "c-neg-agua-sanitaria",
      "c-neg-cosmetico",
      "c-neg-oleo-de-motor",
      "c-mortadela-1-5-virgula",
      "c-mortadela-1-5-ponto",
      "c-mortadela-uma-fatia-e-meia",
      "c-mortadela-ordem-invertida",
      "c-pera-packham",
      "c-pera-williams",
      "c-pera-sem-acento",
      "c-maca-fuji",
      "c-ovo-frito",
      "c-ovo-singular",
      "c-acento-ausente",
      "c-acento-presente",
      "c-refrigerante-zero",
      "c-refrigerante-comum",
    ]);
    for (const review of semanticReviewLedger.cases) {
      expect(["pending-independent-review", "independent-control-tested"]).toContain(review.status);
      if (review.status === "independent-control-tested") {
        expect(typeof review.evidence).toBe("string");
        expect(review.evidence?.trim().length).toBeGreaterThan(0);
        // These guards cover only narrowly verified literal semantic obligations.
        if (controlledIds.has(review.caseId)) {
          expect(review.evidence).toBe("semanticReference.test.ts");
        } else {
          // Future reviews must supply a distinct source-backed artifact, not
          // reuse the generic structural coverage test as semantic evidence.
          expect(review.evidence).not.toBe("semanticCoverage.test.ts");
          expect(review.evidence).not.toBe("semanticReference.test.ts");
          const evidencePath = review.evidence!;
          expect(evidencePath).toMatch(/^server\/modules\/foodIntelligenceV2\/corpus\/reviews\/[a-z0-9-]+\.json$/);
          const root = resolve(process.cwd());
          const resolved = resolve(root, evidencePath);
          expect(isAbsolute(evidencePath)).toBe(false);
          expect(relative(root, resolved).startsWith("..")).toBe(false);
          expect(existsSync(resolved), "missing independent review artifact: " + evidencePath).toBe(true);
          const artifact: unknown = JSON.parse(readFileSync(resolved, "utf8"));
          expect(artifact).toMatchObject({ caseId: review.caseId, verdict: "approved" });
          const record = artifact as { reviewer?: unknown; independentSources?: unknown; rationale?: unknown; dimensions?: unknown };
          expect(typeof record.reviewer).toBe("string");
          expect((record.reviewer as string).trim().length).toBeGreaterThan(0);
          expect(Array.isArray(record.independentSources)).toBe(true);
          expect((record.independentSources as unknown[]).length).toBeGreaterThan(0);
          for (const source of record.independentSources as unknown[]) {
            expect(source).toMatchObject({ id: expect.any(String), locator: expect.any(String) });
            const item = source as { id: string; locator: string };
            expect(item.id.trim().length).toBeGreaterThan(0);
            expect(item.locator.trim().length).toBeGreaterThan(0);
          }
          expect(typeof record.rationale).toBe("string");
          expect((record.rationale as string).trim().length).toBeGreaterThan(0);
          expect(record.dimensions).toEqual(expect.arrayContaining(["identity", "quantity", "action", "nutritionProvenance"]));
        }
      } else {
        expect(review.evidence).toBeNull();
      }
    }
    for (const id of controlledIds) {
      expect(semanticReviewLedger.cases.find(item => item.caseId === id)?.status).toBe("independent-control-tested");
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
    expect(beer.input.text).not.toMatch(/\b(?:bebi|tomei|consumi)\b/i);
    const peanut = findCase("c-amendoim-rotulo");
    expect(peanut.input.ocrText).toContain("400 g");
    expect(peanut.expected.decisions[0].quantity.presence).toBe("unspecified");
  });


  it("guards the incident sources and branco/Panco uncertainty", () => {
    expect(findCase("c-cerveja-imagem").incidentRefs).toEqual(["#987", "#1210"]);
    expect(findCase("c-melao-cultivar").incidentRefs).toEqual(["#1051"]);
    for (const id of ["c-banco-ambiguo-pao", "c-multiplos-um-ambiguo"]) {
      const item = findCase(id);
      expect(item.input.text).toContain("pão banco");
      const d = item.expected.decisions.at(-1)!;
      expect(d.nextAction).toBe("clarify");
      expect(d.alternatives).toMatchObject([
        { name: "pão", variant: "branco" },
        { name: "pão de forma", brand: "Panco" },
      ]);
      expect(d.alternatives.every(a => !["banana", "bacon"].includes(a.name))).toBe(true);
    }
    const batch = findCase("c-multiplos-um-ambiguo");
    expect(batch.expected.decisions.slice(0, 2).map(d => d.identity.canonicalName)).toEqual(["arroz", "feijão"]);
  });

  it("tests explicit precedence on the learned alias and rejects unsupported guesses", () => {
    const actual = findCase("c-aprendizado-precedencia-explicita");
    expect(actual.input.text).toBe("café da firma com açúcar");
    expect(actual.expected.decisions[0].identity.qualifiers).toContain("com açúcar");
    const steps = goldenFoodCorpus.learningScenarios.find(s => s.scenarioId === "s-aprendizado-cafe-firma")!.steps;
    expect(steps.find(s => s.caseId === actual.caseId)!.requiredKnowledgeReads).toContain("owner-a:alias:cafe-da-firma");
    for (const id of ["c-aprendizado-alias-antes", "c-aprendizado-isolamento-outro-usuario",
      "c-aprendizado-revogacao", "c-aprendizado-controle-negativo-alias"]) {
      const d = findCase(id).expected.decisions[0];
      expect(d.status).toBe("unknown");
      expect(d.nextAction).toBe("clarify");
      expect(d.alternatives).toEqual([]);
      expect(d.ambiguity.minAlternatives).toBe(0);
      expect(d.ambiguity.mustPreserveAlternatives).toBe(false);
    }
  });

});
