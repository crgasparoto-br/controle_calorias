import { describe, expect, it } from "vitest";
import { goldenFoodCorpus } from "./data";

// Brazilian Ministry of Health: plain milk is in natura/minimally processed.
// https://linhasdecuidado.saude.gov.br/portal/obesidade-no-adulto/sou-paciente/processamento-alimentos-profissional/
describe("source-backed plain-milk NOVA classification", () => {
  it("does not classify plain or UHT milk as processed", () => {
    const ids = [
      "c-leite-uht-integral",
      "c-qualificador-antes-marca",
      "c-qualificador-depois-marca",
      "c-leite-generico",
      "c-leite-uht-generico",
      "c-leite-integral",
    ] as const;
    for (const id of ids) {
      const entry = goldenFoodCorpus.cases.find(x => x.caseId === id);
      expect(entry, id).toBeDefined();
      const decision = entry!.expected.decisions[0];
      expect(decision.identity.canonicalName).toBe("leite");
      expect(decision.classification).toMatchObject({
        measured: true,
        processingLevel: "natural_or_minimally_processed",
        isUltraProcessed: false,
      });
    }
  });
});
