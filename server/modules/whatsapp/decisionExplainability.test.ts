import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappDecisionExplainabilityForTests,
  listWhatsappDecisionExplanations,
  recordWhatsappDecisionExplanation,
  WHATSAPP_DECISION_EXPLAINABILITY_POLICY,
  type WhatsappDecisionExplanationInput,
} from "./decisionExplainability";

const versions: WhatsappDecisionExplanationInput["versions"] = {
  promptVersion: "whatsapp-prompt/v1",
  schemaVersion: "whatsapp-intent-schema/v1",
  modelName: "gpt-test",
  ruleVersion: "whatsapp-global-rules/v1",
  calibratorVersion: "confidence-calibrator/v1",
  thresholdPolicyVersion: "risk-threshold-policy/v1",
  nutritionSourceVersion: "food-catalog/v1",
  toolVersion: "meal-tool/v1",
  qualityGateVersion: "whatsapp-ai-quality-gates/v1",
};

function input(overrides: Partial<WhatsappDecisionExplanationInput> = {}): WhatsappDecisionExplanationInput {
  return {
    messageId: "msg-1",
    decisionId: "decision-1",
    createdAt: new Date("2026-06-16T19:00:00.000Z"),
    inputExcerpt: "comi 1 banana no cafe da manha",
    intent: "add_foods_to_meal",
    rawConfidence: 0.92,
    calibrated: { calibratedConfidence: 0.88, threshold: 0.74, decision: "allow", reason: "Confianca calibrada atende ao threshold do risco." },
    autonomy: "automatic",
    outcome: "saved",
    operationalReason: "Alimento, quantidade e refeicao foram identificados com fonte nutricional rastreavel.",
    factors: [
      { kind: "llm", label: "classificador", summary: "Intencao alimentar detectada.", version: "whatsapp-prompt/v1", weight: "high" },
      { kind: "nutrition_source", label: "catalogo interno", summary: "Fonte especifica encontrada para banana.", version: "food-catalog/v1", weight: "high" },
      { kind: "confidence", label: "calibracao", summary: "Confianca calibrada acima do threshold.", version: "confidence-calibrator/v1", weight: "medium" },
    ],
    rejectedAlternatives: [],
    versions,
    ...overrides,
  };
}

describe("whatsapp decision explainability", () => {
  beforeEach(() => {
    __resetWhatsappDecisionExplainabilityForTests();
  });

  it("documenta politica e integracoes de explicabilidade", () => {
    expect(WHATSAPP_DECISION_EXPLAINABILITY_POLICY).toEqual(expect.objectContaining({
      rawMessageStored: false,
      audiences: expect.arrayContaining(["support", "admin", "curator", "technical"]),
      integrations: expect.objectContaining({
        initialProtection: "#410",
        structuredHistory: "#411",
        backendValidation: "#412",
        metrics: "#417",
        regressionManagement: "#433",
        structuredPrompt: "#438",
        observability: "#440",
        governance: "#443",
        confidenceCalibration: "#445",
        qualityGates: "#446",
      }),
    }));
  });

  it("explica registro alimentar automatico com fonte nutricional rastreavel", () => {
    const explanation = recordWhatsappDecisionExplanation(input());

    expect(explanation).toEqual(expect.objectContaining({
      id: 1,
      createdAt: "2026-06-16T19:00:00.000Z",
      outcome: "saved",
      intent: "add_foods_to_meal",
      calibratedConfidence: 0.88,
      threshold: 0.74,
      policyVersion: "whatsapp-decision-explainability/v1",
    }));
    expect(explanation.summary).toContain("saved: intencao add_foods_to_meal");
    expect(explanation.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "nutrition_source", version: "food-catalog/v1" }),
    ]));
  });

  it("explica pergunta que nao deve salvar alimento", () => {
    const explanation = recordWhatsappDecisionExplanation(input({
      messageId: "msg-question",
      decisionId: "decision-question",
      inputExcerpt: "banana tem potassio?",
      intent: "nutrition_question",
      rawConfidence: 0.86,
      calibrated: null,
      autonomy: "clarification_required",
      outcome: "answered_without_saving",
      operationalReason: "Mensagem e pergunta nutricional, nao registro alimentar.",
      factors: [
        { kind: "deterministic_rule", label: "pergunta nutricional", summary: "Interrogacao sobre nutriente sem acao de persistencia.", version: "whatsapp-global-rules/v1", weight: "high" },
      ],
      rejectedAlternatives: [
        { label: "registrar banana", rejectedBecause: "Mensagem pede informacao, nao declara consumo.", riskAvoided: "Evita falso positivo alimentar." },
      ],
    }));

    expect(explanation.outcome).toBe("answered_without_saving");
    expect(explanation.rejectedAlternatives).toEqual([expect.objectContaining({ label: "registrar banana" })]);
  });

  it("registra bloqueio por baixa confianca ou autonomia incompatível", () => {
    const explanation = recordWhatsappDecisionExplanation(input({
      messageId: "msg-blocked",
      decisionId: "decision-blocked",
      rawConfidence: 0.51,
      calibrated: { calibratedConfidence: 0.42, threshold: 0.9, decision: "review", reason: "Confianca calibrada abaixo do threshold do risco." },
      autonomy: "blocked",
      outcome: "blocked",
      operationalReason: "Remocao de alimento exigia confirmacao e confianca calibrada suficiente.",
      factors: [
        { kind: "autonomy", label: "acao destrutiva", summary: "Remocao sem confirmacao nao e permitida.", version: "whatsapp-learning-governance/v1", weight: "blocking" },
        { kind: "confidence", label: "threshold", summary: "Confianca calibrada abaixo do minimo para remocao.", version: "confidence-calibrator/v1", weight: "blocking" },
      ],
    }));

    expect(explanation.outcome).toBe("blocked");
    expect(explanation.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ weight: "blocking", kind: "autonomy" }),
    ]));
    expect(explanation.operationalReason).toContain("confirmacao");
  });

  it("explica uso de memoria individual sem expor conteudo sensivel", () => {
    const explanation = recordWhatsappDecisionExplanation(input({
      messageId: "msg-memory",
      decisionId: "decision-memory",
      inputExcerpt: "sou Maria 11999998888 e comi meu cafe padrao",
      factors: [
        { kind: "individual_memory", label: "alias individual", summary: "Memoria individual indicou refeicao preferida sem virar regra global.", version: "whatsapp-learning-controls/v1", weight: "medium" },
      ],
      operationalReason: "Memoria individual ajudou a resolver alias pessoal no escopo do usuario.",
    }));

    expect(explanation.inputExcerpt).toBe("[conteudo minimizado por privacidade]");
    expect(explanation.privacy).toEqual({ minimized: true, directIdentifierRemoved: true, rawMessageStored: false });
    expect(explanation.factors[0]).toEqual(expect.objectContaining({ kind: "individual_memory" }));
  });

  it("explica fallback por ferramenta indisponivel ou schema invalido", () => {
    const explanation = recordWhatsappDecisionExplanation(input({
      messageId: "msg-fallback",
      decisionId: "decision-fallback",
      outcome: "fallback",
      autonomy: "review_required",
      operationalReason: "Ferramenta de persistencia indisponivel; resposta segura sem salvar foi usada.",
      factors: [
        { kind: "tool", label: "meal-tool", summary: "Ferramenta retornou indisponibilidade temporaria.", version: "meal-tool/v1", weight: "blocking" },
        { kind: "backend_validation", label: "schema", summary: "Schema invalido impediu chamada persistente.", version: "whatsapp-intent-schema/v1", weight: "blocking" },
      ],
      rejectedAlternatives: [
        { label: "persistir mesmo assim", rejectedBecause: "Backend nao validou schema/ferramenta.", riskAvoided: "Evita escrita inconsistente." },
      ],
    }));

    expect(explanation.outcome).toBe("fallback");
    expect(explanation.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool", weight: "blocking" }),
      expect.objectContaining({ kind: "backend_validation", weight: "blocking" }),
    ]));
  });

  it("mantem auditoria de decisao antiga usando versao substituida", () => {
    const old = recordWhatsappDecisionExplanation(input({
      messageId: "msg-old",
      decisionId: "decision-old",
      versions: { ...versions, ruleVersion: "whatsapp-global-rules/v0", nutritionSourceVersion: "food-catalog/v0" },
      factors: [
        { kind: "global_rule", label: "regra antiga", summary: "Regra v0 foi aplicada antes do rollback.", version: "whatsapp-global-rules/v0", weight: "high" },
      ],
    }));

    expect(old.versions).toEqual(expect.objectContaining({
      ruleVersion: "whatsapp-global-rules/v0",
      nutritionSourceVersion: "food-catalog/v0",
    }));
    expect(listWhatsappDecisionExplanations({ messageId: "msg-old" })).toEqual([expect.objectContaining({ decisionId: "decision-old" })]);
  });
});
