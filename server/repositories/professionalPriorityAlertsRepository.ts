import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { OperationalAlert } from "../modules/professionals/aiContext";

type Row = Record<string, unknown>;

function rowsFromResult(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}

function asTimestamp(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function mapPriorityAlert(row: Row): OperationalAlert {
  return {
    id: String(row.id),
    type: String(row.type) as OperationalAlert["type"],
    patientUserId: Number(row.patientUserId),
    patientName:
      String(row.patientDisplayName || row.patientName || "").trim() ||
      `Paciente #${Number(row.patientUserId)}`,
    authorizationId: String(row.authorizationId),
    origin: {
      type: String(row.originType),
      id: row.originId ? String(row.originId) : null,
    },
    period: {
      start: asTimestamp(row.periodStart),
      end: asTimestamp(row.periodEnd),
    },
    reason: String(row.reason),
    severity: String(row.severity) as OperationalAlert["severity"],
    state: String(row.state) as OperationalAlert["state"],
    suggestedAction: String(row.suggestedAction),
    createdAt: asTimestamp(row.createdAt),
    updatedAt: asTimestamp(row.updatedAt),
    resolvedAt: asTimestamp(row.resolvedAt),
    resolvedByUserId: row.resolvedByUserId
      ? Number(row.resolvedByUserId)
      : null,
    resolutionNote: row.resolutionNote
      ? String(row.resolutionNote)
      : null,
  };
}

export async function listProfessionalPriorityAlerts(
  professionalUserId: number
): Promise<OperationalAlert[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("A central de prioridades está temporariamente indisponível.");
  }

  const result = await db.execute(sql`
    SELECT
      alerts.*,
      users.name AS patientName,
      profiles.displayName AS patientDisplayName
    FROM professionalOperationalAlerts alerts
    INNER JOIN users ON users.id = alerts.patientUserId
    LEFT JOIN userProfiles profiles ON profiles.userId = alerts.patientUserId
    WHERE alerts.professionalUserId = ${professionalUserId}
      AND alerts.state = 'open'
    ORDER BY alerts.updatedAt DESC, alerts.id ASC
  `);

  return rowsFromResult(result).map(mapPriorityAlert);
}
