import { sql } from "drizzle-orm";
import { getDb } from "../db";

type Row = Record<string, unknown>;
type PriorityAlertType =
  | "no_food_records"
  | "weigh_in_overdue"
  | "goal_review_due"
  | "professional_request_overdue"
  | "record_requires_review";
type PriorityAlertState = "open" | "resolved" | "dismissed" | "inactive";
type PriorityAlertSeverity = "info" | "attention" | "urgent";

export type ProfessionalPriorityAlert = {
  id: string;
  type: PriorityAlertType;
  patientUserId: number;
  patientName: string;
  authorizationId: string;
  origin: { type: string; id: string | null };
  period: { start: number | null; end: number | null };
  reason: string;
  severity: PriorityAlertSeverity;
  state: PriorityAlertState;
  suggestedAction: string;
  createdAt: number | null;
  updatedAt: number | null;
  resolvedAt: number | null;
  resolvedByUserId: number | null;
  resolutionNote: string | null;
};

function rowsFromResult(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}

function asTimestamp(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function mapPriorityAlert(row: Row): ProfessionalPriorityAlert {
  return {
    id: String(row.id),
    type: String(row.type) as PriorityAlertType,
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
    severity: String(row.severity) as PriorityAlertSeverity,
    state: String(row.state) as PriorityAlertState,
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
): Promise<ProfessionalPriorityAlert[]> {
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
