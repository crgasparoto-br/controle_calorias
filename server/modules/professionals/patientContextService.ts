import { sql } from "drizzle-orm";
import { getDb, logPersistenceWarning } from "../../db";
import { assertProfessionalResourceAccess } from "./entitlementAccess";
import type { ProfessionalPatientContextInput } from "./patientContextSchemas";
import { getProfessionalHistoryEventLabel } from "./historyPresentation";
import { getProfessionalProfile } from "./service";

type Row = Record<string, unknown>;

function rows(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}

function timestamp(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export async function getProfessionalPatientContext(
  professionalUserId: number,
  input: ProfessionalPatientContextInput
) {
  const profile = await getProfessionalProfile(professionalUserId);
  if (!profile?.active) {
    throw new Error("O contexto profissional não está disponível.");
  }

  await assertProfessionalResourceAccess(professionalUserId, input.resource);

  const db = await getDb();
  if (!db) {
    throw new Error(
      "Não foi possível confirmar a autorização do paciente neste momento."
    );
  }

  const result = await db.execute(sql`
    SELECT
      a.id AS authorizationId,
      a.patientUserId,
      u.name AS patientName,
      u.email AS patientEmail,
      COALESCE(t.status, 'not_started') AS trackingStatus,
      t.nextReviewAt
    FROM professionalPatientAuthorizations a
    INNER JOIN users u ON u.id = a.patientUserId
    LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
    WHERE a.professionalUserId = ${professionalUserId}
      AND a.patientUserId = ${input.patientId}
      AND a.status = 'approved'
    ORDER BY a.approvedAt DESC, a.id DESC
    LIMIT 1
  `);
  const context = rows(result)[0];

  if (!context) {
    throw new Error("O acesso a este paciente não está mais disponível.");
  }

  const trackingStatus = String(context.trackingStatus) as
    | "not_started"
    | "active"
    | "paused"
    | "ended";
  const shared = {
    patientId: Number(context.patientUserId),
    displayName:
      (context.patientName ? String(context.patientName) : null) ??
      (context.patientEmail ? String(context.patientEmail) : null) ??
      "Paciente",
    authorizationStatus: "approved" as const,
    trackingStatus,
  };

  if (trackingStatus === "ended") {
    return shared;
  }

  let lastHistory: Row | undefined;
  try {
    const historyResult = await db.execute(sql`
      SELECT
        h.occurredAt AS lastProfessionalActivityAt,
        h.eventType AS lastProfessionalActivityType
      FROM professionalHistoryEvents h
      WHERE h.professionalUserId = ${professionalUserId}
        AND h.patientUserId = ${input.patientId}
      ORDER BY h.occurredAt DESC, h.id DESC
      LIMIT 1
    `);
    lastHistory = rows(historyResult)[0];
  } catch (error) {
    logPersistenceWarning("professional_patient_context_history", error);
  }

  const lastActivityAt = timestamp(lastHistory?.lastProfessionalActivityAt);
  const lastActivityType = lastHistory?.lastProfessionalActivityType
    ? String(lastHistory.lastProfessionalActivityType)
    : null;

  return {
    ...shared,
    authorizationId: String(context.authorizationId),
    lastActivityAt,
    lastActivityLabel:
      lastActivityAt !== null && lastActivityType
        ? getProfessionalHistoryEventLabel(lastActivityType)
        : null,
    nextReviewAt: timestamp(context.nextReviewAt),
  };
}
