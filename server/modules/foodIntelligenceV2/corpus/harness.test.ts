import { describe, expect, it } from "vitest";
import {
  CORPUS_SEGMENT_DIMENSIONS,
  goldenCorpusSchema,
  type CorpusRevisions,
  type GoldenCorpus,
} from "./contracts";
import { goldenFoodCorpus } from "./data";
import {
  inspectCorpusIntegrity,
  runCorpus,
  runGoldenFoodCorpus,
} from "./harness";
import { renderCorpusReportMarkdown } from "./report";
import {
  createReferenceResolver,
  createShiftedResolver,
  createWrongConvergenceResolver,
} from "./selfTestResolvers";

/** Revisões fixadas: medição sem revisão amarrada bloqueia (§16.1). */
const PINNED_REVISIONS: CorpusRevisions = {
  code: "sha:test-harness",
  knowledge: "kn-1",
  lexicon: "lex-1",
  model: "model-1",
  policy: "pol-1",
  resolver: "v2.0.0-test",
};

const reference = () =>
  createReferenceResolver(goldenFoodCorpus) as ReturnType<
    typeof createReferenceResolver
  >;

const pinned = { revisions: PINNED_REVISIONS };

function corpusWith(
  mutate: (corpus: GoldenCorpus) => GoldenCorpus
): GoldenCorpus {
  return goldenCorpusSchema.parse(mutate(structuredClone(goldenFoodCorpus)));
}

describe("harness do Golden Food Corpus", () => {
  it("aprova o corpus quando o resolvedor corresponde à referência independente", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    expect(report.integrity.status).toBe("valid");
    expect(report.failures).toStrictEqual([]);
    expect(report.overall.matchRate).toBe(1);
    expect(report.gate.status).toBe("passed");
    expect(report.gate.blockReasons).toStrictEqual([]);
    expect(report.gate.nonResolvableFailureCount).toBe(0);
  });

  it("entrega cada caso ao resolvedor sob teste (§18)", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    expect(report.resolveCalls).toBe(report.caseCount);
    expect(report.resolveCalls).toBe(goldenFoodCorpus.cases.length);
    expect(report.resolver.id).toBe("self-test:reference-oracle");
  });

  it("entrega entrada sanitizada, sem o resultado esperado nem partição", async () => {
    const seen: string[] = [];
    await runCorpus(
      goldenFoodCorpus,
      {
        id: "test:entrada",
        revision: "1",
        resolve: request => {
          const keys = Object.keys(request.case as object).sort();
          seen.push(keys.join(","));
          expect(keys).toStrictEqual([
            "caseId",
            "input",
            "mealOperation",
            "modality",
            "scenario",
          ]);
          expect(
            (request.case as unknown as Record<string, unknown>)["expected"]
          ).toBeUndefined();
          expect(
            (request.case as unknown as Record<string, unknown>)["split"]
          ).toBeUndefined();
          return { decisions: [] };
        },
      },
      pinned
    );
    // O corpus e os passos dos cenários de §16.1 passam pelo resolvedor, e
    // todos recebem a mesma entrada sanitizada.
    expect(new Set(seen).size).toBe(1);
    expect(seen.length).toBeGreaterThanOrEqual(goldenFoodCorpus.cases.length);
  });

  it("bloqueia quando as revisões não estão fixadas", async () => {
    const report = await runGoldenFoodCorpus(reference());
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("revisions_not_pinned");
  });

  it("produz relatório por todas as dimensões de segmentação de §16.2", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
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
    // Marca, atributo material, medida, continuidade, operação e procedência
    // nutricional são segmentações obrigatórias de §16.2.
    expect(report.byBrand.length).toBeGreaterThan(1);
    expect(report.byMaterialAttribute.length).toBeGreaterThan(1);
    expect(report.byMeasure.length).toBeGreaterThan(1);
    expect(report.byContinuity.map(item => item.segment).sort()).toStrictEqual([
      "continues_context",
      "standalone",
    ]);
    expect(report.byOperation.length).toBeGreaterThan(1);
    expect(report.byNutritionSource.length).toBeGreaterThan(1);
    expect(CORPUS_SEGMENT_DIMENSIONS).toHaveLength(10);
  });

  it("reporta as famílias de falha e a latência/custo por segmento", async () => {
    const report = await runCorpus(
      goldenFoodCorpus,
      {
        id: "test:metricas",
        revision: "1",
        resolve: () => ({
          decisions: [],
          metrics: { latencyMs: 7, costUsd: 0.01 },
        }),
      },
      pinned
    );
    expect(report.overall.latencySamples).toBe(report.caseCount);
    expect(report.overall.totalLatencyMs).toBe(7 * report.caseCount);
    expect(report.overall.totalCostUsd).toBeCloseTo(0.01 * report.caseCount, 6);
    expect(report.overall.families.unexpectedDecisions).toBe(0);
  });

  it("reporta latência/custo como ausentes quando o resolvedor não os expõe", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    expect(report.overall.latencySamples).toBe(0);
    expect(report.overall.totalLatencyMs).toBeNull();
    expect(report.overall.totalCostUsd).toBeNull();
  });

  it("calcula a meta de §1.1 sobre todos os casos resolvíveis rotulados", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    const expectedResolvable = goldenFoodCorpus.cases.filter(
      entry => entry.decisionClass === "resolvable"
    ).length;
    expect(report.overall.resolvableLabeled).toBe(expectedResolvable);
    expect(report.overall.sampleStatus).toBe("present");
    expect(report.overall.matchRate).toBe(1);
  });

  it("trata denominador zero como amostra ausente, nunca como zero", async () => {
    const onlyClarification = corpusWith(corpus => ({
      ...corpus,
      learningScenarios: [],
      cases: corpus.cases
        .filter(entry => entry.decisionClass !== "resolvable")
        .map(entry => ({
          ...entry,
          metamorphicGroup: null,
          negativeControlOf: null,
          negativeControlHypothesis: null,
          learningScenarioId: null,
          equivalenceReference: null,
        })),
    }));
    const report = await runCorpus(
      onlyClarification,
      createReferenceResolver(onlyClarification),
      pinned
    );
    expect(report.overall.resolvableLabeled).toBe(0);
    expect(report.overall.sampleStatus).toBe("missing");
    expect(report.overall.matchRate).toBeNull();
    expect(report.gate.status).toBe("sample_missing");
  });

  it("reprova quando uma falha está fora dos casos resolvíveis", async () => {
    // A meta de §1.1 não cobre clarificação/rejeição: elas precisam estar
    // integralmente corretas.
    const report = await runGoldenFoodCorpus(
      createShiftedResolver(goldenFoodCorpus),
      pinned
    );
    expect(report.gate.nonResolvableFailureCount).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
  });

  it("verifica equivalência de superfície contra a referência (§17)", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    expect(report.metamorphic.length).toBeGreaterThanOrEqual(10);
    for (const group of report.metamorphic) {
      expect(group.memberCaseIds.length).toBeGreaterThanOrEqual(2);
      expect(group.allMatchReference).toBe(true);
      expect(group.converged).toBe(true);
      expect(group.wrongConvergence).toBe(false);
    }
  });

  it("reprova quando um grupo converge para o mesmo resultado errado", async () => {
    const report = await runGoldenFoodCorpus(
      createWrongConvergenceResolver(goldenFoodCorpus, "g-acento-pao-frances"),
      pinned
    );
    const group = report.metamorphic.find(
      item => item.groupId === "g-acento-pao-frances"
    );
    expect(group?.converged).toBe(true);
    expect(group?.allMatchReference).toBe(false);
    expect(group?.wrongConvergence).toBe(true);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("negative_control_convergence");
  });

  it("mantém controles negativos discriminantes com evidência adversarial", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    expect(report.negativeControls.length).toBeGreaterThanOrEqual(6);
    for (const control of report.negativeControls) {
      expect(control.discriminating).toBe(true);
      expect(control.discriminatingDimension).not.toBe("none");
      expect(control.hypothesis.length).toBeGreaterThan(10);
      expect(control.controlSignature).not.toBe(control.targetSignature);
      expect(control.revisions).toStrictEqual(PINNED_REVISIONS);
    }
  });

  it("mantém consistência de macros entre entradas equivalentes", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    for (const item of report.macroConsistency) {
      expect(item.consistent).toBe(true);
      expect(item.divergences).toStrictEqual([]);
    }
  });

  it("bloqueia divergência de macros enquanto a tolerância estiver OPEN", async () => {
    const corpus = corpusWith(corpusValue => ({
      ...corpusValue,
      cases: corpusValue.cases.map(entry =>
        entry.caseId === "c-acento-presente"
          ? {
              ...entry,
              expected: {
                ...entry.expected,
                decisions: entry.expected.decisions.map(decision => ({
                  ...decision,
                  quantity: { ...decision.quantity, grams: 99 },
                })),
              },
            }
          : entry
      ),
    }));
    const withoutTolerance = await runGoldenFoodCorpus(
      createReferenceResolver(corpus),
      pinned
    );
    expect(withoutTolerance.gate.status).toBe("blocked");
    expect(withoutTolerance.gate.blockReasons).toContain(
      "rounding_tolerance_not_calibrated"
    );

    const withTolerance = await runGoldenFoodCorpus(
      createReferenceResolver(corpus),
      { ...pinned, roundingTolerance: 0.5 }
    );
    expect(withTolerance.gate.blockReasons).not.toContain(
      "rounding_tolerance_not_calibrated"
    );
  });

  it("detecta grupo metamórfico com expectativa divergente", () => {
    const corpus = corpusWith(corpusValue => ({
      ...corpusValue,
      cases: corpusValue.cases.map(entry =>
        entry.caseId === "c-acento-presente"
          ? {
              ...entry,
              expected: {
                ...entry.expected,
                decisions: entry.expected.decisions.map(decision => ({
                  ...decision,
                  identity: {
                    ...decision.identity,
                    canonicalName: "pão de queijo",
                  },
                })),
              },
            }
          : entry
      ),
    }));
    const integrity = inspectCorpusIntegrity(corpus);
    expect(integrity.status).toBe("invalid");
    expect(integrity.divergentGroupExpectations.length).toBeGreaterThan(0);
    expect(integrity.divergentGroupExpectations[0].caseIds).toContain(
      "c-acento-presente"
    );
  });

  it("detecta duplicata de superfície e vazamento entre partições", () => {
    const duplicated = corpusWith(corpusValue => ({
      ...corpusValue,
      cases: [
        ...corpusValue.cases,
        {
          ...corpusValue.cases[0],
          caseId: "c-duplicata-artificial",
          scenario: { ...corpusValue.cases[0].scenario },
          learningScenarioId: null,
          metamorphicGroup: null,
        },
      ],
    }));
    const integrity = inspectCorpusIntegrity(duplicated);
    expect(integrity.status).toBe("invalid");
    expect(integrity.duplicateSurfaces.length).toBeGreaterThan(0);
    expect(integrity.duplicateSurfaces[0].caseIds).toContain(
      "c-duplicata-artificial"
    );

    const leaked = corpusWith(corpusValue => ({
      ...corpusValue,
      cases: [
        ...corpusValue.cases,
        {
          ...corpusValue.cases[0],
          caseId: "c-vazamento-artificial",
          split: "holdout",
          scenario: { ...corpusValue.cases[0].scenario },
          learningScenarioId: null,
          metamorphicGroup: null,
        },
      ],
    }));
    expect(inspectCorpusIntegrity(leaked).splitLeakage.length).toBeGreaterThan(
      0
    );
  });

  it("é reproduzível: duas execuções produzem o mesmo relatório", async () => {
    const first = await runGoldenFoodCorpus(reference(), pinned);
    const second = await runGoldenFoodCorpus(reference(), pinned);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("registra as revisões de código, conhecimento, léxico, modelo e política", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    expect(report.revisions).toStrictEqual(PINNED_REVISIONS);
    expect(report.corpusVersion).toBe(goldenFoodCorpus.corpusVersion);
  });

  it("renderiza relatório com todas as seções obrigatórias", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    const markdown = renderCorpusReportMarkdown(report);
    for (const section of [
      "Por modalidade",
      "Por classe de decisão",
      "Por classe de não-recorrência",
      "Por marca",
      "Por atributo material",
      "Por medida",
      "Por continuidade",
      "Por operação",
      "Por procedência nutricional",
      "Equivalência de superfície",
      "Controles negativos",
      "Consistência de macros",
      "Cenários de aprendizado",
      "Revisões fixadas",
    ]) {
      expect(markdown).toContain(section);
    }
  });

  it("não conta como acerto a abstenção do resolvedor", async () => {
    const report = await runCorpus(
      goldenFoodCorpus,
      {
        id: "test:abstencao-total",
        revision: "1",
        resolve: () => ({ decisions: [] }),
      },
      pinned
    );
    expect(report.overall.matchedCases).toBe(0);
    expect(report.overall.abstentions).toBe(report.caseCount);
    expect(report.overall.matchRate).toBe(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("scenario_invariant_violated");
  });

  it("executa os cenários de §16.1 com o resolvedor de referência", async () => {
    const report = await runGoldenFoodCorpus(reference(), pinned);
    expect(report.learningScenarios.length).toBeGreaterThanOrEqual(1);
    for (const scenario of report.learningScenarios) {
      expect(scenario.passed).toBe(true);
      expect(scenario.phases).toContain("acquisition");
      expect(scenario.phases).toContain("restart");
      expect(scenario.phases).toContain("revocation");
      expect(scenario.phases).toContain("isolation");
    }
  });
});
