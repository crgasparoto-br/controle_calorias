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
});
