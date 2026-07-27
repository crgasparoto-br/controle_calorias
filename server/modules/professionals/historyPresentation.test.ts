import { describe, expect, it } from "vitest";
import {
  getProfessionalHistoryEventLabel,
  isKnownProfessionalPatientHistoryEventType,
  PROFESSIONAL_PATIENT_HISTORY_EVENT_LABELS,
  UNKNOWN_PROFESSIONAL_HISTORY_EVENT_LABEL,
} from "./historyPresentation";

const canonicalPatientHistoryEvents = [
  "access_request_linked",
  "access_requested",
  "access_approved",
  "access_rejected",
  "access_revoked",
  "access_authorization_whatsapp_sent",
  "access_authorization_whatsapp_failed",
  "access_reconciled",
  "profile_upserted",
  "tracking_started",
  "tracking_resumed",
  "tracking_paused",
  "tracking_ended",
  "tracking_status_changed",
  "tracking_transitioned",
  "assessment_version_created",
  "private_note_created",
  "guidance_created",
  "comment_created",
  "goal_suggested",
  "goal_suggestion_accepted",
  "goal_suggestion_refused",
  "meal_suggested",
  "patient_question_answered",
  "official_goal_activated",
  "official_goal_revised",
  "official_goal_review_requested",
  "official_goal_notification_sent",
  "official_goal_notification_failed",
  "professional_message_drafted",
  "professional_message_created",
  "professional_message_sent",
  "professional_message_failed",
  "professional_message_received",
  "professional_message_response_received",
  "professional_ai_summary_generated",
  "professional_ai_comparison_generated",
  "professional_ai_question_generated",
  "professional_ai_draft_generated",
] as const;

describe("professional patient history presentation", () => {
  it("maps every canonical and supported legacy event to a specific safe label", () => {
    expect(Object.keys(PROFESSIONAL_PATIENT_HISTORY_EVENT_LABELS).sort()).toEqual(
      [...canonicalPatientHistoryEvents].sort()
    );

    for (const eventType of canonicalPatientHistoryEvents) {
      expect(isKnownProfessionalPatientHistoryEventType(eventType)).toBe(true);
      expect(getProfessionalHistoryEventLabel(eventType)).not.toBe(
        UNKNOWN_PROFESSIONAL_HISTORY_EVENT_LABEL
      );
      expect(getProfessionalHistoryEventLabel(eventType)).not.toContain(
        eventType
      );
    }
  });

  it("keeps genuinely unknown events sanitized", () => {
    expect(getProfessionalHistoryEventLabel("future_internal_event")).toBe(
      UNKNOWN_PROFESSIONAL_HISTORY_EVENT_LABEL
    );
    expect(
      isKnownProfessionalPatientHistoryEventType("future_internal_event")
    ).toBe(false);
  });

  it("distinguishes the audit findings that previously collapsed into the fallback", () => {
    expect(
      getProfessionalHistoryEventLabel("official_goal_review_requested")
    ).toBe("Revisão da meta oficial solicitada");
    expect(
      getProfessionalHistoryEventLabel("professional_message_drafted")
    ).toBe("Rascunho de mensagem registrado");
    expect(
      getProfessionalHistoryEventLabel("professional_message_response_received")
    ).toBe("Resposta do paciente recebida");
  });
});
