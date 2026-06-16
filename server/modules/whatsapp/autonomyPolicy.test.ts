import { describe, expect, it } from "vitest";
import {
  evaluateWhatsappAutonomyPolicy,
  whatsappAutonomyPolicyByIntent,
} from "./autonomyPolicy";
import { canonicalWhatsappIntentNames } from "./canonicalIntentSchema";

describe("evaluateWhatsappAutonomyPolicy", () => {
  it("define uma regra de autonomia para cada intencao canonica", () => {
    expect(Object.keys(whatsappAutonomyPolicyByIntent).sort()).toEqual([...canonicalWhatsappIntentNames].sort());
  });

  it("permite registro simples apenas quando confianca e validacao sao suficientes", () => {
    const allowed = evaluateWhatsappAutonomyPolicy({
      intent: "registrar_alimento",
      confidence: 0.93,
      safetyLevel: "seguro",
      backendValidated: true,
      contextResolved: true,
    });
    const missingValidation = evaluateWhatsappAutonomyPolicy({
      intent: "registrar_alimento",
      confidence: 0.93,
      safetyLevel: "seguro",
      backendValidated: false,
      contextResolved: true,
    });

    expect(allowed).toEqual(expect.objectContaining({
      autonomyLevel: "automatico",
      outcome: "execute",
      minimumConfidence: 0.86,
      requiresBackendValidation: true,
    }));
    expect(missingValidation).toEqual(expect.objectContaining({
      autonomyLevel: "requer_revisao",
      outcome: "review",
      reason: "Acao exige validacao de backend antes de execucao automatica.",
    }));
  });

  it("exige confirmacao para correcao de alimento mesmo com alta confianca", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intent: "corrigir_alimento",
      confidence: 0.91,
      safetyLevel: "seguro",
      backendValidated: true,
      contextResolved: true,
    });

    expect(decision).toEqual(expect.objectContaining({
      autonomyLevel: "requer_confirmacao",
      outcome: "confirm",
      requiresExplicitAcceptance: true,
      reason: "Acao exige aceite ou confirmacao explicita.",
    }));
  });

  it("exige confirmacao explicita para remocao de alimento", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intent: "excluir_alimento",
      confidence: 0.9,
      safetyLevel: "seguro",
      backendValidated: true,
      contextResolved: true,
    });

    expect(decision).toEqual(expect.objectContaining({
      autonomyLevel: "requer_confirmacao",
      outcome: "confirm",
      requiresExplicitAcceptance: true,
    }));
  });

  it("encaminha alteracao de meta para revisao mesmo com aceite explicito", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intent: "confirmar_alteracao_meta",
      confidence: 0.94,
      safetyLevel: "requer_cautela",
      backendValidated: true,
      contextResolved: true,
      explicitAcceptance: true,
    });

    expect(decision).toEqual(expect.objectContaining({
      autonomyLevel: "requer_revisao",
      outcome: "review",
      requiresReview: true,
    }));
  });

  it("encaminha sugestao profissional para revisao e aceite do paciente", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intent: "profissional_sugere_plano_alimentar",
      confidence: 0.89,
      safetyLevel: "requer_cautela",
      backendValidated: true,
      contextResolved: true,
      explicitAcceptance: false,
    });

    expect(decision).toEqual(expect.objectContaining({
      autonomyLevel: "requer_revisao",
      outcome: "review",
      requiresExplicitAcceptance: true,
      requiresReview: true,
    }));
  });

  it("bloqueia possivel urgencia de saude sem depender de confianca", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intent: "possivel_urgencia_saude",
      confidence: 0.99,
      safetyLevel: "bloqueado",
    });

    expect(decision).toEqual(expect.objectContaining({
      autonomyLevel: "bloqueado",
      outcome: "block",
      requiresReview: true,
      reason: "Conteudo classificado como bloqueado pela camada de seguranca.",
    }));
  });

  it("rebaixa acao ambigua para confirmacao antes de executar", () => {
    const decision = evaluateWhatsappAutonomyPolicy({
      intent: "adicionar_alimento",
      confidence: 0.91,
      safetyLevel: "seguro",
      backendValidated: true,
      contextResolved: true,
      hasAmbiguity: true,
    });

    expect(decision).toEqual(expect.objectContaining({
      autonomyLevel: "requer_confirmacao",
      outcome: "confirm",
      reason: "Ambiguidade detectada exige confirmacao antes de executar.",
    }));
  });
});
