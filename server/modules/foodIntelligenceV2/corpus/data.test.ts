import { describe, expect, it } from "vitest";
import {
  CORPUS_LEARNING_PHASES,
  GOLDEN_CORPUS_SCHEMA_VERSION,
  GOLDEN_CORPUS_VERSION,
  CORPUS_SPLITS,
  goldenCorpusSchema,
} from "./contracts";
import { goldenFoodCorpus } from "./data";
import { inspectCorpusIntegrity } from "./harness";

const caseIds = new Set(goldenFoodCorpus.cases.map(entry => entry.caseId));

/** Casos obrigatórios de §16: incidentes históricos já conhecidos. */
const REQUIRED_HISTORICAL_INCIDENTS = [
  "c-panco-pao-forma",
  "c-wickbold-pao-forma",
  "c-pao-marca-numero-fatias",
  "c-amendoim-rotulo",
  "c-cerveja-imagem",
  "c-leite-uht-integral",
  "c-pera-packham",
  "c-maca-fuji",
  "c-mortadela-1-5-virgula",
  "c-mortadela-1-5-ponto",
  "c-mortadela-uma-fatia-e-meia",
  "c-ovo-frito",
  "c-melao-cultivar",
  "c-coca-cola-lata",
  "c-cerveja-original-garrafa",
  "c-cafe-sem-acucar-memoria",
  "c-multiplos-um-ambiguo",
  "c-destino-refeicao-leading",
  "c-erro-transcricao",
  "c-produto-marca-sem-nutricao",
  "c-provider-indisponivel",
];

/** Casos adicionais obrigatórios de linguagem, lote e negativos (§16). */
const REQUIRED_LANGUAGE_AND_BATCH = [
  "c-acento-ausente",
  "c-abreviacao-col",
  "c-regionalismo-bergamota",
  "c-erro-digitacao-recorrente",
  "c-porcao-tiquinho",
  "c-porcao-punhado",
  "c-porcao-pratao",
  "c-banco-ambiguo-pao",
  "c-lote-valido-e-nao-alimento",
  "c-operacao-data-refeicao-destino",
  "c-neg-oleo-de-motor",
  "c-neg-pasta-de-dente",
  "c-neg-agua-sanitaria",
  "c-neg-cosmetico",
  "c-neg-rotulo-nao-alimentar",
  "c-neg-ingredientes-rotulo",
  "c-neg-ocr-instrucao",
  "c-neg-imagem-ilegivel",
];

/** Casos de materialidade de atributos (§8.3). */
const REQUIRED_MATERIALITY = [
  "c-leite-integral",
  "c-leite-desnatado",
  "c-leite-uht-generico",
  "c-iogurte-morango",
  "c-iogurte-natural",
  "c-refrigerante-zero",
  "c-refrigerante-comum",
  "c-arroz-embalagem",
  "c-leite-marca-informacional",
  "c-superficie-nova-mesma-familia",
];

/** Cenários de aprendizado/generalização e conjunto reservado (§16.1). */
const REQUIRED_LEARNING = [
  "c-aprendizado-alias-antes",
  "c-aprendizado-alias-definido",
  "c-aprendizado-alias-reuso",
  "c-aprendizado-sem-intervencao-desnecessaria",
  "c-aprendizado-persistencia-restart",
  "c-aprendizado-isolamento-outro-usuario",
  "c-aprendizado-precedencia-explicita",
  "c-aprendizado-revogacao",
  "c-aprendizado-controle-negativo-alias",
];

describe("Golden Food Corpus", () => {
  it("carrega com a versão e o schema correntes", () => {
    expect(goldenFoodCorpus.schemaVersion).toBe(GOLDEN_CORPUS_SCHEMA_VERSION);
    expect(goldenFoodCorpus.corpusVersion).toBe(GOLDEN_CORPUS_VERSION);
    expect(goldenFoodCorpus.locale).toBe("pt-BR");
    expect(goldenCorpusSchema.safeParse(goldenFoodCorpus).success).toBe(true);
  });

  it("cobre todos os incidentes históricos obrigatórios de §16", () => {
    const missing = REQUIRED_HISTORICAL_INCIDENTS.filter(
      id => !caseIds.has(id)
    );
    expect(missing).toStrictEqual([]);
  });

  it("cobre os casos adicionais obrigatórios de linguagem, lote e negativos", () => {
    const missing = REQUIRED_LANGUAGE_AND_BATCH.filter(id => !caseIds.has(id));
    expect(missing).toStrictEqual([]);
  });

  it("cobre os casos de materialidade de atributos de §8.3", () => {
    const missing = REQUIRED_MATERIALITY.filter(id => !caseIds.has(id));
    expect(missing).toStrictEqual([]);
  });

  it("cobre os cenários de aprendizado e o conjunto reservado de §16.1", () => {
    const missing = REQUIRED_LEARNING.filter(id => !caseIds.has(id));
    expect(missing).toStrictEqual([]);
  });

  it("separa aquisição, calibração e holdout", () => {
    const splits = new Set(goldenFoodCorpus.cases.map(entry => entry.split));
    expect([...splits].sort()).toStrictEqual([...CORPUS_SPLITS].sort());
  });

  it("cobre todas as modalidades exigidas por §16", () => {
    const modalities = new Set(
      goldenFoodCorpus.cases.map(entry => entry.modality)
    );
    expect([...modalities].sort()).toStrictEqual([
      "audio_transcript",
      "image",
      "multimodal",
      "text",
    ]);
  });

  it("declara referência independente para todo grupo metamórfico", () => {
    const offenders = goldenFoodCorpus.cases
      .filter(entry => entry.metamorphicGroup && !entry.equivalenceReference)
      .map(entry => entry.caseId);
    expect(offenders).toStrictEqual([]);
  });

  it("cobre as classes de não-recorrência relevantes da matriz de §9.3", () => {
    const classes = new Set(
      goldenFoodCorpus.cases.flatMap(entry => entry.nonRecurrenceClasses)
    );
    expect([...classes].sort()).toStrictEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
    ]);
  });

  it("mantém integridade estrutural: sem duplicatas, vazamento ou grupo inválido", () => {
    const integrity = inspectCorpusIntegrity(goldenFoodCorpus);
    expect(integrity.duplicateCaseIds).toStrictEqual([]);
    expect(integrity.duplicateSurfaces).toStrictEqual([]);
    expect(integrity.splitLeakage).toStrictEqual([]);
    expect(integrity.undeclaredEquivalence).toStrictEqual([]);
    expect(integrity.invalidGroups).toStrictEqual([]);
    expect(integrity.divergentGroupExpectations).toStrictEqual([]);
    expect(integrity.invalidScenarios).toStrictEqual([]);
    expect(integrity.negativeControlConflicts).toStrictEqual([]);
    expect(integrity.invalidCases).toStrictEqual([]);
    expect(integrity.status).toBe("valid");
  });

  it("declara pelo menos um cenário de §16.1 e cobre todas as fases", () => {
    expect(goldenFoodCorpus.learningScenarios.length).toBeGreaterThanOrEqual(1);
    for (const scenario of goldenFoodCorpus.learningScenarios) {
      const phases = new Set(scenario.steps.map(step => step.phase));
      for (const phase of CORPUS_LEARNING_PHASES) {
        expect(phases.has(phase)).toBe(true);
      }
      // A referência é governada: só a fonte canônica pode declarar
      // equivalência, e ela aponta a seção que a declara.
      expect(scenario.reference.declaredBy).toBe(
        "adr-food-intelligence-resolver-v2"
      );
      expect(scenario.reference.adrSection).toMatch(/^§\d+/);
    }
  });

  it("permite escrita apenas na fase de aquisição", () => {
    for (const scenario of goldenFoodCorpus.learningScenarios) {
      for (const step of scenario.steps) {
        expect(step.writesAllowed).toBe(step.phase === "acquisition");
      }
    }
  });

  it("declara continuidade nos casos de cenário de aprendizado", () => {
    const offenders = goldenFoodCorpus.cases
      .filter(entry => entry.learningScenarioId !== null)
      .filter(entry => entry.continuity !== "continues_context")
      .map(entry => entry.caseId);
    expect(offenders).toStrictEqual([]);
  });

  it("declara a implementação errada plausível de cada controle negativo", () => {
    const controls = goldenFoodCorpus.cases.filter(
      entry => entry.negativeControlOf !== null
    );
    expect(controls.length).toBeGreaterThanOrEqual(6);
    for (const control of controls) {
      expect(control.negativeControlHypothesis).not.toBeNull();
      expect((control.negativeControlHypothesis ?? "").length).toBeGreaterThan(
        10
      );
    }
  });

  it("declara alternativas esperadas sempre que exige preservação", () => {
    for (const entry of goldenFoodCorpus.cases) {
      for (const expected of entry.expected.decisions) {
        if (expected.ambiguity.mustPreserveAlternatives) {
          expect(expected.alternatives.length).toBeGreaterThanOrEqual(2);
          expect(expected.alternatives.length).toBeGreaterThanOrEqual(
            expected.ambiguity.minAlternatives
          );
        } else {
          expect(expected.alternatives).toStrictEqual([]);
        }
      }
    }
  });

  it("usa presença explícita: decisão que não propõe proíbe identidade e quantidade", () => {
    for (const entry of goldenFoodCorpus.cases) {
      for (const expected of entry.expected.decisions) {
        if (expected.nextAction === "propose") {
          expect(expected.identity.presence).toBe("expected");
          expect(
            ["provenance_declared", "provisional_declared"].includes(
              expected.nutrition.requirement
            )
          ).toBe(true);
          continue;
        }
        if (expected.status === "unknown" || expected.nextAction === "reject") {
          expect(expected.identity.presence).toBe("forbidden");
          expect(expected.quantity.presence).toBe("forbidden");
        } else {
          expect(expected.quantity.presence).not.toBe("expected");
        }
        expect(expected.nutrition.requirement).toBe("absent");
      }
    }
  });

  it("declara restrição de origem nutricional onde a procedência é material", () => {
    // Onde a origem muda a decisão (memória pessoal, versão zero, produto de
    // marca sem rótulo legível), o caso precisa declarar a restrição — do
    // contrário o harness não teria como reprovar procedência indevida.
    for (const caseId of [
      "c-cafe-sem-acucar-memoria",
      "c-refrigerante-zero",
      "c-produto-marca-sem-nutricao",
    ]) {
      const entry = goldenFoodCorpus.cases.find(item => item.caseId === caseId);
      expect(entry).toBeDefined();
      const declared = (entry?.expected.decisions ?? []).some(
        expected =>
          expected.nutrition.allowedOrigins.length > 0 ||
          expected.nutrition.forbiddenOrigins.length > 0 ||
          expected.nutrition.provisionalRequired ||
          expected.nutrition.genericProfileMustNotBeVerified
      );
      expect(declared).toBe(true);
    }
  });

  it("possui denominador rotulado de casos resolvíveis para a meta de §1.1", () => {
    const resolvable = goldenFoodCorpus.cases.filter(
      entry => entry.decisionClass === "resolvable"
    );
    expect(resolvable.length).toBeGreaterThan(0);
    expect(resolvable.length).toBeLessThan(goldenFoodCorpus.cases.length);
  });

  it("declara controles negativos e casos de clarificação/rejeição", () => {
    const controls = goldenFoodCorpus.cases.filter(
      entry => entry.negativeControlOf !== null
    );
    const clarification = goldenFoodCorpus.cases.filter(
      entry => entry.decisionClass === "clarification"
    );
    const rejection = goldenFoodCorpus.cases.filter(
      entry => entry.decisionClass === "rejection"
    );
    expect(controls.length).toBeGreaterThanOrEqual(6);
    expect(clarification.length).toBeGreaterThanOrEqual(6);
    expect(rejection.length).toBeGreaterThanOrEqual(6);
  });

  it("não usa dados reais, PII ou mídia real", () => {
    for (const entry of goldenFoodCorpus.cases) {
      expect(entry.input.imageRef ?? "").not.toMatch(/^https?:/);
      expect(entry.scenario.ownerRef).toMatch(/^owner-/);
      expect(entry.scenario.conversationRef).toMatch(/^conv-/);
    }
  });
});
