import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { requireDb, resultRows, dateOrNull } from "../../repositories/billingRepositorySupport";

type Row = Record<string, unknown>;

function jsonStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function getUsageGovernanceUserOverview(userId: number) {
  const db = await requireDb(getDb);
  const [limitations, appeals] = await Promise.all([
    db.execute(sql`
      SELECT id, abuseCaseId, operationsJson, startsAt, endsAt, emergencySecurity,
        communicatedAt, appealOfferedAt, state, revokedAt, createdAt
      FROM billingUsageLimitations
      WHERE subjectUserId=${userId}
      ORDER BY createdAt DESC
      LIMIT 50
    `),
    db.execute(sql`
      SELECT id, limitationId, state, result, submittedAt, reviewedAt
      FROM billingUsageLimitationAppeals
      WHERE subjectUserId=${userId}
      ORDER BY submittedAt DESC
      LIMIT 100
    `),
  ]);

  return {
    limitations: resultRows<Row>(limitations).map(row => ({
      id: String(row.id),
      abuseCaseId: String(row.abuseCaseId),
      operations: jsonStringArray(row.operationsJson),
      startsAt: dateOrNull(row.startsAt),
      endsAt: dateOrNull(row.endsAt),
      emergencySecurity: Boolean(row.emergencySecurity),
      communicatedAt: dateOrNull(row.communicatedAt),
      appealOfferedAt: dateOrNull(row.appealOfferedAt),
      state: String(row.state),
      revokedAt: dateOrNull(row.revokedAt),
      createdAt: dateOrNull(row.createdAt),
    })),
    appeals: resultRows<Row>(appeals).map(row => ({
      id: String(row.id),
      limitationId: String(row.limitationId),
      state: String(row.state),
      result: row.result == null ? null : String(row.result),
      submittedAt: dateOrNull(row.submittedAt),
      reviewedAt: dateOrNull(row.reviewedAt),
    })),
    generatedAt: new Date(),
  };
}
