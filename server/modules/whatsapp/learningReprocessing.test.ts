import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappLearningReprocessingForTests,
  listWhatsappReprocessingRuns,
  reprocessWhatsappValidatedExamples,
  type WhatsappValidatedExample,
} from "./learningReprocessing";

function output(overrides: Partial<WhatsappValidatedExample["previousOutput"]> = {}): WhatsappValidatedExample["previousOutput"] {
  return {
    intent: "add_foods_to_meal",
    action: "llm_intent_add_foods_to_meal",
    persisted: true,
    confidence: 0.82,
    calibratedConfidence: 0.8,
    entities: { foods: ["banana"], quantity: 1 },
    blocked: false,
    needsClarification: false,
    quality: "pass",
    ...overrides,
  };
}

function example(overrides: Partial<WhatsappValidatedExample> = {}): WhatsappValidatedExample {
  return {
    id: "case-1",
    input: "comi 1 banana",
    expectedIntent: "add_foods_to_meal",
    expectedAction: "llm_intent_add_foods_to_meal",
    expectedPersisted: true,
    source: "regression_dataset",
    isGolden: true,
    previousVersion: "whatsapp-global-rules/v1",
    previousOutput: output(),
    ...overrides,
  };
}

describe("whatsapp learning reprocessing", () => {
  beforeEach(() => {
    __resetWhatsappLearningReprocessingForTests();
  });

  it("reprocessa exemplos validados com nova regra ou prompt", () => {
    const run = reprocessWhatsappValidatedExamples({
      candidateName: "prompt-v2",
      oldVersion: "whatsapp-prompt/v1",
      newVersion: "whatsapp-prompt/v2",
      reason: "Validar prompt candidato antes da promocao.",
      examples: [example()],
      runExample: current => current.previousOutput,
      createdAt: new Date("2026-06-16T15:00:00.000Z"),
    });

    expect(run).toEqual(expect.objectContaining({
      createdAt: "2026-06-16T15:00:00.000Z",
      candidateName: "prompt-v2",
      examplesTotal: 1,
      changedCount: 0,
      decision: "approve",
      reviewRequired: false,
    }));
    expect(run.results[0]).toEqual(expect.objectContaining({ changed: false, decision: "approve" }));
  });

  it("compara resultado anterior e novo com diferencas estruturadas", () => {
    const run = reprocessWhatsappValidatedExamples({
      candidateName: "schema-v2",
      oldVersion: "whatsapp-intent-schema/v1",
      newVersion: "whatsapp-intent-schema/v2",
      reason: "Comparar entidades extraidas.",
      examples: [example()],
      runExample: () => output({ entities: { foods: ["banana prata"], quantity: 1 }, confidence: 0.65, calibratedConfidence: 0.63 }),
    });

    expect(run.changedCount).toBe(1);
    expect(run.results[0].differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "entity_changed", field: "entities", impact: "medium" }),
      expect.objectContaining({ type: "confidence_changed", field: "confidence", impact: "medium" }),
      expect.objectContaining({ type: "calibrated_confidence_changed", field: "calibratedConfidence", impact: "medium" }),
    ]));
    expect(run.decision).toBe("shadow");
  });

  it("destaca regressoes em exemplos golden", () => {
    const run = reprocessWhatsappValidatedExamples({
      candidateName: "rule-v2",
      oldVersion: "whatsapp-global-rules/v1",
      newVersion: "whatsapp-global-rules/v2",
      reason: "Validar regra candidata.",
      examples: [example()],
      runExample: () => output({ intent: "unknown", action: "none", persisted: false, quality: "fail" }),
    });

    expect(run.regressionCount).toBe(1);
    expect(run.highImpactCount).toBe(1);
    expect(run.reviewRequired).toBe(true);
    expect(run.decision).toBe("reject");
    expect(run.results[0]).toEqual(expect.objectContaining({
      regression: true,
      highImpact: true,
      reason: "Regressao detectada em exemplo validado.",
      decision: "reject",
    }));
    expect(run.results[0].differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "intent_changed", impact: "blocking" }),
      expect.objectContaining({ type: "regression", impact: "blocking" }),
    ]));
  });

  it("exige revisao quando ha impacto relevante sem regressao direta", () => {
    const run = reprocessWhatsappValidatedExamples({
      candidateName: "parser-v2",
      oldVersion: "whatsapp-parser/v1",
      newVersion: "whatsapp-parser/v2",
      reason: "Parser muda acao sem perder intencao.",
      examples: [example({ requiresReview: true })],
      runExample: () => output({ action: "ask_confirmation", persisted: true, quality: "pass" }),
    });

    expect(run.changedCount).toBe(1);
    expect(run.regressionCount).toBe(0);
    expect(run.highImpactCount).toBe(1);
    expect(run.reviewRequired).toBe(true);
    expect(run.decision).toBe("review");
    expect(run.results[0].differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "action_changed", impact: "high" }),
    ]));
  });

  it("registra resultado do reprocessamento com impacto por intencao e decisao final", () => {
    const run = reprocessWhatsappValidatedExamples({
      candidateName: "mixed-candidate",
      oldVersion: "v1",
      newVersion: "v2",
      reason: "Avaliar lote misto.",
      examples: [
        example({ id: "case-1", previousOutput: output({ quality: "fail", confidence: 0.4, calibratedConfidence: 0.38 }) }),
        example({ id: "case-2", previousOutput: output({ intent: "daily_summary", action: "daily_summary", persisted: false, entities: {}, quality: "pass" }), expectedIntent: "daily_summary", expectedAction: "daily_summary", expectedPersisted: false }),
      ],
      runExample: current => current.id === "case-1" ? output({ quality: "pass", confidence: 0.78, calibratedConfidence: 0.76 }) : current.previousOutput,
    });

    expect(run.improvementCount).toBe(1);
    expect(run.decision).toBe("shadow");
    expect(run.impactByIntent).toEqual(expect.objectContaining({
      add_foods_to_meal: expect.objectContaining({ total: 1, changed: 1, improvements: 1 }),
      daily_summary: expect.objectContaining({ total: 1, changed: 0 }),
    }));
    expect(listWhatsappReprocessingRuns()).toEqual([expect.objectContaining({ id: run.id, candidateName: "mixed-candidate" })]);
  });
});
