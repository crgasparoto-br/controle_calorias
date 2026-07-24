import { describe, expect, it } from "vitest";
import { buildProfessionalPriorities } from "./aiPrioritiesService";
import type { OperationalAlert } from "./aiContext";

function alert(
  overrides: Partial<OperationalAlert> &
    Pick<OperationalAlert, "id" | "patientUserId" | "patientName" | "type" | "severity">
): OperationalAlert {
  return {
    authorizationId: `authorization-${overrides.patientUserId}`,
    origin: { type: "test", id: overrides.id },
    period: { start: null, end: null },
    reason: `Motivo ${overrides.id}`,
    state: "open",
    suggestedAction: `Ação ${overrides.id}`,
    createdAt: 100,
    updatedAt: 100,
    resolvedAt: null,
    resolvedByUserId: null,
    resolutionNote: null,
    ...overrides,
  } as OperationalAlert;
}

describe("buildProfessionalPriorities", () => {
  it("keeps one urgent patient ahead of another patient with multiple attention alerts", () => {
    const result = buildProfessionalPriorities(
      [
        alert({
          id: "attention-1",
          patientUserId: 20,
          patientName: "Bia",
          type: "no_food_records",
          severity: "attention",
        }),
        alert({
          id: "attention-2",
          patientUserId: 20,
          patientName: "Bia",
          type: "goal_review_due",
          severity: "attention",
        }),
        alert({
          id: "urgent-1",
          patientUserId: 10,
          patientName: "Ana",
          type: "record_requires_review",
          severity: "urgent",
        }),
      ],
      10
    );

    expect(result.map(item => item.patientId)).toEqual([10, 20]);
    expect(result[0].highestSeverity).toBe("urgent");
  });

  it("uses the same deterministic primary signal for severity, reason, action and deadline", () => {
    const urgentLater = alert({
      id: "urgent-later",
      patientUserId: 10,
      patientName: "Ana",
      type: "record_requires_review",
      severity: "urgent",
      reason: "Revisão posterior",
      suggestedAction: "Abrir revisão posterior",
      period: { start: 300, end: 400 },
      updatedAt: 500,
    });
    const urgentEarlier = alert({
      id: "urgent-earlier",
      patientUserId: 10,
      patientName: "Ana",
      type: "professional_request_overdue",
      severity: "urgent",
      reason: "Prazo mais antigo",
      suggestedAction: "Responder solicitação",
      period: { start: 100, end: 200 },
      updatedAt: 300,
    });
    const attention = alert({
      id: "attention",
      patientUserId: 10,
      patientName: "Ana",
      type: "goal_review_due",
      severity: "attention",
      period: { start: 50, end: 60 },
    });

    const [firstOrder] = buildProfessionalPriorities(
      [urgentLater, attention, urgentEarlier],
      10
    );
    const [reverseOrder] = buildProfessionalPriorities(
      [urgentEarlier, attention, urgentLater],
      10
    );

    for (const result of [firstOrder, reverseOrder]) {
      expect(result.highestSeverity).toBe("urgent");
      expect(result.primarySignal).toMatchObject({
        id: "urgent-earlier",
        type: "professional_request_overdue",
        reason: "Prazo mais antigo",
        suggestedAction: "Responder solicitação",
        period: { start: 100, end: 200 },
      });
      expect(result.signals.map(signal => signal.id)).toEqual([
        "urgent-earlier",
        "urgent-later",
        "attention",
      ]);
    }
  });

  it("uses stable identifiers after severity and date ties and respects the requested limit", () => {
    const result = buildProfessionalPriorities(
      [
        alert({
          id: "b",
          patientUserId: 20,
          patientName: "Bia",
          type: "no_food_records",
          severity: "attention",
          period: { start: 100, end: 200 },
        }),
        alert({
          id: "a",
          patientUserId: 10,
          patientName: "Ana",
          type: "no_food_records",
          severity: "attention",
          period: { start: 100, end: 200 },
        }),
      ],
      1
    );

    expect(result).toHaveLength(1);
    expect(result[0].patientId).toBe(10);
  });
});
