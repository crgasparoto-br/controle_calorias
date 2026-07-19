import { sql } from "drizzle-orm";
import { getDb, logPersistenceWarning } from "../db";
import type { ProfessionalPortfolioInput } from "../modules/professionals/schemas";

export type ProfessionalPortfolioItem = {
  authorizationId: string;
  patientUserId: number;
  patientName: string | null;
  patientEmail: string | null;
  authorizationStatus: "pending" | "approved" | "rejected" | "revoked";
  trackingStatus: "active" | "paused" | "ended" | null;
  requestedAt: number;
  lastFoodActivityAt: number | null;
  lastProfessionalInteractionAt: number | null;
  nextReviewAt: number | null;
  nextWeighingAt: number | null;
  pendingItems: number;
};

export type ProfessionalPortfolioResult = {
  items: ProfessionalPortfolioItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    active: number;
    paused: number;
    ended: number;
    notStarted: number;
    pendingRequests: number;
    withoutRecentActivity: number;
    pendingReviews: number;
    pendingWeighings: number;
  };
  generatedAt: number;
};

type Row = Record<string, unknown>;

function rowsFromResult(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asTimestamp(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function mapItem(row: Row, now: Date): ProfessionalPortfolioItem {
  const nextReviewAt = asTimestamp(row.nextReviewAt);
  const nextWeighingAt = asTimestamp(row.nextWeighingAt);
  return {
    authorizationId: String(row.authorizationId),
    patientUserId: asNumber(row.patientUserId),
    patientName: row.patientName ? String(row.patientName) : null,
    patientEmail: row.patientEmail ? String(row.patientEmail) : null,
    authorizationStatus: String(
      row.authorizationStatus
    ) as ProfessionalPortfolioItem["authorizationStatus"],
    trackingStatus: row.trackingStatus
      ? (String(
          row.trackingStatus
        ) as ProfessionalPortfolioItem["trackingStatus"])
      : null,
    requestedAt: asTimestamp(row.requestedAt) ?? 0,
    lastFoodActivityAt: asTimestamp(row.lastFoodActivityAt),
    lastProfessionalInteractionAt: asTimestamp(
      row.lastProfessionalInteractionAt
    ),
    nextReviewAt,
    nextWeighingAt,
    pendingItems:
      (String(row.authorizationStatus) === "pending" ? 1 : 0) +
      (nextReviewAt !== null && nextReviewAt <= now.getTime() ? 1 : 0) +
      (nextWeighingAt !== null && nextWeighingAt <= now.getTime() ? 1 : 0),
  };
}

export function createProfessionalPortfolioRepository(
  deps = {
    getDb,
    onWarning: logPersistenceWarning,
  }
) {
  async function list(
    professionalUserId: number,
    input: ProfessionalPortfolioInput
  ): Promise<ProfessionalPortfolioResult> {
    const db = await deps.getDb();
    if (!db) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "A carteira profissional está temporariamente indisponível."
        );
      }
      return emptyResult(input);
    }

    const now = new Date();
    const dueSoonUntil = new Date(now.getTime() + 7 * 86_400_000);
    const search = `%${input.search.toLocaleLowerCase("pt-BR")}%`;
    const inactiveBefore = new Date(now.getTime() - 3 * 86_400_000);
    const offset = (input.page - 1) * input.pageSize;

    try {
      const filters = sql`
        a.professionalUserId = ${professionalUserId}
        AND (${input.authorizationStatus} = 'all' OR a.status = ${input.authorizationStatus})
        AND (${input.trackingStatus} = 'all'
          OR (${input.trackingStatus} = 'not_started' AND t.id IS NULL)
          OR t.status = ${input.trackingStatus})
        AND (${input.search} = '' OR LOWER(COALESCE(u.name, '')) LIKE ${search}
          OR LOWER(COALESCE(u.email, '')) LIKE ${search}
          OR CAST(u.id AS CHAR) = ${input.search})
        AND (${input.activity} = 'all'
          OR (${input.activity} = 'recent' AND m.lastFoodActivityAt >= ${inactiveBefore})
          OR (${input.activity} = 'inactive' AND (m.lastFoodActivityAt < ${inactiveBefore} OR m.lastFoodActivityAt IS NULL))
          OR (${input.activity} = 'unavailable' AND m.lastFoodActivityAt IS NULL))
        AND (${input.nextReview} = 'all'
          OR (${input.nextReview} = 'scheduled' AND t.nextReviewAt IS NOT NULL)
          OR (${input.nextReview} = 'due_soon' AND t.nextReviewAt >= ${now} AND t.nextReviewAt <= ${dueSoonUntil})
          OR (${input.nextReview} = 'overdue' AND t.nextReviewAt < ${now})
          OR (${input.nextReview} = 'unavailable' AND t.nextReviewAt IS NULL))`;
      const baseFrom = sql`
        FROM professionalPatientAuthorizations a
        INNER JOIN users u ON u.id = a.patientUserId
        LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
        LEFT JOIN (
          SELECT userId, MAX(occurredAt) AS lastFoodActivityAt
          FROM meals WHERE status = 'confirmed' GROUP BY userId
        ) m ON m.userId = a.patientUserId
        LEFT JOIN (
          SELECT professionalUserId, patientUserId, MAX(occurredAt) AS lastProfessionalInteractionAt
          FROM professionalHistoryEvents GROUP BY professionalUserId, patientUserId
        ) h ON h.professionalUserId = a.professionalUserId AND h.patientUserId = a.patientUserId
        WHERE ${filters}`;

      const [itemsResult, countResult, summaryResult] = await Promise.all([
        db.execute(sql`
          SELECT a.id AS authorizationId, a.patientUserId, u.name AS patientName,
            u.email AS patientEmail, a.status AS authorizationStatus,
            t.status AS trackingStatus, a.requestedAt, t.nextReviewAt,
            t.nextWeighingAt, m.lastFoodActivityAt,
            h.lastProfessionalInteractionAt
          ${baseFrom}
          ORDER BY COALESCE(u.name, u.email, CAST(u.id AS CHAR)) ASC, a.requestedAt DESC, a.id ASC
          LIMIT ${input.pageSize} OFFSET ${offset}`),
        db.execute(sql`SELECT COUNT(*) AS total ${baseFrom}`),
        db.execute(sql`
          SELECT
            SUM(CASE WHEN t.status = 'active' AND a.status = 'approved' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN t.status = 'paused' AND a.status = 'approved' THEN 1 ELSE 0 END) AS paused,
            SUM(CASE WHEN t.status = 'ended' AND a.status = 'approved' THEN 1 ELSE 0 END) AS ended,
            SUM(CASE WHEN t.id IS NULL AND a.status = 'approved' THEN 1 ELSE 0 END) AS notStarted,
            SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) AS pendingRequests,
            SUM(CASE WHEN a.status = 'approved' AND (m.lastFoodActivityAt < ${inactiveBefore} OR m.lastFoodActivityAt IS NULL) THEN 1 ELSE 0 END) AS withoutRecentActivity,
            SUM(CASE WHEN a.status = 'approved' AND t.nextReviewAt IS NOT NULL AND t.nextReviewAt <= ${now} THEN 1 ELSE 0 END) AS pendingReviews,
            SUM(CASE WHEN a.status = 'approved' AND t.nextWeighingAt IS NOT NULL AND t.nextWeighingAt <= ${now} THEN 1 ELSE 0 END) AS pendingWeighings
          FROM professionalPatientAuthorizations a
          LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
          LEFT JOIN (
            SELECT userId, MAX(occurredAt) AS lastFoodActivityAt
            FROM meals WHERE status = 'confirmed' GROUP BY userId
          ) m ON m.userId = a.patientUserId
          WHERE a.professionalUserId = ${professionalUserId}`),
      ]);

      const total = asNumber(rowsFromResult(countResult)[0]?.total);
      const summary = rowsFromResult(summaryResult)[0] ?? {};
      return {
        items: rowsFromResult(itemsResult).map(row => mapItem(row, now)),
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
        },
        summary: {
          active: asNumber(summary.active),
          paused: asNumber(summary.paused),
          ended: asNumber(summary.ended),
          notStarted: asNumber(summary.notStarted),
          pendingRequests: asNumber(summary.pendingRequests),
          withoutRecentActivity: asNumber(summary.withoutRecentActivity),
          pendingReviews: asNumber(summary.pendingReviews),
          pendingWeighings: asNumber(summary.pendingWeighings),
        },
        generatedAt: now.getTime(),
      };
    } catch (error) {
      deps.onWarning("professional_portfolio", error);
      throw new Error("Não foi possível carregar a carteira profissional.");
    }
  }

  return { list };
}

function emptyResult(
  input: ProfessionalPortfolioInput
): ProfessionalPortfolioResult {
  return {
    items: [],
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: 0,
      totalPages: 0,
    },
    summary: {
      active: 0,
      paused: 0,
      ended: 0,
      notStarted: 0,
      pendingRequests: 0,
      withoutRecentActivity: 0,
      pendingReviews: 0,
      pendingWeighings: 0,
    },
    generatedAt: Date.now(),
  };
}

export const professionalPortfolioRepository =
  createProfessionalPortfolioRepository();
