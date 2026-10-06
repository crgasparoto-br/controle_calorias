import { describe, expect, it } from "vitest";
import { goldenFoodCorpus, goldenCorpusSchema } from "./index";
import {
  CANONICAL_ADR_SHA256,
  CANONICAL_REFERENCE_SOURCE,
  declaredReferenceSections,
  missingReferenceSections,
  readCanonicalReference,
} from "./referenceSource";

/**
 * A equivalência de superfície de §4.1.8 só é prova se a **referência
 * independente** existir de fato na fonte canônica. Estes testes confrontam as
 * declarações do corpus com os bytes da ADR: seção inexistente reprova e a
 * versão da fonte é fixada por hash, de modo que a referência nunca seja
 * herdada silenciosamente.
 */
describe("referência independente de §4.1.8", () => {
  const reference = readCanonicalReference();

  it("fixa a versão da ADR canônica por hash", () => {
    expect(reference.hash).toBe(CANONICAL_ADR_SHA256);
  });

  it("declara equivalência apenas pela fonte canônica", () => {
    const declared = declaredReferenceSections(goldenFoodCorpus);
    expect(declared.length).toBeGreaterThan(0);
    for (const item of declared) {
      expect(item.declaredBy).toBe(CANONICAL_REFERENCE_SOURCE);
      expect(item.section).toMatch(/^\d+(\.\d+)*$/);
    }
  });

  it("aponta apenas seções que existem na ADR", () => {
    expect(reference.sections.length).toBeGreaterThan(50);
    expect(missingReferenceSections(goldenFoodCorpus, reference)).toStrictEqual(
      []
    );
  });

  it("reprova seção inventada, mesmo com a fonte governada declarada", () => {
    const member = goldenFoodCorpus.cases.find(
      entry => entry.equivalenceReference !== null
    )!;
    const forged = goldenCorpusSchema.parse({
      ...goldenFoodCorpus,
      cases: goldenFoodCorpus.cases.map(entry =>
        entry.caseId === member.caseId
          ? {
              ...entry,
              equivalenceReference: {
                declaredBy: CANONICAL_REFERENCE_SOURCE,
                adrSection: "§999",
                note: "declarado pelo próprio corpus",
              },
            }
          : entry
      ),
    });
    expect(missingReferenceSections(forged, reference)).toStrictEqual([
      { ownerId: member.caseId, section: "999" },
    ]);
  });

  it("reprova fonte não canônica antes de chegar à verificação", () => {
    expect(() =>
      goldenCorpusSchema.parse({
        ...goldenFoodCorpus,
        learningScenarios: goldenFoodCorpus.learningScenarios.map(scenario => ({
          ...scenario,
          reference: {
            ...scenario.reference,
            declaredBy: "probe",
          },
        })),
      })
    ).toThrow();
  });
});
