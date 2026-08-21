import { describe, expect, it } from "vitest";
import {
  calibrateWhatsappConfidence,
  compareWhatsappCalibrationVersions,
  measureWhatsappCalibrationAccuracy,
  WHATSAPP_CONFIDENCE_CALIBRATION_POLICY,
  type WhatsappCalibrationVersionContext,
} from "./confidenceCalibration";

const versions: WhatsappCalibrationVersionContext = {
  promptVersion: "whatsapp-prompt/v1",
  schemaVersion: "whatsapp-intent-schema/v1",
  modelName: "gpt-test",
  ruleVersion: "whatsapp-global-rules/v1",
  calibratorVersion: "confidence-calibrator/v1",
  thresholdPolicyVersion: "risk-threshold-policy/v1",
};

describe("whatsapp confidence calibration", () => {
  it("documenta confianca bruta, calibrada, thresholds e integracoes", () => {
    expect(WHATSAPP_CONFIDENCE_CALIBRATION_POLICY).toEqual(expect.objectContaining({
      rawConfidence: expect.stringContaining("Valor retornado"),
      calibratedConfidence: expect.stringContaining("Confianca ajustada"),
      thresholds: expect.objectContaining({
        simple_food_record: 0.74,
        removal: 0.9,
        goal_change: 0.95,
        rule_promotion: 0.95,
      }),
      integrations: expect.objectContaining({
        backendValidation: "#412",
        metrics: "#417",
        drift: "#431",
        knowledgeValidity: "#434",
        autonomy: "#436",
        negativeEvaluation: "#441",
      }),
    }));
  });

  it("permite acao simples quando confianca calibrada alta passa o threshold", () => {
    const result = calibrateWhatsappConfidence({
      rawConfidence: 0.92,
      observedAccuracy: 0.9,
      sampleSize: 80,
      confidenceKind: "final_action",
      intent: "add_foods_to_meal",
      inputType: "text",
      actionRisk: "simple_food_record",
      versions,
    });

    expect(result.calibratedConfidence).toBeGreaterThanOrEqual(result.threshold);
    expect(result.decision).toBe("allow");
    expect(result.lowSample).toBe(false);
    expect(result.recalibrationRequired).toBe(false);
  });

  it("exige esclarecimento ou revisao quando confianca bruta alta calibra baixo", () => {
    const result = calibrateWhatsappConfidence({
      rawConfidence: 0.91,
      observedAccuracy: 0.42,
      sampleSize: 60,
      confidenceKind: "intent",
      intent: "replace_food_in_meal",
      inputType: "text",
      actionRisk: "correction",
      versions,
    });

    expect(result.rawConfidence).toBe(0.91);
    expect(result.calibratedConfidence).toBeLessThan(result.threshold);
    expect(["clarify", "review"]).toContain(result.decision);
  });

  it("usa thresholds diferentes entre registrar alimento, remover alimento e alterar meta", () => {
    const simple = calibrateWhatsappConfidence({ rawConfidence: 0.9, observedAccuracy: 0.9, sampleSize: 50, confidenceKind: "final_action", intent: "add_foods_to_meal", inputType: "text", actionRisk: "simple_food_record", versions });
    const removal = calibrateWhatsappConfidence({ rawConfidence: 0.9, observedAccuracy: 0.9, sampleSize: 50, confidenceKind: "final_action", intent: "replace_food_in_meal", inputType: "text", actionRisk: "removal", versions });
    const goal = calibrateWhatsappConfidence({ rawConfidence: 0.9, observedAccuracy: 0.9, sampleSize: 50, confidenceKind: "final_action", intent: "unknown", inputType: "text", actionRisk: "goal_change", versions });

    expect(simple.threshold).toBeLessThan(removal.threshold);
    expect(removal.threshold).toBeLessThan(goal.threshold);
    expect(simple.decision).toBe("allow");
    expect(goal.decision).not.toBe("allow");
  });

  it("usa fallback conservador para modalidade com baixa amostra", () => {
    const result = calibrateWhatsappConfidence({
      rawConfidence: 0.96,
      observedAccuracy: 0.92,
      sampleSize: 4,
      confidenceKind: "entity",
      intent: "add_foods_to_meal",
      inputType: "image_caption",
      actionRisk: "persistent_tool",
      versions,
    });

    expect(result.lowSample).toBe(true);
    expect(result.conservativeFallback).toBe(true);
    expect(result.decision).toBe("review");
    expect(result.reason).toContain("Amostra insuficiente");
  });

  it("troca de versao marca recalibracao necessaria antes de promocao ampla", () => {
    const activeVersions = { ...versions, promptVersion: "whatsapp-prompt/v2" };
    const result = calibrateWhatsappConfidence({
      rawConfidence: 0.97,
      observedAccuracy: 0.95,
      sampleSize: 100,
      confidenceKind: "final_action",
      intent: "add_foods_to_meal",
      inputType: "text",
      actionRisk: "rule_promotion",
      versions,
      activeVersions,
    });
    const comparison = compareWhatsappCalibrationVersions({ previous: versions, current: activeVersions });

    expect(result.recalibrationRequired).toBe(true);
    expect(result.decision).toBe("review");
    expect(comparison).toEqual(expect.objectContaining({
      recalibrationRequired: true,
      changed: expect.arrayContaining(["promptVersion"]),
    }));
  });

  it("mede acerto por faixa de confianca, intencao, modalidade e versao", () => {
    const metrics = measureWhatsappCalibrationAccuracy([
      { id: "1", createdAt: "2026-06-16T15:00:00.000Z", intent: "add_foods_to_meal", inputType: "text", actionRisk: "simple_food_record", confidenceKind: "intent", rawConfidence: 0.91, wasCorrect: true, falsePositive: false, falseNegative: false, laterCorrection: false, unnecessaryClarification: false, versions },
      { id: "2", createdAt: "2026-06-16T15:01:00.000Z", intent: "add_foods_to_meal", inputType: "text", actionRisk: "simple_food_record", confidenceKind: "intent", rawConfidence: 0.88, wasCorrect: false, falsePositive: true, falseNegative: false, laterCorrection: true, unnecessaryClarification: false, versions },
      { id: "3", createdAt: "2026-06-16T15:02:00.000Z", intent: "ambiguous", inputType: "audio_transcript", actionRisk: "persistent_tool", confidenceKind: "final_action", rawConfidence: 0.62, wasCorrect: true, falsePositive: false, falseNegative: false, laterCorrection: false, unnecessaryClarification: true, versions },
    ]);

    expect(metrics).toEqual(expect.objectContaining({
      total: 3,
      correct: 2,
      falsePositive: 1,
      laterCorrections: 1,
      unnecessaryClarifications: 1,
      observedAccuracy: 0.67,
    }));
    expect(metrics.byBand["0.85-0.94"]).toEqual(expect.objectContaining({ total: 2, correct: 1, observedAccuracy: 0.5 }));
    expect(metrics.byBand["0.50-0.69"]).toEqual(expect.objectContaining({ total: 1, correct: 1, observedAccuracy: 1 }));
  });
});
