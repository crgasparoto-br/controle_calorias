import { describe, expect, it } from "vitest";
import { evaluateWhatsappAutonomyPolicy, getWhatsappAutonomyPolicyRule } from "./autonomyPolicy";

describe("whatsapp autonomy policy", () => {
  it("permite registro alimentar simples com confianca suficiente", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intentName: "add_foods_to_meal",
      confidence: 0.88,
      requiresConfirmation: false,
      validationStatus: "valid",
    });

    expect(decision).toEqual(expect.objectContaining({
      level: "automatico",
      outcome: "execute",
      canExecute: true,
      needsConfirmation: false,
    }));
  });

  it("exige confirmacao quando registro simples estiver ambiguo ou incompleto", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intentName: "add_foods_to_meal",
      confidence: 0.88,
      requiresConfirmation: true,
      validationStatus: "valid",
    });

    expect(decision).toEqual(expect.objectContaining({
      level: "requer_confirmacao",
      outcome: "clarify",
      canExecute: false,
      needsConfirmation: true,
    }));
  });

  it("exige confirmacao para correcao de alimento mesmo com confianca alta", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intentName: "replace_food_in_meal",
      confidence: 0.93,
      requiresConfirmation: false,
      validationStatus: "valid",
    });

    expect(decision).toEqual(expect.objectContaining({
      level: "requer_confirmacao",
      outcome: "clarify",
      canExecute: false,
      needsConfirmation: true,
    }));
  });

  it("exige confirmacao forte para remocao de alimento", () => {
    const rule = getWhatsappAutonomyPolicyRule("excluir_alimento");
    const decision = evaluateWhatsappAutonomyPolicy({
      intentName: "excluir_alimento",
      confidence: 0.95,
      requiresConfirmation: false,
      validationStatus: "valida",
    });

    expect(rule.minimumConfidence).toBeGreaterThanOrEqual(0.9);
    expect(decision).toEqual(expect.objectContaining({
      level: "requer_confirmacao",
      outcome: "clarify",
      canExecute: false,
      needsConfirmation: true,
    }));
  });

  it("bloqueia execucao automatica quando validacao falha", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intentName: "adicionar_alimento",
      confidence: 0.98,
      requiresConfirmation: false,
      validationStatus: "invalida",
    });

    expect(decision).toEqual(expect.objectContaining({
      level: "bloqueado",
      outcome: "block",
      canExecute: false,
      needsConfirmation: true,
    }));
  });

  it("exige aceite explicito para alteracao de meta", () => {
    const rule = getWhatsappAutonomyPolicyRule("confirmar_alteracao_meta");
    const decision = evaluateWhatsappAutonomyPolicy({
      intentName: "confirmar_alteracao_meta",
      confidence: 0.96,
      requiresConfirmation: false,
      validationStatus: "valida",
    });

    expect(rule.minimumConfidence).toBe(0.95);
    expect(decision).toEqual(expect.objectContaining({
      level: "requer_confirmacao",
      outcome: "clarify",
      canExecute: false,
      needsConfirmation: true,
    }));
  });

  it("encaminha sugestao profissional sensivel para revisao", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intentName: "profissional_sugere_plano_alimentar",
      confidence: 0.94,
      requiresConfirmation: false,
      validationStatus: "valida",
      safetyLevel: "sensivel",
    });

    expect(decision).toEqual(expect.objectContaining({
      level: "requer_revisao",
      outcome: "review",
      canExecute: false,
      needsConfirmation: true,
    }));
  });
});
