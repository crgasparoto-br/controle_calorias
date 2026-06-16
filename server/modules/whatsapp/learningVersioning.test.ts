import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappLearningVersioningForTests,
  activateWhatsappVersionedArtifact,
  buildWhatsappDecisionVersionSnapshot,
  buildWhatsappVersionedDecisionTrace,
  getActiveWhatsappVersion,
  listWhatsappVersionedArtifacts,
  listWhatsappVersioningAuditEvents,
  registerWhatsappVersionedArtifact,
  rollbackWhatsappVersionedArtifact,
} from "./learningVersioning";

describe("whatsapp learning versioning", () => {
  beforeEach(() => {
    __resetWhatsappLearningVersioningForTests();
  });

  it("registra regra global com versao, origem, confianca, responsavel e motivo", () => {
    const artifact = registerWhatsappVersionedArtifact({
      category: "global_rule",
      version: "whatsapp-global-rules/v2",
      origin: "review-queue:414",
      confidence: 0.86,
      responsible: "curadoria",
      reason: "Regra aprovada por governanca e replay offline.",
      status: "active",
      governanceCandidateId: 443,
      metadata: { sourceIssue: 415 },
      createdAt: new Date("2026-06-16T14:00:00.000Z"),
    });

    expect(artifact).toEqual(expect.objectContaining({
      category: "global_rule",
      version: "whatsapp-global-rules/v2",
      origin: "review-queue:414",
      confidence: 0.86,
      responsible: "curadoria",
      reason: "Regra aprovada por governanca e replay offline.",
      status: "active",
      activatedAt: "2026-06-16T14:00:00.000Z",
      governanceCandidateId: 443,
    }));
    expect(getActiveWhatsappVersion("global_rule").version).toBe("whatsapp-global-rules/v2");
  });

  it("identifica prompt, taxonomia, schema e politicas ativas em cada decisao", () => {
    registerWhatsappVersionedArtifact({ category: "prompt", version: "whatsapp-prompt/v3", origin: "governance", confidence: 0.9, responsible: "admin", reason: "Prompt aprovado.", status: "active" });
    registerWhatsappVersionedArtifact({ category: "structured_schema", version: "whatsapp-intent-schema/v2", origin: "technical-review", confidence: 0.95, responsible: "tech", reason: "Schema validado.", status: "active" });
    registerWhatsappVersionedArtifact({ category: "confidence_calibrator", version: "confidence-calibrator/v2", origin: "metrics", confidence: 0.82, responsible: "metrics", reason: "Calibrador aprovado." , status: "active" });

    const snapshot = buildWhatsappDecisionVersionSnapshot({
      createdAt: new Date("2026-06-16T14:10:00.000Z"),
      modelName: "gpt-test",
      parserVersion: "whatsapp-llm",
    });

    expect(snapshot).toEqual(expect.objectContaining({
      createdAt: "2026-06-16T14:10:00.000Z",
      promptVersion: "whatsapp-prompt/v3",
      intentTaxonomyVersion: "whatsapp-intent-taxonomy/v1",
      schemaVersion: "whatsapp-intent-schema/v2",
      confidenceCalibratorVersion: "confidence-calibrator/v2",
      riskThresholdPolicyVersion: "risk-threshold-policy/v1",
      promotionPolicyVersion: "learning-promotion-policy/v1",
      governancePolicyVersion: "whatsapp-learning-governance/v1",
      explanationTemplateVersion: "decision-explanation-template/v1",
      modelName: "gpt-test",
      parserVersion: "whatsapp-llm",
    }));
  });

  it("permite saber qual versao interpretou uma mensagem", () => {
    const snapshot = buildWhatsappDecisionVersionSnapshot({
      modelName: "gpt-test",
      parserVersion: "whatsapp-rule-engine",
      overrides: { globalRuleVersion: "whatsapp-global-rules/v7" },
    });
    const trace = buildWhatsappVersionedDecisionTrace({
      messageHistoryId: 123,
      userId: 42,
      intent: "add_foods_to_meal",
      action: "llm_intent_add_foods_to_meal",
      snapshot,
    });

    expect(trace).toEqual(expect.objectContaining({
      messageHistoryId: 123,
      userId: 42,
      intent: "add_foods_to_meal",
      action: "llm_intent_add_foods_to_meal",
    }));
    expect(trace.interpretedBy).toEqual(expect.objectContaining({
      promptVersion: "whatsapp-prompt/v1",
      schemaVersion: "whatsapp-intent-schema/v1",
      globalRuleVersion: "whatsapp-global-rules/v7",
      modelName: "gpt-test",
      parserVersion: "whatsapp-rule-engine",
    }));
  });

  it("desativa e reverte regra global problematica", () => {
    registerWhatsappVersionedArtifact({ category: "global_rule", version: "whatsapp-global-rules/v1", origin: "baseline", confidence: 1, responsible: "system", reason: "Baseline segura.", status: "active" });
    registerWhatsappVersionedArtifact({ category: "global_rule", version: "whatsapp-global-rules/v2", origin: "promotion", confidence: 0.8, responsible: "admin", reason: "Promocao inicial.", status: "draft" });
    activateWhatsappVersionedArtifact({ category: "global_rule", version: "whatsapp-global-rules/v2", responsible: "admin", reason: "Ativar versao promovida." });

    const rollback = rollbackWhatsappVersionedArtifact({
      category: "global_rule",
      version: "whatsapp-global-rules/v2",
      rollbackToVersion: "whatsapp-global-rules/v1",
      responsible: "tech",
      reason: "Regressao detectada no replay.",
      rolledBackAt: new Date("2026-06-16T14:20:00.000Z"),
    });

    expect(rollback?.rolledBack).toEqual(expect.objectContaining({
      version: "whatsapp-global-rules/v2",
      status: "rolled_back",
      rollbackToVersion: "whatsapp-global-rules/v1",
      deactivatedAt: "2026-06-16T14:20:00.000Z",
    }));
    expect(rollback?.restored).toEqual(expect.objectContaining({
      version: "whatsapp-global-rules/v1",
      status: "active",
      activatedAt: "2026-06-16T14:20:00.000Z",
    }));
  });

  it("gera historico auditavel para alteracoes relevantes", () => {
    registerWhatsappVersionedArtifact({ category: "promotion_policy", version: "learning-promotion-policy/v2", origin: "governance", confidence: 0.88, responsible: "admin", reason: "Politica revisada.", status: "draft" });
    activateWhatsappVersionedArtifact({ category: "promotion_policy", version: "learning-promotion-policy/v2", responsible: "admin", reason: "Ativar politica revisada." });
    buildWhatsappDecisionVersionSnapshot();

    expect(listWhatsappVersionedArtifacts({ category: "promotion_policy" })).toEqual([
      expect.objectContaining({ version: "learning-promotion-policy/v2", status: "active" }),
    ]);
    expect(listWhatsappVersioningAuditEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "registered", category: "promotion_policy", version: "learning-promotion-policy/v2" }),
      expect.objectContaining({ type: "activated", category: "promotion_policy", version: "learning-promotion-policy/v2" }),
      expect.objectContaining({ type: "snapshot_created" }),
    ]));
  });
});
