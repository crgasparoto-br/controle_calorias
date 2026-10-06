import { describe, expect, it } from "vitest";
import { goldenFoodCorpus } from "./data";
import { runCorpus, runGoldenFoodCorpus } from "./harness";
import { createReferenceResolver } from "./selfTestResolvers";
import { renderCorpusReportMarkdown } from "./report";

const reference = () => createReferenceResolver(goldenFoodCorpus);

describe("harness do Golden Food Corpus", () => {
  it("aprova o corpus quando o resolvedor corresponde à referência independente", async () => {
    const report = await runGoldenFoodCorpus(reference());
    expect(report.integrity.status).toBe("valid");
    expect(report.failures).toStrictEqual([]);
    expect(report.overall.matchRate).toBe(1);
    expect(report.gate.status).toBe("passed");
    expect(report.gate.blockReasons).toStrictEqual([]);
  });

  it("entrega cada caso ao resolvedor sob teste (§18)", async () => {
    const report = await runGoldenFoodCorpus(reference());
    expect(report.resolveCalls).toBe(report.caseCount);
    expect(report.resolveCalls).toBe(goldenFoodCorpus.cases.length);
    expect(report.resolver.id).toBe("self-test:reference-oracle");
  });

  it("produz relatório por modalidade, classe, partição e classe de §9.3", async () => {
    const report = await runGoldenFoodCorpus(reference());
    expect(report.byModality.map(item => item.segment).sort()).toStrictEqual([
      "audio_transcript",
      "image",
      "multimodal",
      "text",
    ]);
    expect(
      report.byDecisionClass.map(item => item.segment).sort()
    ).toStrictEqual(["clarification", "deferred", "rejection", "resolvable"]);
    expect(report.bySplit.map(item => item.segment).sort()).toStrictEqual([
      "acquisition",
      "calibration",
      "holdout",
    ]);
    expect(report.byNonRecurrenceClass).toHaveLength(12);
    for (const segment of [
      ...report.byModality,
      ...report.byDecisionClass,
      ...report.bySplit,
      ...report.byNonRecurrenceClass,
    ]) {
      expect(segment.cases).toBeGreaterThan(0);
    }
  });

  it("calcula a meta de §1.1 sobre todos os casos resolvíveis rotulados", async () => {
    const report = await runGoldenFoodCorpus(reference());
    const expectedResolvable = goldenFoodCorpus.cases.filter(
      entry => entry.decisionClass === "resolvable"
    ).length;
    expect(report.overall.resolvableLabeled).toBe(expectedResolvable);
    expect(report.overall.sampleStatus).toBe("present");
    expect(report.overall.matchRate).toBe(1);
  });

  it("verifica equivalência de superfície contra a referência (§17)", async () => {
    const report = await runGoldenFoodCorpus(reference());
    expect(report.metamorphic.length).toBeGreaterThanOrEqual(10);
    for (const group of report.metamorphic) {
      expect(group.memberCaseIds.length).toBeGreaterThanOrEqual(2);
      expect(group.allMatchReference).toBe(true);
      expect(group.converged).toBe(true);
      expect(group.wrongConvergence).toBe(false);
    }
  });

  it("mantém controles negativos discriminantes", async () => {
    const report = await runGoldenFoodCorpus(reference());
    expect(report.negativeControls.length).toBeGreaterThanOrEqual(6);
    for (const control of report.negativeControls) {
      expect(control.convergedWithTarget).toBe(false);
    }
  });

  it("mantém consistência de macros entre entradas equivalentes", async () => {
    const report = await runGoldenFoodCorpus(reference());
    for (const item of report.macroConsistency) {
      expect(item.consistent).toBe(true);
      expect(item.divergences).toStrictEqual([]);
    }
  });

  it("é reproduzível: duas execuções produzem o mesmo relatório", async () => {
    const first = await runGoldenFoodCorpus(reference());
    const second = await runGoldenFoodCorpus(reference());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("registra as revisões de código, conhecimento, léxico, modelo e política", async () => {
    const report = await runGoldenFoodCorpus(reference(), {
      revisions: {
        code: "sha:abc",
        knowledge: "kn-1",
        lexicon: "lex-1",
        model: "model-1",
        policy: "pol-1",
        resolver: "v2.0.0",
      },
    });
    expect(report.revisions).toStrictEqual({
      code: "sha:abc",
      knowledge: "kn-1",
      lexicon: "lex-1",
      model: "model-1",
      policy: "pol-1",
      resolver: "v2.0.0",
    });
    expect(report.corpusVersion).toBe(goldenFoodCorpus.corpusVersion);
  });

  it("renderiza relatório com seções por modalidade e classe", async () => {
    const report = await runGoldenFoodCorpus(reference());
    const markdown = renderCorpusReportMarkdown(report);
    expect(markdown).toContain("Por modalidade");
    expect(markdown).toContain("Por classe de decisão");
    expect(markdown).toContain("Por classe de não-recorrência");
    expect(markdown).toContain("Equivalência de superfície");
    expect(markdown).toContain("Consistência de macros");
  });

  it("não conta como acerto a abstenção do resolvedor", async () => {
    const report = await runCorpus(goldenFoodCorpus, {
      id: "test:abstencao-total",
      revision: "1",
      resolve: () => ({ decisions: [] }),
    });
    expect(report.overall.matchedCases).toBe(0);
    expect(report.overall.abstentions).toBe(report.caseCount);
    expect(report.overall.matchRate).toBe(0);
    expect(report.gate.status).toBe("failed");
  });
});
