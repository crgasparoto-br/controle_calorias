import { describe, expect, it } from "vitest";
import {
  GOLDEN_CORPUS_MIN_MATCH_RATE,
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
import {
  buildDecisionForExpected,
  createAlwaysClarifyResolver,
  createCacheIgnoringRevocationResolver,
  createEmptyResolver,
  createHiddenHoldoutWriterResolver,
  createHoldoutDeclaringWriterResolver,
  createInventedAlternativesResolver,
  createInventedIdentityResolver,
  createLearningResolver,
  createNutritionOriginDriftResolver,
  createOracleLeakProbeResolver,
  createReferenceResolver,
  createShiftedResolver,
  createThrowingResolver,
  createVersionMismatchResolver,
  createWrongConvergenceResolver,
} from "./selfTestResolvers";

const PINNED_REVISIONS: CorpusRevisions = {
  code: "sha:test-self",
  knowledge: "kn-1",
  lexicon: "lex-1",
  model: "model-1",
  policy: "pol-1",
  resolver: "v2.0.0-test",
};

const pinned = { revisions: PINNED_REVISIONS };
const corpus = goldenFoodCorpus;

/**
 * Testes do próprio harness (issue #1299): casos propositalmente errados,
 * denominador zero, duplicatas, controles negativos, versões diferentes e
 * remediações exigidas pela auditoria independente do PR.
 */
function subCorpus(caseIds: readonly string[]): GoldenCorpus {
  // Recorte sintético: remove metadados que só fazem sentido no corpus inteiro
  // (grupo metamórfico, controle negativo, cenário) para isolar o que se mede.
  return goldenCorpusSchema.parse({
    ...goldenFoodCorpus,
    cases: goldenFoodCorpus.cases
      .filter(entry => caseIds.includes(entry.caseId))
      .map(entry => ({
        ...entry,
        metamorphicGroup: null,
        negativeControlOf: null,
        negativeControlHypothesis: null,
        learningScenarioId: null,
        equivalenceReference: null,
      })),
    learningScenarios: [],
  });
}

function allCodes(report: Awaited<ReturnType<typeof runGoldenFoodCorpus>>) {
  return report.failures.flatMap(failure => failure.codes);
}

describe("autoverificação do harness", () => {
  it("mantém a linha de base: a referência independente aprova", async () => {
    const report = await runGoldenFoodCorpus(
      createReferenceResolver(corpus),
      pinned
    );
    expect(report.gate.status).toBe("passed");
    expect(report.failures).toStrictEqual([]);
  });

  it("não expõe o oráculo: a entrada é sanitizada e congelada", async () => {
    const report = await runGoldenFoodCorpus(
      createOracleLeakProbeResolver(corpus),
      pinned
    );
    // A sonda lança se `expected` existir na entrada ou se ela não estiver
    // congelada; passar significa que o resolvedor não pode copiar o oráculo.
    expect(report.gate.status).toBe("passed");
    expect(allCodes(report)).not.toContain("resolver_error");
  });

  it("bloqueia mutação da entrada do corpus pelo resolvedor", async () => {
    const report = await runGoldenFoodCorpus(
      {
        id: "test:muta-entrada",
        revision: "1",
        resolve: request => {
          const target = request.case.input as { text: string };
          target.text = "superfície adulterada";
          return { decisions: [] };
        },
      },
      pinned
    );
    expect(allCodes(report)).toContain("resolver_error");
    expect(report.failures[0].detail).toMatch(/read only|readonly|não/i);
  });

  it("reprova um resolvedor que desloca o resultado entre casos", async () => {
    const report = await runGoldenFoodCorpus(
      createShiftedResolver(corpus),
      pinned
    );
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.gate.status).not.toBe("passed");
    expect(report.overall.matchRate).toBeLessThan(1);
  });

  it("reprova convergência entre saídas contra a referência independente (§4.1.8)", async () => {
    const groupId = "g-mortadela-fatia-e-meia";
    const report = await runGoldenFoodCorpus(
      createWrongConvergenceResolver(corpus, groupId),
      pinned
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
    const report = await runGoldenFoodCorpus(createEmptyResolver(), pinned);
    expect(report.overall.matchedCases).toBe(0);
    expect(report.overall.abstentions).toBe(report.caseCount);
    expect(allCodes(report)).toContain("missing_decision");
    expect(report.gate.status).toBe("blocked");
  });

  it("reprova resultado parcial que omite decisões esperadas depois de um match válido", async () => {
    const partialCorpus = subCorpus(["c-multiplos-um-ambiguo"]);
    const reference = createReferenceResolver(partialCorpus);

    const report = await runCorpus(
      partialCorpus,
      {
        id: "test:resultado-parcial",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return {
            ...result,
            decisions: result.decisions.slice(0, 1),
          };
        },
      },
      pinned
    );

    const codes = report.failures.flatMap(failure => failure.codes);
    expect(codes).toContain("missing_decision");
    expect(report.overall.matchedCases).toBe(0);
    expect(report.gate.nonResolvableFailureCount).toBe(1);
    expect(report.gate.status).not.toBe("passed");
  });

  it("registra erro do resolvedor como falha explícita", async () => {
    const report = await runGoldenFoodCorpus(createThrowingResolver(), pinned);
    expect(allCodes(report)).toContain("resolver_error");
    expect(report.overall.abstentions).toBe(report.caseCount);
    expect(report.gate.status).toBe("blocked");
  });

  it("reprova versão de decisão não governada", async () => {
    const report = await runGoldenFoodCorpus(
      createVersionMismatchResolver(corpus),
      pinned
    );
    expect(allCodes(report)).toContain("decision_invalid");
    expect(report.gate.status).toBe("blocked");
  });

  it("reprova identidade e quantidade inventadas em decisão que não propõe", async () => {
    const report = await runGoldenFoodCorpus(
      createInventedIdentityResolver(corpus),
      pinned
    );
    const codes = allCodes(report);
    expect(codes).toContain("identity_present_unexpected");
    expect(codes).toContain("quantity_present_unexpected");
    expect(report.gate.nonResolvableFailureCount).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
  });

  it("reprova alternativas inventadas mesmo com a cardinalidade correta", async () => {
    const report = await runGoldenFoodCorpus(
      createInventedAlternativesResolver(corpus),
      pinned
    );
    expect(allCodes(report)).toContain("alternatives_mismatch");
    expect(report.gate.status).toBe("blocked");
  });

  it("reprova procedência nutricional não sustentada", async () => {
    const report = await runGoldenFoodCorpus(
      createNutritionOriginDriftResolver(corpus),
      pinned
    );
    expect(allCodes(report)).toContain("nutrition_origin_forbidden");
    expect(report.gate.status).toBe("blocked");
  });

  it("reprova item proposto sem procedência nutricional declarada", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:sem-procedencia",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return {
            ...result,
            decisions: result.decisions.map(decision => ({
              ...decision,
              evidence: decision.evidence.filter(
                evidence => !evidence.field.startsWith("nutrition.")
              ),
            })),
          };
        },
      },
      pinned
    );
    expect(allCodes(report)).toContain("nutrition_provenance_missing");
    expect(report.gate.status).toBe("blocked");
  });

  it("bloqueia escrita oculta em caso reservado sem declaração de efeito", async () => {
    const report = await runGoldenFoodCorpus(
      createHiddenHoldoutWriterResolver(corpus),
      pinned
    );
    expect(report.integrity.holdoutKnowledgeWrites.length).toBeGreaterThan(0);
    expect(report.gate.blockReasons).toContain("holdout_knowledge_write");
    expect(allCodes(report)).toContain("learning_applied_during_measurement");
    expect(report.gate.status).toBe("blocked");
  });

  it("reprova escritas declaradas em casos reservados", async () => {
    const report = await runGoldenFoodCorpus(
      createHoldoutDeclaringWriterResolver(corpus),
      pinned
    );
    expect(allCodes(report)).toContain("learning_applied_during_measurement");
    expect(report.gate.status).toBe("blocked");
  });

  it("mantém o ledger de conhecimento como evidência primária de efeito", async () => {
    const rejected: string[] = [];
    await runCorpus(
      corpus,
      {
        id: "test:ledger",
        revision: "1",
        resolve: async request => {
          try {
            await request.knowledge.write("alias:x", "y");
          } catch {
            rejected.push(request.case.caseId);
          }
          return { decisions: [] };
        },
      },
      pinned
    );
    // Toda tentativa fora da aquisição é rejeitada pela fachada, e o resolvedor
    // não tem outro caminho para escrever conhecimento.
    const rejectedIds = new Set(rejected);
    for (const entry of corpus.cases) {
      expect(rejectedIds.has(entry.caseId)).toBe(true);
    }
  });

  it("trata denominador zero como amostra ausente, nunca como zero", async () => {
    const onlyClarification = subCorpus([
      "c-erro-transcricao",
      "c-banco-ambiguo-pao",
      "c-neg-pasta-de-dente",
      "c-neg-imagem-ilegivel",
    ]);
    const report = await runCorpus(
      onlyClarification,
      createReferenceResolver(onlyClarification),
      pinned
    );
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
    const clone = {
      ...panco!,
      caseId: "c-panco-clone",
      metamorphicGroup: null,
      learningScenarioId: null,
    };
    const corpusWithDuplicate = goldenCorpusSchema.parse({
      ...goldenFoodCorpus,
      cases: [panco!, clone],
      learningScenarios: [],
    });
    const report = await runCorpus(
      corpusWithDuplicate,
      createReferenceResolver(corpusWithDuplicate),
      pinned
    );
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
      metamorphicGroup: null,
      learningScenarioId: null,
    };
    const leakedCorpus = goldenCorpusSchema.parse({
      ...goldenFoodCorpus,
      cases: [panco!, leak],
      learningScenarios: [],
    });
    const report = await runCorpus(
      leakedCorpus,
      createReferenceResolver(leakedCorpus),
      pinned
    );
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
      metamorphicGroup: null,
      learningScenarioId: null,
    };
    const mislabeledCorpus = goldenCorpusSchema.parse({
      ...goldenFoodCorpus,
      cases: [mislabeled],
      learningScenarios: [],
    });
    const report = await runCorpus(
      mislabeledCorpus,
      createReferenceResolver(mislabeledCorpus),
      pinned
    );
    expect(report.integrity.invalidCases.length).toBeGreaterThan(0);
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

  it("rejeita caso que afirma identidade sem nome canônico", () => {
    const incoherent = goldenCorpusSchema.parse({
      ...goldenFoodCorpus,
      cases: goldenFoodCorpus.cases.map(entry =>
        entry.caseId === "c-ovo-frito"
          ? {
              ...entry,
              expected: {
                ...entry.expected,
                decisions: entry.expected.decisions.map(decision => ({
                  ...decision,
                  identity: { ...decision.identity, canonicalName: null },
                })),
              },
            }
          : entry
      ),
      learningScenarios: [],
    });
    // O schema aceita a forma, mas a integridade do corpus reprova a coerência:
    // afirmar identidade exige nome canônico.
    const integrity = inspectCorpusIntegrity(incoherent);
    expect(integrity.status).toBe("invalid");
    expect(
      integrity.invalidCases.some(item =>
        item.message.includes("afirma identidade sem nome canônico")
      )
    ).toBe(true);
  });

  it("bloqueia divergência de macros sem tolerância calibrada", async () => {
    const groupId = "g-mortadela-fatia-e-meia";
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
                  ? { ...decision.nutrition.consumed, calories: 999 }
                  : null,
              },
            })),
          };
        },
      },
      pinned
    );
    const group = report.macroConsistency.find(
      item => item.groupId === groupId
    );
    expect(group?.consistent).toBe(false);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "rounding_tolerance_not_calibrated"
    );
  });

  it.each(["identity", "nutrition-origin"])(
    "bloqueia falha metamórfica de %s mesmo acima da meta global",
    async mutation => {
      const reference = createReferenceResolver(corpus);
      const report = await runCorpus(
        corpus,
        {
          id: `test:metamorphic-${mutation}`,
          revision: "1",
          async resolve(request) {
            const result = structuredClone(await reference.resolve(request));
            if (request.case.caseId === "c-acento-ausente") {
              const decision = result.decisions[0];
              if (mutation === "identity") {
                decision.identity.canonicalName = "pão integral";
              } else {
                for (const evidence of decision.evidence) {
                  if (evidence.field.startsWith("nutrition."))
                    evidence.origin = "barcode";
                }
              }
            }
            return result;
          },
        },
        pinned
      );
      expect(report.overall.matchRate).toBeGreaterThan(
        GOLDEN_CORPUS_MIN_MATCH_RATE
      );
      expect(
        report.metamorphic.find(
          group => group.groupId === "g-acento-pao-frances"
        )?.converged
      ).toBe(false);
      expect(report.gate.status).toBe("blocked");
      expect(report.gate.blockReasons).toContain("metamorphic_failure");
      if (mutation === "nutrition-origin")
        expect(report.failures).toStrictEqual([]);
      else expect(allCodes(report)).toContain("identity_mismatch");
    }
  );

  it.each([false, true])(
    "compara macros por alimento em lotes equivalentes (divergência: %s)",
    async drift => {
      const reference = createReferenceResolver(corpus);
      const report = await runCorpus(
        corpus,
        {
          id: "test:batch-macros",
          revision: "1",
          async resolve(request) {
            const result = structuredClone(await reference.resolve(request));
            if (
              ["c-pontuacao-com-virgula", "c-pontuacao-sem-virgula"].includes(
                request.case.caseId
              )
            ) {
              for (const decision of result.decisions) {
                if (
                  decision.identity.canonicalName === "feijão" &&
                  decision.nutrition.consumed
                ) {
                  decision.nutrition.consumed.calories =
                    drift && request.case.caseId === "c-pontuacao-sem-virgula"
                      ? 201
                      : 200;
                }
              }
              if (request.case.caseId === "c-pontuacao-sem-virgula")
                result.decisions.reverse();
            }
            return result;
          },
        },
        pinned
      );
      expect(report.failures).toStrictEqual([]);
      expect(
        report.metamorphic.find(group => group.groupId === "g-pontuacao-lista")
          ?.converged
      ).toBe(true);
      const macros = report.macroConsistency.find(
        group => group.groupId === "g-pontuacao-lista"
      );
      expect(macros?.consistent).toBe(!drift);
      expect(report.gate.status).toBe(drift ? "blocked" : "passed");
      if (drift)
        expect(report.gate.blockReasons).toContain(
          "rounding_tolerance_not_calibrated"
        );
    }
  );

  it("preserva multiplicidade no pareamento de macros de itens repetidos", async () => {
    const repeated = goldenCorpusSchema.parse({
      ...corpus,
      cases: corpus.cases
        .filter(entry => entry.metamorphicGroup === "g-pontuacao-lista")
        .map(entry => ({
          ...entry,
          expected: {
            ...entry.expected,
            decisions: [0, 1, 2].map(index => ({
              ...entry.expected.decisions[0],
              label: `arroz-${index}`,
            })),
          },
        })),
      learningScenarios: [],
    });
    const reference = createReferenceResolver(repeated);
    const report = await runCorpus(
      repeated,
      {
        id: "test:repeated-batch-macros",
        revision: "1",
        async resolve(request) {
          const result = structuredClone(await reference.resolve(request));
          result.decisions.forEach((decision, index) => {
            if (decision.nutrition.consumed)
              decision.nutrition.consumed.calories = 100 + index;
          });
          if (request.case.caseId === "c-pontuacao-sem-virgula")
            result.decisions.reverse();
          return result;
        },
      },
      pinned
    );
    expect(report.gate.status).toBe("passed");
    expect(report.macroConsistency[0].consistent).toBe(true);
  });

  it("não promove abstenção total a aprovação", async () => {
    const report = await runGoldenFoodCorpus(
      createAlwaysClarifyResolver(corpus),
      pinned
    );
    expect(report.overall.matchedCases).toBe(0);
    expect(report.gate.status).not.toBe("passed");
    expect(report.gate.matchRate).toBe(0);
  });

  it("executa o protocolo de §16.1 com efeitos reais de persistência e revogação", async () => {
    const report = await runGoldenFoodCorpus(
      createLearningResolver(corpus),
      pinned
    );
    const scenario = report.learningScenarios[0];
    expect(scenario.passed).toBe(true);

    const byStep = new Map(scenario.steps.map(step => [step.stepId, step]));
    // Estado anterior difere do estado pós-aquisição.
    expect(byStep.get("step-aquisicao")?.differentFromSatisfied).toBe(true);
    // Reinício com a mesma chave reproduz o resultado (persistência).
    expect(byStep.get("step-reinicio")?.sameResultSatisfied).toBe(true);
    expect(byStep.get("step-medicao-reservada")?.sameResultSatisfied).toBe(
      true
    );
    // Isolamento entre proprietários e revogação mudam o resultado.
    expect(byStep.get("step-isolamento")?.differentFromSatisfied).toBe(true);
    expect(byStep.get("step-revogacao")?.differentFromSatisfied).toBe(true);
    // A escrita só ocorre na fase de aquisição.
    expect(byStep.get("step-aquisicao")?.recordedWriteAttempts).toBeGreaterThan(
      0
    );
    expect(byStep.get("step-reinicio")?.recordedWriteAttempts).toBe(0);
    expect(byStep.get("step-revogacao")?.recordedWriteAttempts).toBe(0);
  });

  it("reprova cache obsoleto que ignora a revogação", async () => {
    const report = await runGoldenFoodCorpus(
      createCacheIgnoringRevocationResolver(corpus),
      pinned
    );
    const scenario = report.learningScenarios[0];
    expect(scenario.passed).toBe(false);
    const revocation = scenario.steps.find(
      step => step.stepId === "step-revogacao"
    );
    expect(revocation?.differentFromSatisfied).toBe(false);
    expect(report.gate.blockReasons).toContain("scenario_invariant_violated");
    expect(report.gate.status).toBe("blocked");
  });

  it("rejeita expectativa incoerente entre presença e valores declarados", () => {
    const incoherent = [
      {
        nome: "identidade proibida com nome",
        mutate: (entry: (typeof corpus.cases)[number]) => ({
          ...entry,
          expected: {
            ...entry.expected,
            decisions: entry.expected.decisions.map(decision => ({
              ...decision,
              identity: {
                ...decision.identity,
                presence: "forbidden" as const,
                canonicalName: "arroz",
              },
            })),
          },
        }),
      },
      {
        nome: "quantidade não afirmada com valor",
        mutate: (entry: (typeof corpus.cases)[number]) => ({
          ...entry,
          expected: {
            ...entry.expected,
            decisions: entry.expected.decisions.map(decision => ({
              ...decision,
              quantity: {
                ...decision.quantity,
                presence: "unspecified" as const,
                value: 10,
                unit: "g",
              },
            })),
          },
        }),
      },
      {
        nome: "nutrição ausente com restrição de origem",
        mutate: (entry: (typeof corpus.cases)[number]) => ({
          ...entry,
          expected: {
            ...entry.expected,
            decisions: entry.expected.decisions.map(decision => ({
              ...decision,
              nutrition: {
                ...decision.nutrition,
                requirement: "absent" as const,
                forbiddenOrigins: ["memory"],
              },
            })),
          },
        }),
      },
    ];

    for (const { nome, mutate } of incoherent) {
      const broken = goldenCorpusSchema.parse({
        ...corpus,
        learningScenarios: [],
        cases: corpus.cases.map(entry =>
          entry.caseId === "c-ovo-frito"
            ? {
                ...mutate(entry),
                metamorphicGroup: null,
                negativeControlOf: null,
                learningScenarioId: null,
                equivalenceReference: null,
              }
            : {
                ...entry,
                metamorphicGroup: null,
                negativeControlOf: null,
                learningScenarioId: null,
                equivalenceReference: null,
              }
        ),
      });
      const integrity = inspectCorpusIntegrity(broken);
      expect(integrity.status, nome).toBe("invalid");
      expect(integrity.invalidCases.length, nome).toBeGreaterThan(0);
    }
  });

  it("reprova operação fora do schema canônico de refeição", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:operacao-invalida",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return {
            ...result,
            operation: {
              action: "add",
              targetMeal: "almoço",
              date: "2026-10-06",
              campoNaoGovernado: "x",
            },
          };
        },
      },
      pinned
    );
    expect(allCodes(report)).toContain("operation_invalid");
    expect(report.gate.status).toBe("blocked");
  });

  it("reprova métrica de latência/custo inválida e não a agrega", async () => {
    const report = await runGoldenFoodCorpus(
      {
        id: "test:metrica-invalida",
        revision: "1",
        resolve: request => ({
          decisions: [],
          metrics: { latencyMs: -1, costUsd: Number.NaN },
          caseId: request.case.caseId,
        }),
      },
      pinned
    );
    expect(allCodes(report)).toContain("metrics_invalid");
    expect(report.overall.latencySamples).toBe(0);
    expect(report.overall.costSamples).toBe(0);
    expect(report.overall.totalLatencyMs).toBeNull();
    expect(report.overall.totalCostUsd).toBeNull();
  });

  it("bloqueia por equivalência sem referência declarada", async () => {
    // Isola a única inconsistência: um membro de grupo metamórfico sem
    // referência independente declarada. O restante do corpus permanece válido.
    const broken = goldenCorpusSchema.parse({
      ...corpus,
      cases: corpus.cases.map(entry =>
        entry.caseId === "c-acento-ausente"
          ? { ...entry, equivalenceReference: null }
          : entry
      ),
    });
    const integrity = inspectCorpusIntegrity(broken);
    expect(integrity.undeclaredEquivalence.length).toBeGreaterThan(0);
    const report = await runCorpus(
      broken,
      createReferenceResolver(broken),
      pinned
    );
    expect(report.gate.blockReasons).toContain("undeclared_equivalence");
    expect(report.gate.status).toBe("blocked");
  });

  it("invalida grupo cujos membros declaram operação material diferente", () => {
    const groupId = "g-acento-pao-frances";
    const broken = goldenCorpusSchema.parse({
      ...corpus,
      learningScenarios: [],
      cases: corpus.cases.map(entry =>
        entry.caseId === "c-acento-ausente" &&
        entry.metamorphicGroup === groupId
          ? {
              ...entry,
              expected: {
                ...entry.expected,
                operation: {
                  action: "add",
                  targetMeal: "jantar",
                  date: "2026-10-06",
                },
              },
            }
          : entry
      ),
    });
    const integrity = inspectCorpusIntegrity(broken);
    expect(integrity.status).toBe("invalid");
    expect(
      integrity.divergentGroupExpectations.some(
        item => item.groupId === groupId
      )
    ).toBe(true);
  });

  it("não permite relaxar a meta de §1.1 por opção de execução", async () => {
    const reference = createReferenceResolver(corpus);
    const targets = new Set(
      corpus.cases
        .filter(
          entry =>
            entry.decisionClass === "resolvable" &&
            entry.metamorphicGroup === null &&
            entry.negativeControlOf === null
        )
        .slice(0, 4)
        .map(entry => entry.caseId)
    );
    expect(targets.size).toBe(4);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:abaixo-da-meta",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          if (!targets.has(request.case.caseId)) return result;
          return {
            ...result,
            decisions: result.decisions.map(decision => ({
              ...decision,
              identity: { ...decision.identity, canonicalName: "item trocado" },
            })),
          };
        },
      },
      pinned
    );
    // A meta é fixa: não existe opção para reduzi-la, e o gate usa §1.1.
    expect(report.gate.minMatchRate).toBe(GOLDEN_CORPUS_MIN_MATCH_RATE);
    expect(report.gate.matchRate).toBeLessThan(GOLDEN_CORPUS_MIN_MATCH_RATE);
    expect(report.gate.status).toBe("failed");
  });

  it("não conta controle negativo que não foi executado como discriminante", async () => {
    const report = await runGoldenFoodCorpus(createEmptyResolver(), pinned);
    expect(report.negativeControls.length).toBeGreaterThan(0);
    for (const control of report.negativeControls) {
      expect(control.executed).toBe(false);
      expect(control.discriminating).toBe(false);
      expect(control.discriminatingDimension).toBe("not_executed");
    }
  });
  it("rejeita quantidade não afirmada sobre superfície que declara quantidade", () => {
    const broken = goldenCorpusSchema.parse({
      ...corpus,
      cases: corpus.cases.map(entry =>
        entry.caseId === "c-ovo-frito"
          ? {
              ...entry,
              input: { ...entry.input, text: "2 ovos fritos" },
              expected: {
                ...entry.expected,
                decisions: entry.expected.decisions.map(decision => ({
                  ...decision,
                  quantity: {
                    presence: "unspecified" as const,
                    value: null,
                    unit: null,
                    grams: null,
                    milliliters: null,
                    measureKind: null,
                    unitMustNotBeConvertedToGrams: false,
                  },
                })),
              },
            }
          : entry
      ),
    });
    const integrity = inspectCorpusIntegrity(broken);
    expect(integrity.status).toBe("invalid");
    expect(
      integrity.invalidCases.some(
        item =>
          item.caseId === "c-ovo-frito" &&
          item.message.includes("não pode ficar 'unspecified'")
      )
    ).toBe(true);
  });

  it("reprova item proposto sem quantidade utilizável quando ela não é afirmada", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:quantidade-inutilizavel",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return {
            ...result,
            decisions: result.decisions.map(decision => ({
              ...decision,
              quantity: {
                ...decision.quantity,
                value: null,
                unit: null,
                grams: null,
                milliliters: null,
                measureKind: null,
              },
            })),
          };
        },
      },
      pinned
    );
    expect(allCodes(report)).toContain("quantity_unusable");
    expect(report.gate.status).not.toBe("passed");
  });

  it("reprova classificação ausente, não versionada ou divergente", async () => {
    const reference = createReferenceResolver(corpus);
    const missing = await runGoldenFoodCorpus(
      {
        id: "test:classificacao-ausente",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return {
            ...result,
            decisions: result.decisions.map(decision => ({
              ...decision,
              classification: null,
            })),
          };
        },
      },
      pinned
    );
    expect(allCodes(missing)).toContain("classification_missing");

    const unversioned = await runGoldenFoodCorpus(
      {
        id: "test:classificacao-sem-versao",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return {
            ...result,
            decisions: result.decisions.map(decision =>
              decision.classification === null
                ? decision
                : {
                    ...decision,
                    classification: {
                      ...decision.classification,
                      version: null,
                    },
                  }
            ),
          };
        },
      },
      pinned
    );
    expect(allCodes(unversioned)).toContain("classification_unversioned");

    // A classe J de §9.3 mede conteúdo: nível de processamento errado reprova.
    const drifted = await runGoldenFoodCorpus(
      {
        id: "test:classificacao-divergente",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return {
            ...result,
            decisions: result.decisions.map(decision =>
              decision.classification === null
                ? decision
                : {
                    ...decision,
                    classification: {
                      ...decision.classification,
                      processingLevel: "ultra_processed",
                    },
                  }
            ),
          };
        },
      },
      pinned
    );
    expect(allCodes(drifted)).toContain("classification_mismatch");
    const classificationCases = drifted.failures.filter(failure =>
      failure.codes.includes("classification_mismatch")
    );
    expect(classificationCases.length).toBeGreaterThan(0);
    // Só os casos que medem classificação reprovam por conteúdo.
    expect(
      classificationCases.every(failure =>
        corpus.cases
          .find(entry => entry.caseId === failure.caseId)!
          .expected.decisions.some(decision => decision.classification.measured)
      )
    ).toBe(true);
  });

  it("compara a operação de refeição sempre, e exige a expectativa declarada", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:operacao-errada",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return {
            ...result,
            operation: {
              action: "remove",
              targetMeal: "jantar",
              date: "2099-12-31",
            },
          };
        },
      },
      pinned
    );
    expect(allCodes(report)).toContain("operation_mismatch");
    expect(report.gate.status).not.toBe("passed");

    // Operação é obrigatória no contrato: não existe caso sem operação esperada.
    const { expected, ...rest } = corpus.cases[0];
    const { operation, ...expectedWithoutOperation } = expected;
    expect(() =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: [
          { ...rest, expected: expectedWithoutOperation },
          ...corpus.cases.slice(1),
        ],
      })
    ).toThrow();
  });

  it("rejeita data impossível no calendário", () => {
    expect(() =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(entry =>
          entry.caseId === "c-ovo-frito"
            ? {
                ...entry,
                expected: {
                  ...entry.expected,
                  operation: {
                    ...entry.expected.operation,
                    date: "2026-99-99",
                  },
                },
              }
            : entry
        ),
      })
    ).toThrow();
  });

  it("rejeita referência de equivalência não governada", () => {
    const groupMember = corpus.cases.find(
      entry => entry.equivalenceReference !== null
    )!;
    expect(() =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(entry =>
          entry.caseId === groupMember.caseId
            ? {
                ...entry,
                equivalenceReference: {
                  ...groupMember.equivalenceReference!,
                  declaredBy: "atacante",
                },
              }
            : entry
        ),
      })
    ).toThrow();
    expect(() =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(entry =>
          entry.caseId === groupMember.caseId
            ? {
                ...entry,
                equivalenceReference: {
                  declaredBy: groupMember.equivalenceReference!.declaredBy,
                  note: "sem seção",
                },
              }
            : entry
        ),
      })
    ).toThrow();
  });

  it("exige motivo estruturado para item não proposto", () => {
    const target = corpus.cases.find(entry =>
      entry.expected.decisions.some(
        decision => decision.nextAction === "reject"
      )
    );
    expect(target).toBeDefined();
    const broken = goldenCorpusSchema.parse({
      ...corpus,
      cases: corpus.cases.map(entry =>
        entry.caseId === target!.caseId
          ? {
              ...entry,
              expected: {
                ...entry.expected,
                decisions: entry.expected.decisions.map(decision =>
                  decision.nextAction === "propose"
                    ? decision
                    : { ...decision, reasonCodes: [] }
                ),
              },
            }
          : entry
      ),
    });
    const integrity = inspectCorpusIntegrity(broken);
    expect(integrity.status).toBe("invalid");
    expect(
      integrity.invalidCases.some(item =>
        item.message.includes("precisa declarar código de motivo")
      )
    ).toBe(true);
  });

  it("invalida cenário de §16.1 que não prova efeito observável", () => {
    const scenario = corpus.learningScenarios[0];
    const withoutInvariants = goldenCorpusSchema.parse({
      ...corpus,
      learningScenarios: [
        {
          ...scenario,
          steps: scenario.steps.map(step => ({
            ...step,
            sameResultAsStepId: null,
            differentFromStepId: null,
          })),
        },
      ],
    });
    const integrity = inspectCorpusIntegrity(withoutInvariants);
    expect(integrity.status).toBe("invalid");
    expect(integrity.invalidScenarios.length).toBeGreaterThan(0);

    const revokedWithoutKeys = goldenCorpusSchema.parse({
      ...corpus,
      learningScenarios: [
        {
          ...scenario,
          steps: scenario.steps.map(step =>
            step.phase === "revocation" ? { ...step, revokeKeys: [] } : step
          ),
        },
      ],
    });
    expect(inspectCorpusIntegrity(revokedWithoutKeys).status).toBe("invalid");
  });

  it("bloqueia quando a aquisição não registra escrita observável", async () => {
    const report = await runGoldenFoodCorpus(
      createReferenceResolver(corpus),
      pinned
    );
    expect(report.gate.status).toBe("passed");
    const acquisition = report.learningScenarios[0].steps.find(
      step => step.phase === "acquisition"
    );
    expect(acquisition?.recordedWriteAttempts).toBeGreaterThan(0);

    // Um resolvedor que devolve o resultado certo mas **não registra** nada na
    // aquisição não prova aprendizado: o passo de aquisição fica sem efeito.
    const silent = await runGoldenFoodCorpus(
      {
        id: "test:aquisicao-silenciosa",
        revision: "1",
        async resolve(request) {
          const reference = createReferenceResolver(corpus);
          return reference.resolve({
            ...request,
            knowledge: { ...request.knowledge, write: async () => undefined },
          });
        },
      },
      pinned
    );
    expect(silent.learningScenarios[0].passed).toBe(false);
    expect(silent.gate.blockReasons).toContain("scenario_invariant_violated");
  });

  it("não aceita métricas de tipo inválido", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:metrica-tipo-invalido",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return { ...result, metrics: "invalido" as never };
        },
      },
      pinned
    );
    expect(allCodes(report)).toContain("metrics_invalid");
    expect(report.overall.latencySamples).toBe(0);
    // Métrica inválida não se dilui na média: a medição não é evidência.
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("metrics_invalid");
  });

  it("fecha o gate quando a escrita em holdout ocorre só dentro do cenário", async () => {
    // A violação acontece num passo de cenário (caso holdout, fora da
    // aquisição), depois da checagem estrutural: precisa invalidar a execução
    // e bloquear independentemente da taxa de pareamento.
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:holdout-dentro-do-cenario",
        revision: "1",
        async resolve(request) {
          if (request.case.scenario.phase === "restart") {
            try {
              await request.knowledge.write("alias:furtivo", "x");
            } catch {
              // Tentativa registrada no ledger; efeito colateral oculto.
            }
          }
          return reference.resolve(request);
        },
      },
      pinned
    );
    expect(report.integrity.status).toBe("invalid");
    expect(report.integrity.holdoutKnowledgeWrites.length).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("holdout_knowledge_write");
  });

  it("reprova leitura sem uso: ler todas as chaves e ignorar o valor não prova aprendizado", async () => {
    // Bypass apontado pela auditoria: satisfaz a cadeia sintática (escreve e lê
    // exatamente as chaves exigidas, com hit) e devolve a expectativa por
    // `caseId`. A ablação da aquisição não muda nada — logo não há aprendizado
    // e o cenário precisa reprovar.
    const report = await runGoldenFoodCorpus(
      {
        id: "test:leitura-sem-uso",
        revision: "1",
        async resolve({ case: entry, allowLearning, knowledge }) {
          if (allowLearning && knowledge.mode === "acquisition") {
            await knowledge.write("owner-a:alias:cafe-da-firma", "IGNORED");
          } else {
            await knowledge.read("owner-a:alias:cafe-da-firma");
            await knowledge.read("owner-b:alias:cafe-da-firma");
          }
          const source = corpus.cases.find(
            item => item.caseId === entry.caseId
          )!;
          return {
            decisions: source.expected.decisions.map((decision, index) =>
              buildDecisionForExpected(source, decision, index, {})
            ),
            operation: source.expected.operation,
          };
        },
      },
      pinned
    );
    expect(report.gate.status).toBe("blocked");
    expect(report.learningScenarios[0].passed).toBe(false);
    expect(
      report.learningScenarios[0].failures.some(failure =>
        (failure.detail ?? "").includes("ablação da aquisição")
      )
    ).toBe(true);
  });

  it("integra a verificação da referência canônica ao gate principal", async () => {
    const member = corpus.cases.find(
      item => item.equivalenceReference !== null
    )!;
    const forged = goldenCorpusSchema.parse({
      ...corpus,
      cases: corpus.cases.map(item =>
        item.caseId === member.caseId
          ? {
              ...item,
              equivalenceReference: {
                declaredBy: "adr-food-intelligence-resolver-v2",
                adrSection: "§999",
                note: "seção inexistente declarada pelo corpus",
              },
            }
          : item
      ),
    });
    expect(inspectCorpusIntegrity(forged).reference.verified).toBe(false);
    const report = await runCorpus(
      forged,
      createReferenceResolver(forged),
      pinned
    );
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("reference_not_verified");
  });

  it("reprova ablação fabricada: divergir no modo ablação não substitui o contra-factual declarado", async () => {
    // Ataque da auditoria: o resolvedor conta as chamadas, reconhece a segunda
    // passagem (ablação) e devolve uma decisão material diferente só ali. Não
    // consulta o valor aprendido. A exigência de corresponder ao contra-factual
    // **declarado** pelo corpus fecha esse caminho.
    let calls = 0;
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:ablacao-fabricada",
        revision: "1",
        async resolve(request) {
          calls += 1;
          const ablated = calls > corpus.cases.length;
          if (!ablated) return reference.resolve(request);
          const source = corpus.cases.find(
            item => item.caseId === request.case.caseId
          )!;
          const counterfactual = corpus.cases.find(
            item => item.caseId === "c-aprendizado-alias-antes"
          )!;
          return {
            decisions: counterfactual.expected.decisions.map(
              (decision, index) =>
                buildDecisionForExpected(counterfactual, decision, index, {})
            ),
            operation: counterfactual.expected.operation,
            metrics: { latencyMs: 1, costUsd: 0 },
          };
        },
      },
      pinned
    );
    expect(report.gate.status).toBe("blocked");
    expect(report.learningScenarios[0].passed).toBe(false);
  });

  it("bloqueia escrita fora da aquisição em qualquer partição", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:escrita-fora-da-aquisicao",
        revision: "1",
        async resolve(request) {
          if (request.case.caseId === "c-panco-pao-forma") {
            try {
              await request.knowledge.write("indevido", "x");
            } catch {
              // A tentativa é registrada mesmo assim.
            }
          }
          return reference.resolve(request);
        },
      },
      pinned
    );
    expect(report.integrity.status).toBe("invalid");
    expect(report.integrity.knowledgeWritesOutside.length).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
  });

  it("registra escrita tardia: timer depois do passo não escapa da janela", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:escrita-tardia",
        revision: "1",
        async resolve(request) {
          if (request.case.scenario.phase === "restart") {
            const gate = request.knowledge;
            setTimeout(() => {
              void gate.write("alias:tardio", "x").catch(() => {});
            }, 0);
          }
          return reference.resolve(request);
        },
      },
      pinned
    );
    expect(report.integrity.knowledgeWritesAfterStep.length).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
  });

  it("colhe a escrita mesmo quando o resolvedor lança depois de tentar escrever", async () => {
    const report = await runGoldenFoodCorpus(
      {
        id: "test:escrita-e-erro",
        revision: "1",
        async resolve(request) {
          if (request.case.caseId === "c-panco-pao-forma") {
            try {
              await request.knowledge.write("indevido", "x");
            } catch {
              // ignora
            }
            throw new Error("falha depois da tentativa de escrita");
          }
          return createReferenceResolver(corpus).resolve(request);
        },
      },
      pinned
    );
    expect(report.integrity.knowledgeWritesOutside.length).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
  });

  it("trata getter que lança como falha declarada e ainda produz veredito", async () => {
    // Ataque da auditoria: expor getter que lança em `decisions`, `operation` ou
    // `metrics`. A leitura do resultado não pode abortar a medição: o caso é
    // falha declarada e o gate continua sendo produzido, fail-closed.
    const reference = createReferenceResolver(corpus);
    for (const field of ["decisions", "operation", "metrics"] as const) {
      const report = await runGoldenFoodCorpus(
        {
          id: `test:getter-lanca-${field}`,
          revision: "1",
          async resolve(request) {
            const result = await reference.resolve(request);
            const hostile = { ...result } as Record<string, unknown>;
            Object.defineProperty(hostile, field, {
              get() {
                throw new Error(`getter ${field} falhou`);
              },
              enumerable: true,
              configurable: true,
            });
            return hostile as typeof result;
          },
        },
        pinned
      );
      expect(report.gate.status).toBe("blocked");
      expect(report.caseCount).toBe(corpus.cases.length);
      expect(
        report.failures.some(failure =>
          failure.codes.includes("resolver_error")
        )
      ).toBe(true);
    }
  });

  it("entrega a entrada sanitizada congelada em profundidade", async () => {
    // Ataque da auditoria: mutar a lista aninhada de isenções para contaminar a
    // estrutura compartilhada entre casos e cenários (§18).
    const reference = createReferenceResolver(corpus);
    const observed: {
      listFrozen: boolean;
      itemFrozen: boolean;
      pushFailed: boolean;
      mutated: boolean;
    }[] = [];
    await runGoldenFoodCorpus(
      {
        id: "test:entrada-congelada",
        revision: "1",
        async resolve(request) {
          const tokens = request.case.input.nonQuantityTokens as unknown as {
            token: string;
            reason: string;
          }[];
          const item = tokens[0];
          const record = {
            listFrozen: Object.isFrozen(tokens),
            itemFrozen: item ? Object.isFrozen(item) : true,
            pushFailed: false,
            mutated: false,
          };
          try {
            tokens.push({ token: "injetado", reason: "probe" });
          } catch {
            record.pushFailed = true;
          }
          if (item) {
            try {
              item.token = "mutado";
            } catch {
              // estrito: lança
            }
          }
          record.mutated =
            tokens.some(entry => entry.token === "injetado") ||
            (item !== undefined && item.token === "mutado");
          observed.push(record);
          return reference.resolve(request);
        },
      },
      pinned
    );
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(entry => entry.listFrozen)).toBe(true);
    expect(observed.every(entry => entry.itemFrozen)).toBe(true);
    expect(observed.every(entry => entry.pushFailed)).toBe(true);
    expect(observed.every(entry => !entry.mutated)).toBe(true);
  });

  it("mascara número formatado de identificação em qualquer grafia", () => {
    const comTexto = (text: string) =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(item =>
          item.caseId === "c-aprendizado-alias-definido"
            ? { ...item, input: { ...item.input, text } }
            : item
        ),
      });
    const material = (text: string) =>
      inspectCorpusIntegrity(comTexto(text)).invalidCases.some(item =>
        item.message.includes("não pode ficar")
      );
    // Telefone/CEP formatados: o número inteiro é identificação, não porção.
    expect(material("telefone 22 22222-2222")).toBe(false);
    expect(material("cep 22222-222")).toBe(false);
    expect(material("telefone (11) 91234-5678")).toBe(false);
    expect(material("celular ２２ ２２２２２-２２２２")).toBe(false);
    expect(material("cep ٢٢٢٢٢-٢٢٢")).toBe(false);
    expect(material("telefone २२ २२२२२-२२२२")).toBe(false);
    // Sem marcador de identificação, a mesma forma continua material.
    expect(material("2 2 maçãs")).toBe(true);
    // Porção material depois do identificador não é escondida.
    expect(material("cep 22222-222 e 2 fatias")).toBe(true);
    expect(material("telefone 11 2222 2 maçãs")).toBe(true);
    expect(material("cep 22222-222 3 fatias")).toBe(true);
    expect(material("cpf 222.222.222-22 2 porções")).toBe(true);
    expect(material("telefone 11 2222 2 maçãs 3 bananas")).toBe(true);
  });

  it("reconhece contexto não-material em dígitos Unicode", () => {
    const comTexto = (text: string) =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(item =>
          item.caseId === "c-aprendizado-alias-definido"
            ? { ...item, input: { ...item.input, text } }
            : item
        ),
      });
    const material = (text: string) =>
      inspectCorpusIntegrity(comTexto(text)).invalidCases.some(item =>
        item.message.includes("não pode ficar")
      );
    // Versão/identificador não é quantidade consumida — em nenhuma grafia.
    expect(material("arroz versão 2")).toBe(false);
    expect(material("arroz versão ２")).toBe(false);
    expect(material("arroz versão ٢")).toBe(false);
    // Mas a mesma grafia em contexto material continua sendo quantidade.
    expect(material("arroz ２ xícaras")).toBe(true);
    expect(material("arroz ٢ xícaras")).toBe(true);
  });

  it("entrega a fachada congelada e imune à substituição de métodos", async () => {
    // Ataque da auditoria: substituir `knowledge.write` por função própria,
    // gravar em memória privada e escapar da instrumentação.
    const reference = createReferenceResolver(corpus);
    const observations: { frozen: boolean; replaced: boolean }[] = [];
    const report = await runGoldenFoodCorpus(
      {
        id: "test:fachada-imutavel",
        revision: "1",
        async resolve(request) {
          const gate = request.knowledge as unknown as {
            write: unknown;
            mode: string;
          };
          observations.push({ frozen: Object.isFrozen(gate), replaced: false });
          try {
            gate.write = async () => undefined;
          } catch {
            // Em módulo estrito a escrita lança; se não lançar, não altera.
          }
          observations[observations.length - 1].replaced =
            gate.write !== undefined &&
            (gate.write as { name?: string }).name === "";
          return reference.resolve(request);
        },
      },
      pinned
    );
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every(item => item.frozen)).toBe(true);
    expect(observations.every(item => !item.replaced)).toBe(true);
    expect(report.gate.status).toBe("passed");
  });

  it("recusa quantidade declarada com dígitos decimais Unicode", () => {
    const comTexto = (text: string) =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(item =>
          item.caseId === "c-aprendizado-alias-definido"
            ? { ...item, input: { ...item.input, text } }
            : item
        ),
      });
    const material = (text: string) =>
      inspectCorpusIntegrity(comTexto(text)).invalidCases.some(item =>
        item.message.includes("não pode ficar")
      );
    // Fullwidth e arábico-índico são dígitos decimais: quantidade material.
    expect(material("２ maçãs")).toBe(true);
    expect(material("٢ تفاحة")).toBe(true);
    expect(material("٣ fatias de pão")).toBe(true);
    expect(material("3 fatias de pão")).toBe(true);
  });

  it("registra na origem a recusa, sem depender de colheita posterior", async () => {
    // Ataque da auditoria: escrever numa promise encadeada, de modo que a
    // recusa aconteça depois da última colheita do passo. A violação é gravada
    // pela própria fachada no instante da recusa, então não existe janela.
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:promise-encadeada",
        revision: "1",
        async resolve(request) {
          const gate = request.knowledge;
          void Promise.resolve().then(() =>
            Promise.resolve().then(() =>
              gate.write("alias:promise-encadeada", "x").catch(() => {})
            )
          );
          return reference.resolve(request);
        },
      },
      pinned
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
    expect(report.integrity.knowledgeWritesOutside.length).toBeGreaterThan(0);
  });

  it("não permite apagar a evidência viva para reverter o veredito", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:evidencia-imutavel",
        revision: "1",
        async resolve(request) {
          await request.knowledge
            .write("alias:evidencia", "x")
            .catch(() => undefined);
          return reference.resolve(request);
        },
      },
      pinned
    );
    expect(report.gate.status).toBe("blocked");
    // A evidência exposta é cópia derivada: mutá-la não altera o veredito.
    const view = report.integrity.knowledgeWritesOutside as {
      caseId: string;
      writes: string[];
    }[];
    view.splice(0, view.length);
    expect(report.integrity.knowledgeWritesOutside.length).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.integrity.status).toBe("invalid");
    // A visão é somente leitura: não pode ser substituída.
    expect(() => {
      Object.defineProperty(report.integrity, "knowledgeWritesOutside", {
        value: [],
        configurable: true,
      });
    }).toThrow();
  });

  it("aplica a política de efeitos na ablação, inclusive por getter e por timer", async () => {
    const reference = createReferenceResolver(corpus);
    const scenarioSteps = corpus.learningScenarios.reduce(
      (total, scenario) => total + scenario.steps.length,
      0
    );
    const threshold = corpus.cases.length + scenarioSteps;
    let calls = 0;
    const report = await runGoldenFoodCorpus(
      {
        id: "test:ablacao-efeitos",
        revision: "1",
        async resolve(request) {
          calls += 1;
          const result = await reference.resolve(request);
          if (calls > threshold) {
            // Execução ablacionada: escrever por getter e agendar escrita.
            setTimeout(() => {
              void request.knowledge
                .write("indevido:ablacao", "x")
                .catch(() => {});
            }, 200);
            return {
              ...result,
              get metrics() {
                void request.knowledge
                  .write("indevido:ablacao-getter", "x")
                  .catch(() => {});
                return { latencyMs: 1, costUsd: 0 };
              },
            };
          }
          return result;
        },
      },
      pinned
    );
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
    // A recusa na ablação é registrada na origem — como tentativa fora da
    // aquisição ou como escrita posterior ao passo fechado.
    expect(
      report.integrity.knowledgeWritesOutside.length +
        report.integrity.knowledgeWritesAfterStep.length
    ).toBeGreaterThan(0);
  });

  it("recusa contra-factual de ablação com operação divergente", async () => {
    const reference = createReferenceResolver(corpus);
    const scenarioSteps = corpus.learningScenarios.reduce(
      (total, scenario) => total + scenario.steps.length,
      0
    );
    const threshold = corpus.cases.length + scenarioSteps;
    let calls = 0;
    const report = await runGoldenFoodCorpus(
      {
        id: "test:ablacao-operacao",
        revision: "1",
        async resolve(request) {
          calls += 1;
          const result = await reference.resolve(request);
          if (calls > threshold && result.operation) {
            // Decisões corretas, operação errada: a ablação não pode aprovar.
            return {
              ...result,
              operation: { ...result.operation, date: "2099-12-31" },
            };
          }
          return result;
        },
      },
      pinned
    );
    expect(report.learningScenarios.some(scenario => !scenario.passed)).toBe(
      true
    );
    expect(report.gate.status).toBe("blocked");
  });

  it("invalida o veredito mesmo quando a escrita tardia dispara após o relatório", async () => {
    // Ataque da auditoria: agendar a escrita com atraso maior que a drenagem,
    // de modo que ela só aconteça depois de `runCorpus` retornar. O veredito é
    // lido como estado corrente e a evidência é viva: continua bloqueado.
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:escrita-pos-relatorio",
        revision: "1",
        async resolve(request) {
          if (request.case.scenario.phase === "restart") {
            const gate = request.knowledge;
            setTimeout(() => {
              void gate.write("alias:tardio-longo", "x").catch(() => {});
            }, 300);
          }
          return reference.resolve(request);
        },
      },
      pinned
    );
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
    expect(report.integrity.knowledgeWritesAfterStep.length).toBeGreaterThan(0);
  });

  it("colhe efeito disparado por getter de metrics durante a leitura do resultado", async () => {
    // Ataque da auditoria: escrever no getter de `metrics`, depois da colheita
    // do passo, quando o resultado já seria considerado limpo.
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:getter-metrics",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          const gate = request.knowledge;
          return {
            ...result,
            get metrics() {
              void gate.write("alias:getter", "x").catch(() => {});
              return { latencyMs: 1, costUsd: 0 };
            },
          };
        },
      },
      pinned
    );
    expect(report.integrity.knowledgeWritesOutside.length).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
  });

  it("observa escrita fora da aquisição na execução ablacionada", async () => {
    // Ataque da auditoria: detectar a ablação e escrever conhecimento nos
    // passos posteriores, devolvendo as saídas corretas. A ablação aplica a
    // mesma política de efeitos da medição.
    const reference = createReferenceResolver(corpus);
    let calls = 0;
    const report = await runGoldenFoodCorpus(
      {
        id: "test:ablacao-com-escrita",
        revision: "1",
        async resolve(request) {
          calls += 1;
          if (calls > corpus.cases.length) {
            try {
              await request.knowledge.write("indevido:ablacao", "x");
            } catch {
              // A tentativa é registrada mesmo assim.
            }
          }
          return reference.resolve(request);
        },
      },
      pinned
    );
    expect(report.integrity.knowledgeWritesOutside.length).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
  });

  it("colhe a escrita do passo de cenário que falha depois de tentar escrever", async () => {
    const report = await runGoldenFoodCorpus(
      {
        id: "test:cenario-erro-apos-escrita",
        revision: "1",
        async resolve(request) {
          if (request.case.scenario.phase === "isolation") {
            try {
              await request.knowledge.write("indevido:cenario", "x");
            } catch {
              // ignora
            }
            throw new Error("falha depois da tentativa de escrita");
          }
          return createReferenceResolver(corpus).resolve(request);
        },
      },
      pinned
    );
    expect(report.integrity.knowledgeWritesOutside.length).toBeGreaterThan(0);
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain(
      "knowledge_write_outside_acquisition"
    );
  });

  it("não aceita isenção que esconde outra ocorrência material nem isenção decorativa", () => {
    const comTexto = (text: string, token: string) =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(item =>
          item.caseId === "c-aprendizado-alias-definido"
            ? {
                ...item,
                input: {
                  ...item.input,
                  text,
                  nonQuantityTokens: [
                    { token, reason: "número da linha do produto" },
                  ],
                },
              }
            : item
        ),
      });
    const invalido = (text: string, token: string) =>
      inspectCorpusIntegrity(comTexto(text, token)).status === "invalid";
    // Primeira ocorrência isentada, segunda material: continua inválido.
    expect(invalido("Marca 2 Café, depois 2 fatias", "2")).toBe(true);
    // Isenção de token que não ocorre é decorativa e não é aceita.
    expect(invalido("café", "9")).toBe(true);
    // Isenção corroborada por marcador explícito de identificação é aceita.
    expect(invalido("Coca-Cola linha 3", "3")).toBe(false);
  });

  it("não aceita isenção sem marcador nem isenção que atravessa superfícies", () => {
    // Ataque da auditoria: declarar o token como identificador numa superfície
    // e consumir a mesma quantidade em outra. A isenção só vale onde há
    // marcador explícito de não-quantidade; fora dele a ocorrência é material.
    const comSuperficies = (
      text: string,
      transcription: string | null,
      token: string
    ) =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(item =>
          item.caseId === "c-aprendizado-alias-definido"
            ? {
                ...item,
                input: {
                  ...item.input,
                  text,
                  transcription,
                  nonQuantityTokens: [
                    { token, reason: "número da linha do produto" },
                  ],
                },
              }
            : item
        ),
      });
    const invalido = (
      text: string,
      transcription: string | null,
      token: string
    ) => inspectCorpusIntegrity(comSuperficies(text, transcription, token));
    // Marcador na fala, quantidade material na transcrição: inválido.
    expect(invalido("Marca 2 Café", "2 maçãs", "2").status).toBe("invalid");
    // Isenção sem qualquer marcador visível: inválida.
    expect(invalido("Coca-Cola 3", "3 maçãs", "3").status).toBe("invalid");
    // Duas ocorrências do mesmo token com **uma** isenção: a segunda continua
    // material, porque cada isenção cobre uma única ocorrência.
    expect(invalido("Marca 2 Café", "linha 2 do produto", "2").status).toBe(
      "invalid"
    );
    // Uma única ocorrência corroborada por marcador é aceita.
    expect(invalido("Marca 2 Café", null, "2").status).toBe("valid");
  });

  it("exige isenção por ocorrência e reconhece numerais romanos I, V e X", () => {
    const comTexto = (
      text: string,
      nonQuantityTokens: { token: string; reason: string }[] = []
    ) =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(item =>
          item.caseId === "c-aprendizado-alias-definido"
            ? { ...item, input: { ...item.input, text, nonQuantityTokens } }
            : item
        ),
      });
    const material = (
      text: string,
      tokens: { token: string; reason: string }[] = []
    ) =>
      inspectCorpusIntegrity(comTexto(text, tokens)).invalidCases.some(item =>
        item.message.includes("não pode ficar")
      );
    // Uma isenção não esconde a segunda ocorrência material do mesmo token.
    expect(
      material("Marca 2 2 Café", [
        { token: "2", reason: "número da linha do produto" },
      ])
    ).toBe(true);
    // Numerais romanos I, V e X são quantidade declarada.
    expect(material("I maçã")).toBe(true);
    expect(material("V fatias de pão")).toBe(true);
    expect(material("X colheres de arroz")).toBe(true);
    // Isenção governada continua valendo para uma única ocorrência.
    expect(
      material("Marca 2 Café", [
        { token: "2", reason: "número da linha do produto" },
      ])
    ).toBe(false);
  });

  it("marca a integridade como inválida quando a referência canônica não é verificada", () => {
    const member = corpus.cases.find(
      item => item.equivalenceReference !== null
    )!;
    const forged = goldenCorpusSchema.parse({
      ...corpus,
      cases: corpus.cases.map(item =>
        item.caseId === member.caseId
          ? {
              ...item,
              equivalenceReference: {
                ...item.equivalenceReference!,
                adrSection: "§999",
              },
            }
          : item
      ),
    });
    const integrity = inspectCorpusIntegrity(forged);
    expect(integrity.reference.verified).toBe(false);
    // Quem consome apenas `status` não pode concluir "válido".
    expect(integrity.status).toBe("invalid");
  });

  it("reconhece quantidade material em frações, numerais e extenso, sem invalidar identificadores", () => {
    const comSuperficie = (text: string) =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(item =>
          item.caseId === "c-aprendizado-alias-definido"
            ? { ...item, input: { ...item.input, text } }
            : item
        ),
      });
    const declara = (text: string) =>
      inspectCorpusIntegrity(comSuperficie(text)).invalidCases.some(item =>
        item.message.includes("não pode ficar")
      );
    for (const material of [
      "½ maçã",
      "1/2 maçã",
      "II maçãs",
      "vinte maçãs",
      "meio prato de arroz",
      "duas colheres de arroz",
      "2 fatias de pão",
    ]) {
      expect(declara(material), material).toBe(true);
    }
    for (const naoMaterial of [
      "arroz versão 2",
      "sopa a 70°C",
      "3 vezes ao dia",
      "café",
    ]) {
      expect(declara(naoMaterial), naoMaterial).toBe(false);
    }
  });

  it("aceita isenção de token não-material e recusa isenção de porção", () => {
    const comIsencao = (text: string, token: string) =>
      goldenCorpusSchema.parse({
        ...corpus,
        cases: corpus.cases.map(item =>
          item.caseId === "c-aprendizado-alias-definido"
            ? {
                ...item,
                input: {
                  ...item.input,
                  text,
                  nonQuantityTokens: [
                    { token, reason: "número da linha do produto" },
                  ],
                },
              }
            : item
        ),
      });
    const declara = (
      corpusComIsencao: ReturnType<typeof goldenCorpusSchema.parse>
    ) =>
      inspectCorpusIntegrity(corpusComIsencao).invalidCases.some(item =>
        item.message.includes("não pode ficar")
      );
    expect(declara(comIsencao("Coca-Cola linha 3", "3"))).toBe(false);
    // Isenção adjacente a unidade/porção é recusada: `2 fatias` é material.
    expect(declara(comIsencao("2 fatias de pão", "2"))).toBe(true);
    // Isenção sem marcador explícito de identificação não é aceita.
    expect(declara(comIsencao("2 maçãs", "2"))).toBe(true);
    expect(declara(comIsencao("Coca-Cola 3", "3"))).toBe(true);
  });

  it("congela o relatório para que a evidência não seja adulterada", async () => {
    const report = await runGoldenFoodCorpus(
      createReferenceResolver(corpus),
      pinned
    );
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.gate)).toBe(true);
    expect(Object.isFrozen(report.overall)).toBe(true);
    expect(() => {
      (report.gate as { status: string }).status = "passed";
    }).toThrow();
  });
  it("detecta quantidade por extenso e não confunde versão com porção", () => {
    const comQuantidadePorExtenso = goldenCorpusSchema.parse({
      ...corpus,
      cases: corpus.cases.map(entry =>
        entry.caseId === "c-aprendizado-alias-definido"
          ? { ...entry, input: { ...entry.input, text: "uma maçã" } }
          : entry
      ),
    });
    const extenso = inspectCorpusIntegrity(comQuantidadePorExtenso);
    expect(extenso.status).toBe("invalid");
    expect(
      extenso.invalidCases.some(
        item => item.caseId === "c-aprendizado-alias-definido"
      )
    ).toBe(true);

    // Identificador/versão não é quantidade consumida: não pode invalidar um
    // caso legítimo nem esconder uma porção.
    const semQuantidade = goldenCorpusSchema.parse({
      ...corpus,
      cases: corpus.cases.map(entry =>
        entry.caseId === "c-aprendizado-alias-definido"
          ? { ...entry, input: { ...entry.input, text: "arroz versão 2" } }
          : entry
      ),
    });
    expect(inspectCorpusIntegrity(semQuantidade).status).toBe("valid");
  });

  it("trata métrica presente com valor nulo como inválida", async () => {
    const reference = createReferenceResolver(corpus);
    const report = await runGoldenFoodCorpus(
      {
        id: "test:metrica-nula",
        revision: "1",
        async resolve(request) {
          const result = await reference.resolve(request);
          return { ...result, metrics: null as never };
        },
      },
      pinned
    );
    expect(allCodes(report)).toContain("metrics_invalid");
    expect(report.overall.latencySamples).toBe(0);
  });

  it("reprova cenário em que a aquisição não é consultada depois", async () => {
    // Bypass apontado pela auditoria: escreve uma chave qualquer na aquisição,
    // nunca lê conhecimento e devolve a expectativa por caseId. As invariantes
    // same/different continuam satisfeitas — e mesmo assim precisa reprovar.
    const report = await runGoldenFoodCorpus(
      {
        id: "test:sem-consulta-de-conhecimento",
        revision: "1",
        async resolve({ case: entry, allowLearning, knowledge }) {
          if (allowLearning && knowledge.mode === "acquisition") {
            await knowledge.write("chave-inutil", "x");
          }
          const source = corpus.cases.find(
            item => item.caseId === entry.caseId
          )!;
          return {
            decisions: source.expected.decisions.map((decision, index) =>
              buildDecisionForExpected(source, decision, index, {})
            ),
            operation: source.expected.operation,
          };
        },
      },
      pinned
    );
    expect(report.gate.status).toBe("blocked");
    expect(report.gate.blockReasons).toContain("scenario_invariant_violated");
    expect(report.learningScenarios[0].passed).toBe(false);
    const details = report.learningScenarios[0].steps.flatMap(step =>
      step.failures.map(failure => failure.detail ?? "")
    );
    expect(
      details.some(detail => detail.includes("deveria consultar a chave"))
    ).toBe(true);
    expect(
      details.some(detail => detail.includes("deveria escrever a chave"))
    ).toBe(true);
  });
});
