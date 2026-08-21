import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappProfessionalPatientFlowForTests,
  applyWhatsappProfessionalAcceptedInteraction,
  createWhatsappProfessionalPendingInteraction,
  getWhatsappProfessionalPendingInteraction,
  isWhatsappProfessionalPatientIntent,
  listWhatsappProfessionalPendingInteractions,
  resolveWhatsappProfessionalPendingInteraction,
  shouldBypassWhatsappNutritionParserForProfessionalFlow,
  WHATSAPP_PROFESSIONAL_PATIENT_FLOW_VERSION,
} from "./professionalPatientFlow";

function professionalSuggestion() {
  return createWhatsappProfessionalPendingInteraction({
    patientId: 42,
    professionalId: 7,
    sourceActor: "professional",
    kind: "goal_suggestion",
    sourceIntent: "profissional_sugere_meta",
    title: "Ajuste de meta de proteina",
    content: "Sugiro aumentar sua meta de proteina para 120g por dia.",
    target: {
      entity: "goal",
      payload: { nutrient: "protein", value: 120, unit: "g" },
      requiresPatientAcceptance: true,
      requiresProfessionalReview: true,
      sensitive: true,
    },
    createdAt: new Date("2026-06-16T12:00:00.000Z"),
  });
}

describe("whatsapp professional patient flow", () => {
  beforeEach(() => {
    __resetWhatsappProfessionalPatientFlowForTests();
  });

  it("identifica intencoes profissional-paciente e desvia do parser nutricional", () => {
    expect(isWhatsappProfessionalPatientIntent("profissional_sugere_meta")).toBe(true);
    expect(isWhatsappProfessionalPatientIntent("paciente_aceita_sugestao")).toBe(true);
    expect(isWhatsappProfessionalPatientIntent("add_foods_to_meal")).toBe(false);
    expect(shouldBypassWhatsappNutritionParserForProfessionalFlow("confirmacao_sim_nao")).toBe(true);
  });

  it("cria pendencia auditavel para sugestao profissional", () => {
    const pending = professionalSuggestion();

    expect(pending).toEqual(expect.objectContaining({
      id: 1,
      patientId: 42,
      professionalId: 7,
      sourceActor: "professional",
      targetActor: "patient",
      kind: "goal_suggestion",
      sourceIntent: "profissional_sugere_meta",
      status: "pending",
      createdAt: "2026-06-16T12:00:00.000Z",
      flowVersion: WHATSAPP_PROFESSIONAL_PATIENT_FLOW_VERSION,
    }));
    expect(pending.options).toEqual([
      { id: "accept", label: "Aceitar" },
      { id: "reject", label: "Recusar" },
      { id: "adjust", label: "Pedir ajuste" },
    ]);
    expect(pending.audit).toEqual([expect.objectContaining({ action: "professional_patient_pending_created" })]);
  });

  it("aceita sugestao pendente sem aplicar mudanca automaticamente", () => {
    const pending = professionalSuggestion();

    const result = resolveWhatsappProfessionalPendingInteraction({
      patientId: 42,
      text: "aceito",
      receivedAt: new Date("2026-06-16T12:10:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "professional_patient_suggestion_accepted",
      contextUsed: true,
      pendingConsumed: true,
      nutritionParserAllowed: false,
      dataChanged: false,
      audit: expect.objectContaining({ pendingId: pending.id, status: "accepted" }),
    }));
    expect(getWhatsappProfessionalPendingInteraction(pending.id)).toEqual(expect.objectContaining({
      status: "accepted",
      decision: expect.objectContaining({
        actor: "patient",
        result: "accepted",
        decidedAt: "2026-06-16T12:10:00.000Z",
      }),
    }));
  });

  it("aplica alteracao aceita apenas por fluxo autorizado e versionado", () => {
    const pending = professionalSuggestion();
    resolveWhatsappProfessionalPendingInteraction({
      patientId: 42,
      text: "sim",
      receivedAt: new Date("2026-06-16T12:10:00.000Z"),
    });

    const applied = applyWhatsappProfessionalAcceptedInteraction({
      pendingId: pending.id,
      appliedBy: "professional-flow",
      appliedVersion: "professional-flow/v1",
      success: true,
      appliedAt: new Date("2026-06-16T12:12:00.000Z"),
    });

    expect(applied).toEqual(expect.objectContaining({
      action: "professional_patient_change_applied",
      dataChanged: true,
      nutritionParserAllowed: false,
      audit: expect.objectContaining({ status: "applied" }),
    }));
    expect(getWhatsappProfessionalPendingInteraction(pending.id)).toEqual(expect.objectContaining({
      status: "applied",
      application: {
        appliedAt: "2026-06-16T12:12:00.000Z",
        appliedBy: "professional-flow",
        appliedVersion: "professional-flow/v1",
        success: true,
        failureReason: null,
      },
    }));
  });

  it("recusa encerra pendencia sem alterar meta plano refeicao ou alimento", () => {
    const pending = professionalSuggestion();

    const result = resolveWhatsappProfessionalPendingInteraction({
      patientId: 42,
      text: "nao aceito",
      receivedAt: new Date("2026-06-16T12:15:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "professional_patient_suggestion_rejected",
      dataChanged: false,
      nutritionParserAllowed: false,
      audit: expect.objectContaining({ pendingId: pending.id, status: "rejected" }),
    }));
    expect(listWhatsappProfessionalPendingInteractions({ status: "rejected" })).toHaveLength(1);
  });

  it("pedido de ajuste mantem rastreabilidade e nao aplica mudanca", () => {
    const pending = professionalSuggestion();

    const result = resolveWhatsappProfessionalPendingInteraction({
      patientId: 42,
      text: "quero ajustar",
      receivedAt: new Date("2026-06-16T12:20:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "professional_patient_adjustment_requested",
      dataChanged: false,
      contextUsed: true,
      pendingConsumed: true,
      audit: expect.objectContaining({ pendingId: pending.id, status: "adjustment_requested" }),
    }));
    expect(getWhatsappProfessionalPendingInteraction(pending.id)?.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "professional_patient_adjustment_requested" }),
    ]));
  });

  it("bloqueia sim ou nao sem pendencia profissional compativel", () => {
    const result = resolveWhatsappProfessionalPendingInteraction({
      patientId: 42,
      text: "sim",
      receivedAt: new Date("2026-06-16T12:25:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "professional_patient_missing_context",
      contextUsed: false,
      pendingConsumed: false,
      nutritionParserAllowed: false,
      dataChanged: false,
      audit: expect.objectContaining({ status: "missing_context" }),
    }));
  });

  it("expira sugestao pendente sem aplicar alteracao", () => {
    createWhatsappProfessionalPendingInteraction({
      patientId: 42,
      professionalId: 7,
      sourceActor: "professional",
      kind: "meal_plan_suggestion",
      sourceIntent: "profissional_sugere_plano_alimentar",
      title: "Novo plano alimentar",
      content: "Sugiro seguir o plano B por 7 dias.",
      target: {
        entity: "meal_plan",
        payload: { planId: "plan-b" },
        requiresPatientAcceptance: true,
        requiresProfessionalReview: true,
        sensitive: true,
      },
      createdAt: new Date("2026-06-16T12:00:00.000Z"),
      ttlMs: 60_000,
    });

    const result = resolveWhatsappProfessionalPendingInteraction({
      patientId: 42,
      text: "sim",
      receivedAt: new Date("2026-06-16T12:02:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "professional_patient_pending_expired",
      contextUsed: false,
      pendingConsumed: false,
      dataChanged: false,
      audit: expect.objectContaining({ status: "expired" }),
    }));
    expect(listWhatsappProfessionalPendingInteractions({ status: "expired" })).toHaveLength(1);
  });
});
