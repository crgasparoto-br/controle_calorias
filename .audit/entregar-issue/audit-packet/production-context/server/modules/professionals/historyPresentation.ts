export const UNKNOWN_PROFESSIONAL_HISTORY_EVENT_LABEL =
  "Evento profissional registrado";

/**
 * Public, patient-scoped history labels. Keep this catalog aligned with every
 * canonical event that can be returned by professionalRecord.get. Labels must
 * describe the domain action without exposing internal IDs, payloads or raw
 * event names.
 */
export const PROFESSIONAL_PATIENT_HISTORY_EVENT_LABELS = {
  access_request_linked: "Solicitação de acompanhamento registrada",
  access_requested: "Acesso profissional solicitado",
  access_approved: "Acesso profissional aprovado",
  access_rejected: "Acesso profissional recusado",
  access_revoked: "Acesso profissional revogado",
  access_authorization_whatsapp_sent: "Autorização enviada pelo WhatsApp",
  access_authorization_whatsapp_failed:
    "Falha ao enviar autorização pelo WhatsApp",
  access_reconciled: "Solicitação de acesso reconciliada",
  profile_upserted: "Perfil profissional atualizado",
  tracking_started: "Acompanhamento iniciado",
  tracking_resumed: "Acompanhamento retomado",
  tracking_paused: "Acompanhamento pausado",
  tracking_ended: "Acompanhamento encerrado",
  tracking_status_changed: "Situação do acompanhamento alterada",
  tracking_transitioned: "Situação do acompanhamento alterada",
  assessment_version_created: "Nova versão da avaliação registrada",
  private_note_created: "Anotação privada registrada",
  guidance_created: "Orientação ao paciente registrada",
  comment_created: "Comentário profissional registrado",
  goal_suggested: "Sugestão de meta registrada",
  goal_suggestion_accepted: "Sugestão de meta aceita pelo paciente",
  goal_suggestion_refused: "Sugestão de meta recusada pelo paciente",
  meal_suggested: "Sugestão de refeição registrada",
  patient_question_answered: "Pergunta do paciente respondida",
  official_goal_activated: "Meta oficial ativada",
  official_goal_revised: "Nova versão da meta oficial ativada",
  official_goal_review_requested: "Revisão da meta oficial solicitada",
  official_goal_notification_sent: "Notificação da meta enviada",
  official_goal_notification_failed: "Falha na notificação da meta",
  professional_message_drafted: "Rascunho de mensagem registrado",
  professional_message_created: "Mensagem profissional registrada",
  professional_message_sent: "Mensagem profissional enviada",
  professional_message_failed: "Falha no envio da mensagem profissional",
  professional_message_received: "Mensagem do paciente recebida",
  professional_message_response_received: "Resposta do paciente recebida",
  professional_ai_summary_generated: "Resumo do acompanhamento gerado pela IA",
  professional_ai_comparison_generated:
    "Comparação do acompanhamento gerada pela IA",
  professional_ai_question_generated:
    "Pergunta sobre o acompanhamento respondida pela IA",
  professional_ai_draft_generated: "Rascunho de comunicação gerado pela IA",
} as const satisfies Record<string, string>;

export type KnownProfessionalPatientHistoryEventType =
  keyof typeof PROFESSIONAL_PATIENT_HISTORY_EVENT_LABELS;

export function getProfessionalHistoryEventLabel(eventType: string) {
  return (
    PROFESSIONAL_PATIENT_HISTORY_EVENT_LABELS[
      eventType as KnownProfessionalPatientHistoryEventType
    ] ?? UNKNOWN_PROFESSIONAL_HISTORY_EVENT_LABEL
  );
}

export function isKnownProfessionalPatientHistoryEventType(
  eventType: string
): eventType is KnownProfessionalPatientHistoryEventType {
  return Object.prototype.hasOwnProperty.call(
    PROFESSIONAL_PATIENT_HISTORY_EVENT_LABELS,
    eventType
  );
}
