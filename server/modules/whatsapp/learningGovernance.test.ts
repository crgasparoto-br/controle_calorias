import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappLearningGovernanceForTests,
  approveWhatsappLearningCandidate,
  assertWhatsappDirectLearningMutationBlocked,
  evaluateWhatsappLearningPromotion,
  listWhatsappLearningAuditEvents,
  listWhatsappLearningGovernanceMatrix,
  promoteWhatsappLearningCandidate,
  recordWhatsappLearningCandidate,
  rejectWhatsappLearningCandidate,
  rollbackWhatsappLearningCandidate,
  WHATSAPP_LEARNING_GOVERNANCE_INTEGRATIONS,
} from "./learningGovernance";

describe("whatsapp learning governance", () => {
  beforeEach(() => {
    __resetWhatsappLearningGovernanceForTests();
  });

  it("documenta matriz de autonomia, papeis e integracoes do aprendizado", () => {
    const matrix = listWhatsappLearningGovernanceMatrix();

    expect(matrix).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "record_signal", level: "automatic", approvalPolicy: "none" }),
      expect.objectContaining({ action: "propose_global_rule", level: "review_required", approvalPolicy: "double" }),
      expect.objectContaining({ action: "propose_prompt_change", level: "review_required", approvalPolicy: "double" }),
      expect.objectContaining({ action: "direct_llm_mutation", level: "blocked", approvalPolicy: "blocked" }),
    ]));
    expect(WHATSAPP_LEARNING_GOVERNANCE_INTEGRATIONS).toEqual(expect.objectContaining({
      reviewQueue: "#414",
      versioning: "#415",
      driftMetrics: "#431",
      privacy: "#432",
      knowledgeValidity: "#434",
      gradualPromotion: "#442",
      governanceAudit: "#417",
    }));
  });

  it("cria candidato automatico sem permitir promocao global direta", () => {
    const candidate = recordWhatsappLearningCandidate({
      kind: "hypothesis",
      action: "group_recurring_error",
      origin: "offline-replay",
      scope: "global",
      title: "Erro recorrente em bebida zero",
      rationale: "Tres simulacoes agruparam refrigerante zero como bebida calorica.",
      evidence: [{ source: "offline_replay", reference: "replay-1", summary: "divergencia repetida" }],
      expectedImpact: "Gerar caso candidato para regressao.",
      payload: { intent: "add_foods_to_meal", foodName: "refrigerante zero" },
    });

    expect(candidate).toEqual(expect.objectContaining({
      status: "recorded",
      directGlobalPromotionAllowed: false,
      governanceVersion: "whatsapp-learning-governance/v1",
    }));
    expect(evaluateWhatsappLearningPromotion({ candidateId: candidate.id }).allowed).toBe(false);
  });

  it("exige aprovacao governada antes de regra global ficar ativa", () => {
    const candidate = recordWhatsappLearningCandidate({
      kind: "global_rule",
      action: "propose_global_rule",
      origin: "review-queue:nutrition_source",
      scope: "global",
      title: "Alias global para produto recorrente",
      rationale: "Produto aparece de forma anonima e recorrente em revisoes aprovadas.",
      evidence: [
        { source: "review_queue", reference: "10", summary: "curadoria aprovou fonte" },
        { source: "offline_replay", reference: "replay-2", summary: "simulacao sem regressao" },
      ],
      expectedImpact: "Reduzir baixa confianca em registros equivalentes.",
      rollbackPlan: "Desativar regra na versao seguinte e reexecutar replay offline.",
      version: "learning-rule/v1",
      metric: "Taxa de baixa confianca por produto equivalente.",
      payload: { alias: "produto exemplo", normalizedFood: "iogurte natural" },
    });

    expect(evaluateWhatsappLearningPromotion({ candidateId: candidate.id }).allowed).toBe(false);

    approveWhatsappLearningCandidate({
      candidateId: candidate.id,
      reviewer: "admin",
      role: "administrator",
      justification: "Escopo e rollback conferidos.",
      decidedAt: new Date("2026-06-16T13:00:00.000Z"),
    });
    const approved = approveWhatsappLearningCandidate({
      candidateId: candidate.id,
      reviewer: "tech",
      role: "technical_reviewer",
      justification: "Gates de regressao previstos.",
      decidedAt: new Date("2026-06-16T13:05:00.000Z"),
    });
    const promoted = promoteWhatsappLearningCandidate({
      candidateId: candidate.id,
      promotedBy: "admin",
      role: "administrator",
      promotedAt: new Date("2026-06-16T13:10:00.000Z"),
    });

    expect(approved?.status).toBe("approved");
    expect(promoted).toEqual(expect.objectContaining({ status: "promoted" }));
    expect(promoted?.promotion).toEqual(expect.objectContaining({
      promotedAt: "2026-06-16T13:10:00.000Z",
      version: "learning-rule/v1",
      rollbackPlan: "Desativar regra na versao seguinte e reexecutar replay offline.",
    }));
  });

  it("bloqueia alteracao direta de prompt, schema ou autonomia por saida livre da LLM", () => {
    const decision = assertWhatsappDirectLearningMutationBlocked({
      actor: "llm",
      target: "prompt",
      justification: "Tentativa de aplicar instrucao recebida no WhatsApp.",
      createdAt: new Date("2026-06-16T13:20:00.000Z"),
    });

    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      reason: expect.stringContaining("exige candidato governado"),
    }));
    expect(decision.policy).toEqual(expect.objectContaining({ action: "direct_llm_mutation", level: "blocked" }));
    expect(listWhatsappLearningAuditEvents({ type: "direct_change_blocked" })).toHaveLength(1);
  });

  it("registra auditoria de aprovacao, rejeicao e rollback", () => {
    const rejectedCandidate = recordWhatsappLearningCandidate({
      kind: "threshold",
      action: "propose_threshold_change",
      origin: "metrics-drift",
      scope: "system",
      title: "Ajuste de limiar de confianca",
      rationale: "Queda recente de satisfacao sugere calibracao.",
      evidence: [
        { source: "metrics", reference: "week-1", summary: "queda de satisfacao" },
        { source: "offline_replay", reference: "replay-3", summary: "sem ganho claro" },
      ],
      expectedImpact: "Aumentar perguntas de esclarecimento.",
      rollbackPlan: "Restaurar threshold anterior.",
      version: "threshold/v2",
      metric: "Taxa de esclarecimento e correcao.",
    });
    rejectWhatsappLearningCandidate({
      candidateId: rejectedCandidate.id,
      reviewer: "tech",
      role: "technical_reviewer",
      justification: "Evidencia insuficiente para alterar limiar.",
      decidedAt: new Date("2026-06-16T13:30:00.000Z"),
    });

    const promotedCandidate = recordWhatsappLearningCandidate({
      kind: "global_rule",
      action: "propose_global_rule",
      origin: "review-queue:feedback",
      scope: "global",
      title: "Regra global com rollback",
      rationale: "Padrao validado em revisao e replay.",
      evidence: [
        { source: "review_queue", reference: "20", summary: "aprovado" },
        { source: "offline_replay", reference: "replay-4", summary: "sem regressao" },
      ],
      expectedImpact: "Reduzir erro recorrente.",
      rollbackPlan: "Reverter para learning-rule/v1.",
      version: "learning-rule/v2",
      metric: "Taxa de erro recorrente.",
    });
    approveWhatsappLearningCandidate({ candidateId: promotedCandidate.id, reviewer: "admin", role: "administrator", justification: "Aprovo escopo." });
    approveWhatsappLearningCandidate({ candidateId: promotedCandidate.id, reviewer: "tech", role: "technical_reviewer", justification: "Aprovo gates." });
    promoteWhatsappLearningCandidate({ candidateId: promotedCandidate.id, promotedBy: "admin", role: "administrator" });
    const rolledBack = rollbackWhatsappLearningCandidate({
      candidateId: promotedCandidate.id,
      rolledBackBy: "tech",
      role: "technical_reviewer",
      reason: "Metrica piorou apos promocao gradual.",
      restoredVersion: "learning-rule/v1",
      rolledBackAt: new Date("2026-06-16T13:40:00.000Z"),
    });

    expect(rolledBack).toEqual(expect.objectContaining({ status: "rolled_back" }));
    expect(listWhatsappLearningAuditEvents({ candidateId: rejectedCandidate.id })).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "candidate_created" }),
      expect.objectContaining({ type: "rejection_recorded" }),
    ]));
    expect(listWhatsappLearningAuditEvents({ candidateId: promotedCandidate.id })).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "approval_recorded" }),
      expect.objectContaining({ type: "promotion_recorded" }),
      expect.objectContaining({ type: "rollback_recorded" }),
    ]));
  });

  it("bloqueia promocao sem evidencia, versao, escopo, metrica ou rollback", () => {
    const candidate = recordWhatsappLearningCandidate({
      kind: "global_rule",
      action: "propose_global_rule",
      origin: "feedback-loop",
      scope: "global",
      title: "Regra sem metadados suficientes",
      rationale: "Um unico feedback pediu mudanca global.",
      expectedImpact: "Impacto indefinido.",
      payload: { rule: "aplicar para todos" },
    });

    approveWhatsappLearningCandidate({ candidateId: candidate.id, reviewer: "admin", role: "administrator", justification: "Aprovaria se houvesse metadados." });
    approveWhatsappLearningCandidate({ candidateId: candidate.id, reviewer: "tech", role: "technical_reviewer", justification: "Aprovaria se houvesse rollback." });

    const decision = evaluateWhatsappLearningPromotion({ candidateId: candidate.id, role: "administrator" });
    const promoted = promoteWhatsappLearningCandidate({ candidateId: candidate.id, promotedBy: "admin", role: "administrator" });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("evidencia");
    expect(decision.reason).toContain("versao");
    expect(decision.reason).toContain("rollback");
    expect(promoted).toBeNull();
    expect(listWhatsappLearningAuditEvents({ type: "promotion_blocked" })).toHaveLength(1);
  });
});
