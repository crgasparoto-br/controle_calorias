import { sql } from "drizzle-orm";
import { getDb } from "../../db";

type Row = Record<string, unknown>;

function rows(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}

export class ProfessionalMessageAccessUnavailableError extends Error {
  constructor(
    message = "O acesso a este paciente não está mais disponível."
  ) {
    super(message);
    this.name = "ProfessionalMessageAccessUnavailableError";
  }
}

export async function assertProfessionalMessageRetryAccess(
  professionalUserId: number,
  messageId: string
) {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "As mensagens profissionais estão temporariamente indisponíveis."
    );
  }

  const result = await db.execute(sql`
    SELECT m.id AS messageId, a.status AS authorizationStatus
    FROM professionalMessages m
    LEFT JOIN professionalPatientAuthorizations a ON a.id = m.authorizationId
    WHERE m.id = ${messageId}
      AND m.professionalUserId = ${professionalUserId}
    LIMIT 1
  `);
  const message = rows(result)[0];

  // Preserve the existing idempotent behavior for missing, already consumed or
  // concurrently claimed messages. Only a known message whose authorization is
  // no longer approved represents a confirmed patient-context revocation.
  if (!message) return;
  if (String(message.authorizationStatus ?? "") !== "approved") {
    throw new ProfessionalMessageAccessUnavailableError();
  }
}
