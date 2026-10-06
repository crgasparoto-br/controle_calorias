import { describe, expect, it } from "vitest";
import { goldenCorpusSchema, type GoldenCorpus } from "./contracts";
import { goldenFoodCorpus } from "./data";
import { runCorpus } from "./harness";
import {
  createAlwaysClarifyResolver,
  createEmptyResolver,
  createHoldoutWritingResolver,
  createReferenceResolver,
  createShiftedResolver,
  createThrowingResolver,
  createVersionMismatchResolver,
  createWrongConvergenceResolver,
} from "./selfTestResolvers";

/**
 * Testes do próprio harness: casos propositalmente errados, denominador zero,
 * duplicatas, controles negativos e versões diferentes (issue #1299).
 */
function subCorpus(caseIds: readonly string[]): GoldenCorpus {
  return goldenCorpusSchema.parse({
    ...goldenFoodCorpus,
    cases: goldenFoodCorpus.cases.filter(entry =>
      caseIds.includes(entry.caseId)
    ),
  });
}

describe("autoverificação do harness", () => {
  it("reprova um resolvedor que desloca o resultado entre casos", async () => {
    const report = await runCorpus(
      goldenFoodCorpus,
      createShiftedResolver(goldenFoodCorpus)
    );
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.gate.status).not.toBe("passed");
    expect(report.overall.matchRate).toBeLessThan(1);
  });

  it("reprova convergência entre saídas contra a referência independente (§4.1.8)", async () => {
    const groupId = "g-mortadela-fatia-e-meia";
    const report = await runCorpus(
      goldenFoodCorpus,
      createWrongConvergenceResolver(goldenFoodCorpus, groupId)
    );
    const group = report.metamorphic.find(item => item.groupId === groupId);
    expect(group).toBeDefined();
    expect(group?.converged).toBe(true);
    expect(group?.allMatchReference).toBe(false);
    expect(group?.wrongConvergence).toBe(true);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("negative_control_convergence");
  });

  it("registra ausência de decisão como falha, não como sucesso", async () => {
    const report = await runCorpus(goldenFoodCorpus, createEmptyResolver());
    expect(
      report.failures.some(failure =>
        failure.codes.includes("missing_decision")
      )
    ).toBe(true);
    expect(report.overall.abstentions).toBe(report.caseCount);
    expect(report.gate.status).toBe("failed");
  });

  it("registra erro do resolvedor como falha explícita", async () => {
    const report = await runCorpus(goldenFoodCorpus, createThrowingResolver());
    expect(
      report.failures.every(failure => failure.codes.includes("resolver_error"))
    ).toBe(true);
    expect(report.overall.abstentions).toBe(report.caseCount);
    expect(report.gate.status).toBe("failed");
  });

  it("reprova versão de decisão não governada", async () => {
    const report = await runCorpus(
      goldenFoodCorpus,
      createVersionMismatchResolver(goldenFoodCorpus)
    );
    expect(
      report.failures.some(failure =>
        failure.codes.includes("decision_invalid")
      )
    ).toBe(true);
    expect(report.gate.status).toBe("failed");
  });

  it("bloqueia quando o resolvedor escreve conhecimento em caso reservado", async () => {
    const report = await runCorpus(
      goldenFoodCorpus,
      createHoldoutWritingResolver(goldenFoodCorpus)
    );
    expect(report.integrity.holdoutKnowledgeWrites.length).toBeGreaterThan(0);
    expect(report.integrity.status).toBe("invalid");
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("holdout_knowledge_write");
    expect(
      report.failures.some(failure =>
        failure.codes.includes("learning_applied_during_measurement")
      )
    ).toBe(true);
  });

  it("trata denominador zero como amostra ausente, nunca como zero", async () => {
    const corpus = subCorpus([
      "c-erro-transcricao",
      "c-banco-ambiguo-pao",
      "c-neg-pasta-de-dente",
      "c-neg-imagem-ilegivel",
    ]);
    const report = await runCorpus(corpus, createReferenceResolver(corpus));
    expect(report.overall.resolvableLabeled).toBe(0);
    expect(report.overall.matchRate).toBeNull();
    expect(report.overall.sampleStatus).toBe("missing");
    expect(report.gate.status).toBe("sample_missing");
  });

  it("detecta casos duplicados", async () => {
    const panco = goldenFoodCorpus.cases.find(
      entry => entry.caseId === "c-panco-pao-forma"
    );
    expect(panco).toBeDefined();
    const clone = { ...panco!, caseId: "c-panco-clone" };
    const corpus = goldenCorpusSchema.parse({
      ...goldenFoodCorpus,
      cases: [panco!, clone],
    });
    const report = await runCorpus(corpus, createReferenceResolver(corpus));
    expect(report.integrity.duplicateSurfaces).toHaveLength(1);
    expect(report.integrity.status).toBe("invalid");
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("duplicate_cases");
  });

  it("detecta a mesma superfície repetida entre partições (vazamento para holdout)", async () => {
    const panco = goldenFoodCorpus.cases.find(
      entry => entry.caseId === "c-panco-pao-forma"
    );
    expect(panco).toBeDefined();
    const leak = {
      ...panco!,
      caseId: "c-panco-holdout",
      split: "holdout" as const,
    };
    const corpus = goldenCorpusSchema.parse({
      ...goldenFoodCorpus,
      cases: [panco!, leak],
    });
    const report = await runCorpus(corpus, createReferenceResolver(corpus));
    expect(report.integrity.splitLeakage).toHaveLength(1);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("split_leakage");
  });

  it("detecta classe de decisão declarada divergente da derivada", async () => {
    const clarification = goldenFoodCorpus.cases.find(
      entry => entry.caseId === "c-erro-transcricao"
    );
    expect(clarification).toBeDefined();
    const mislabeled = {
      ...clarification!,
      decisionClass: "resolvable" as const,
    };
    const corpus = goldenCorpusSchema.parse({
      ...goldenFoodCorpus,
      cases: [mislabeled],
    });
    const report = await runCorpus(corpus, createReferenceResolver(corpus));
    expect(report.integrity.invalidCases).toHaveLength(1);
    expect(report.integrity.status).toBe("invalid");
    expect(report.gate.blockReasons).toContain("corpus_invalid");
  });

  it("rejeita corpus com versão de schema desconhecida", () => {
    const result = goldenCorpusSchema.safeParse({
      ...goldenFoodCorpus,
      schemaVersion: 99,
    });
    expect(result.success).toBe(false);
  });

  it("bloqueia divergência de macros sem tolerância calibrada", async () => {
    const groupId = "g-mortadela-fatia-e-meia";
    const target = "c-mortadela-1-5-ponto";
    const reference = createReferenceResolver(goldenFoodCorpus);
    const report = await runCorpus(goldenFoodCorpus, {
      id: "test:macro-divergente",
      revision: "1",
      async resolve(request) {
        const result = await reference.resolve(request);
        if (request.case.caseId !== target) return result;
        return {
          ...result,
          decisions: result.decisions.map(decision => ({
            ...decision,
            nutrition: {
              ...decision.nutrition,
              consumed: decision.nutrition.consumed
                ? { ...decision.nutrition.consumed, calories: 999 }
                : null,
            },
          })),
        };
      },
    });
    const group = report.macroConsistency.find(
      item => item.groupId === groupId
    );
    expect(group?.consistent).toBe(false);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "rounding_tolerance_not_calibrated"
    );
  });

  it("aceita a divergência apenas quando existe tolerância calibrada declarada", async () => {
    const target = "c-mortadela-1-5-ponto";
    const reference = createReferenceResolver(goldenFoodCorpus);
    const report = await runCorpus(
      goldenFoodCorpus,
      {
        id: "test:macro-divergente",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          if (request.case.caseId !== target) return result;
          return {
            ...result,
            decisions: result.decisions.map(decision => ({
              ...decision,
              nutrition: {
                ...decision.nutrition,
                consumed: decision.nutrition.consumed
                  ? { ...decision.nutrition.consumed, calories: 120.5 }
                  : null,
              },
            })),
          };
        },
      },
      { roundingTolerance: 1 }
    );
    expect(report.gate.blockReasons).not.toContain(
      "rounding_tolerance_not_calibrated"
    );
    expect(report.gate.status).toBe("passed");
  });

  it("não promove abstenção total a aprovação", async () => {
    const report = await runCorpus(
      goldenFoodCorpus,
      createAlwaysClarifyResolver()
    );
    expect(report.overall.matchedCases).toBe(0);
    expect(report.gate.status).not.toBe("passed");
    expect(
      report.byDecisionClass.find(item => item.segment === "resolvable")
        ?.matchRate
    ).toBe(0);
  });
});
