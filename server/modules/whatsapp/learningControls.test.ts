import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappLearningControlsForTests,
  disableWhatsappIndividualMemory,
  evaluateWhatsappLearningUse,
  getWhatsappLearningPreference,
  listWhatsappIndividualMemories,
  recordWhatsappIndividualMemory,
  setWhatsappLearningPreference,
  WHATSAPP_LEARNING_CONTROLS_POLICY,
} from "./learningControls";

describe("whatsapp learning controls", () => {
  beforeEach(() => {
    __resetWhatsappLearningControlsForTests();
  });

  it("documenta separacao entre operacional, auditoria, memoria individual e aprendizado global", () => {
    expect(WHATSAPP_LEARNING_CONTROLS_POLICY).toEqual(expect.objectContaining({
      dataScopes: expect.objectContaining({
        operational: expect.stringContaining("processar a conversa"),
        audit: expect.stringContaining("auditoria"),
        individual_memory: expect.stringContaining("Personalizacao individual"),
        global_anonymized_learning: expect.stringContaining("Sinal anonimizado"),
      }),
      operationalAndAuditAlwaysPreserved: true,
      directGlobalPromotionAllowed: false,
      integrations: expect.objectContaining({
        initialProtection: "#410",
        feedbackLoop: "#430",
        privacy: "#432",
        regressionManagement: "#433",
        governance: "#443",
        security: "#444",
        labelingProtocol: "#448",
      }),
    }));
  });

  it("permite dataset global anonimizado quando preferencia esta ativa", () => {
    const preference = setWhatsappLearningPreference({
      userId: 10,
      individualMemoryEnabled: true,
      globalAnonymizedLearningEnabled: true,
      source: "settings_screen",
      appliedAt: new Date("2026-06-16T18:00:00.000Z"),
      notes: "Usuario aceitou contribuir com aprendizado anonimo.",
    });
    const global = evaluateWhatsappLearningUse({ userId: 10, scope: "global_anonymized_learning", evaluatedAt: new Date("2026-06-16T18:05:00.000Z") });
    const memory = recordWhatsappIndividualMemory({ userId: 10, key: "preferred_breakfast", summary: "Usuario costuma chamar cafe da manha de cafe.", createdAt: new Date("2026-06-16T18:06:00.000Z") });

    expect(preference).toEqual(expect.objectContaining({
      appliedAt: "2026-06-16T18:00:00.000Z",
      preferenceVersion: "whatsapp-learning-controls/v1",
    }));
    expect(global).toEqual(expect.objectContaining({
      decision: "allowed",
      canFeedDataset: true,
      canCreateGlobalCandidate: true,
      canUpdateIndividualMemory: false,
      operationalTracePreserved: true,
    }));
    expect(memory).toEqual(expect.objectContaining({ status: "active", controlVersion: "whatsapp-learning-controls/v1" }));
  });

  it("bloqueia dataset e candidato global quando preferencia global esta desativada", () => {
    setWhatsappLearningPreference({
      userId: 11,
      globalAnonymizedLearningEnabled: false,
      source: "whatsapp",
      appliedAt: new Date("2026-06-16T18:10:00.000Z"),
    });

    const global = evaluateWhatsappLearningUse({ userId: 11, scope: "global_anonymized_learning" });
    const operational = evaluateWhatsappLearningUse({ userId: 11, scope: "operational" });
    const audit = evaluateWhatsappLearningUse({ userId: 11, scope: "audit" });

    expect(global).toEqual(expect.objectContaining({
      decision: "blocked",
      canFeedDataset: false,
      canCreateGlobalCandidate: false,
      reason: expect.stringContaining("desativou contribuicao"),
    }));
    expect(operational).toEqual(expect.objectContaining({ decision: "allowed", operationalTracePreserved: true }));
    expect(audit).toEqual(expect.objectContaining({ decision: "audit_only", operationalTracePreserved: true }));
  });

  it("bloqueia criacao de memoria individual quando preferencia individual esta desativada", () => {
    setWhatsappLearningPreference({
      userId: 12,
      individualMemoryEnabled: false,
      source: "settings_screen",
    });

    const decision = evaluateWhatsappLearningUse({ userId: 12, scope: "individual_memory" });
    const memory = recordWhatsappIndividualMemory({ userId: 12, key: "alias", summary: "Preferencia pessoal." });

    expect(decision).toEqual(expect.objectContaining({
      decision: "blocked",
      canUpdateIndividualMemory: false,
      canFeedDataset: false,
    }));
    expect(memory).toBeNull();
    expect(listWhatsappIndividualMemories(12)).toHaveLength(0);
  });

  it("permite revisar e desativar memoria individual existente", () => {
    const memory = recordWhatsappIndividualMemory({
      userId: 13,
      key: "recurring_instruction",
      summary: "Usuario prefere registrar leite sem lactose como marca padrao.",
      createdAt: new Date("2026-06-16T18:20:00.000Z"),
    });

    const disabled = disableWhatsappIndividualMemory({
      userId: 13,
      memoryId: memory?.id ?? 0,
      reason: "Usuario pediu para desativar esta personalizacao.",
      disabledAt: new Date("2026-06-16T18:30:00.000Z"),
    });

    expect(disabled).toEqual(expect.objectContaining({
      status: "disabled",
      disabledAt: "2026-06-16T18:30:00.000Z",
      disabledReason: "Usuario pediu para desativar esta personalizacao.",
    }));
    expect(listWhatsappIndividualMemories(13, "active")).toHaveLength(0);
    expect(listWhatsappIndividualMemories(13, "disabled")).toHaveLength(1);
  });

  it("registra data, origem e versao da preferencia aplicada", () => {
    const defaultPreference = getWhatsappLearningPreference(14);
    const preference = setWhatsappLearningPreference({
      userId: 14,
      individualMemoryEnabled: true,
      globalAnonymizedLearningEnabled: false,
      source: "admin",
      appliedAt: new Date("2026-06-16T18:40:00.000Z"),
      notes: "Preferencia migrada por atendimento.",
    });

    expect(defaultPreference).toEqual(expect.objectContaining({
      source: "system_default",
      globalAnonymizedLearningEnabled: true,
    }));
    expect(preference).toEqual(expect.objectContaining({
      source: "admin",
      appliedAt: "2026-06-16T18:40:00.000Z",
      preferenceVersion: "whatsapp-learning-controls/v1",
      notes: "Preferencia migrada por atendimento.",
    }));
  });
});
