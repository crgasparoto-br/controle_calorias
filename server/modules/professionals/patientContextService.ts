import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { assertProfessionalResourceAccess } from "./entitlementAccess";
import type { ProfessionalPatientContextInput } from "./patientContextSchemas";
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
      t.nextReviewAt,
      (
        SELECT MAX(m.occurredAt)
        FROM meals m
        WHERE m.userId = a.patientUserId
          AND m.status = 'confirmed'
      ) AS lastActivityAt
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

  return {
    patientId: Number(context.patientUserId),
    authorizationId: String(context.authorizationId),
    displayName:
      (context.patientName ? String(context.patientName) : null) ??
      (context.patientEmail ? String(context.patientEmail) : null) ??
      `Paciente ${input.patientId}`,
    authorizationStatus: "approved" as const,
    lastActivityAt: timestamp(context.lastActivityAt),
    nextReviewAt: timestamp(context.nextReviewAt),
    trackingStatus: String(context.trackingStatus) as
      | "not_started"
      | "active"
      | "paused"
      | "ended",
  };
}
