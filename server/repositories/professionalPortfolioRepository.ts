import { sql } from "drizzle-orm";
import { DEFAULT_APP_TIME_ZONE } from "../../shared/timeZone";
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
  hasRecordsInReportPeriod: boolean;
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
    activeWithRecentRecords: number;
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

export function mapProfessionalPortfolioItem(
  row: Row,
  now: Date
): ProfessionalPortfolioItem {
  const authorizationStatus = String(
    row.authorizationStatus
  ) as ProfessionalPortfolioItem["authorizationStatus"];
  const approved = authorizationStatus === "approved";
  const nextReviewAt = approved ? asTimestamp(row.nextReviewAt) : null;
  const nextWeighingAt = approved ? asTimestamp(row.nextWeighingAt) : null;
  return {
    authorizationId: String(row.authorizationId),
    patientUserId: asNumber(row.patientUserId),
    patientName: row.patientName ? String(row.patientName) : null,
    patientEmail:
      approved && row.patientEmail ? String(row.patientEmail) : null,
    authorizationStatus,
    trackingStatus:
      approved && row.trackingStatus
        ? (String(
            row.trackingStatus
          ) as ProfessionalPortfolioItem["trackingStatus"])
        : null,
    requestedAt: asTimestamp(row.requestedAt) ?? 0,
    lastFoodActivityAt: approved ? asTimestamp(row.lastFoodActivityAt) : null,
    lastProfessionalInteractionAt: approved
      ? asTimestamp(row.lastProfessionalInteractionAt)
      : null,
    nextReviewAt,
    nextWeighingAt,
    pendingItems:
      (authorizationStatus === "pending" ? 1 : 0) +
      (approved && nextReviewAt !== null && nextReviewAt <= now.getTime() ? 1 : 0) +
      (approved && nextWeighingAt !== null && nextWeighingAt <= now.getTime()
        ? 1
        : 0),
    hasRecordsInReportPeriod:
      approved && asNumber(row.periodRecordCount) > 0,
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
    const reportStartDate =
      input.reportStartDate ??
      new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    const reportEndDate = input.reportEndDate ?? now.toISOString().slice(0, 10);
    const [startYear, startMonth, startDay] = reportStartDate
      .split("-")
      .map(Number);
    const [endYear, endMonth, endDay] = reportEndDate.split("-").map(Number);
    const reportCoarseStart = new Date(
      Date.UTC(startYear, startMonth - 1, startDay)
    );
    reportCoarseStart.setUTCHours(reportCoarseStart.getUTCHours() - 14);
    const reportCoarseEnd = new Date(
      Date.UTC(endYear, endMonth - 1, endDay, 23, 59, 59, 999)
    );
    reportCoarseEnd.setUTCHours(reportCoarseEnd.getUTCHours() + 14);
    const offset = (input.page - 1) * input.pageSize;

    try {
      const historicalActivityJoin = input.includeHistoricalActivity
        ? sql`LEFT JOIN (
            SELECT scopedMeals.userId, MAX(scopedMeals.occurredAt) AS lastFoodActivityAt
            FROM meals scopedMeals
            INNER JOIN professionalPatientAuthorizations scopedAccess
              ON scopedAccess.patientUserId = scopedMeals.userId
              AND scopedAccess.professionalUserId = ${professionalUserId}
              AND scopedAccess.status = 'approved'
            WHERE scopedMeals.status = 'confirmed'
            GROUP BY scopedMeals.userId
          ) m ON m.userId = a.patientUserId`
        : sql`LEFT JOIN (
            SELECT NULL AS userId, NULL AS lastFoodActivityAt
          ) m ON 1 = 0`;
      const periodRecordsJoin = sql`LEFT JOIN (
          SELECT periodMeals.userId, COUNT(*) AS periodRecordCount
          FROM meals periodMeals
          INNER JOIN professionalPatientAuthorizations periodAccess
            ON periodAccess.patientUserId = periodMeals.userId
            AND periodAccess.professionalUserId = ${professionalUserId}
            AND periodAccess.status = 'approved'
          LEFT JOIN userProfiles periodProfile ON periodProfile.userId = periodMeals.userId
          WHERE periodMeals.status = 'confirmed'
            AND periodMeals.occurredAt >= ${reportCoarseStart}
            AND periodMeals.occurredAt <= ${reportCoarseEnd}
            AND DATE_FORMAT(CONVERT_TZ(periodMeals.occurredAt, '+00:00', COALESCE(periodProfile.timezone, ${DEFAULT_APP_TIME_ZONE})), '%Y-%m-%d')
              BETWEEN ${reportStartDate} AND ${reportEndDate}
          GROUP BY periodMeals.userId
        ) pm ON pm.userId = a.patientUserId`;
      const filters = sql`
        a.professionalUserId = ${professionalUserId}
        AND (${input.authorizationStatus} = 'all' OR a.status = ${input.authorizationStatus})
        AND (${input.trackingStatus} = 'all'
          OR (a.status = 'approved' AND ${input.trackingStatus} = 'not_started' AND t.id IS NULL)
          OR (a.status = 'approved' AND t.status = ${input.trackingStatus}))
        AND (${input.search} = '' OR LOWER(COALESCE(u.name, '')) LIKE ${search}
          OR (a.status = 'approved' AND LOWER(COALESCE(u.email, '')) LIKE ${search})
          OR CAST(u.id AS CHAR) = ${input.search})
        AND (${input.activity} = 'all'
          OR (a.status = 'approved' AND ${input.activity} = 'recent' AND m.lastFoodActivityAt >= ${inactiveBefore})
          OR (a.status = 'approved' AND ${input.activity} = 'inactive' AND (m.lastFoodActivityAt < ${inactiveBefore} OR m.lastFoodActivityAt IS NULL))
          OR (a.status = 'approved' AND ${input.activity} = 'unavailable' AND m.lastFoodActivityAt IS NULL))
        AND (${input.nextReview} = 'all'
          OR (a.status = 'approved' AND ${input.nextReview} = 'scheduled' AND t.nextReviewAt IS NOT NULL)
          OR (a.status = 'approved' AND ${input.nextReview} = 'due_soon' AND t.nextReviewAt >= ${now} AND t.nextReviewAt <= ${dueSoonUntil})
          OR (a.status = 'approved' AND ${input.nextReview} = 'overdue' AND t.nextReviewAt < ${now})
          OR (a.status = 'approved' AND ${input.nextReview} = 'unavailable' AND t.nextReviewAt IS NULL))`;
      const baseFrom = sql`
        FROM professionalPatientAuthorizations a
        INNER JOIN users u ON u.id = a.patientUserId
        LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
        ${historicalActivityJoin}
        LEFT JOIN (
          SELECT professionalUserId, patientUserId, MAX(occurredAt) AS lastProfessionalInteractionAt
          FROM professionalHistoryEvents GROUP BY professionalUserId, patientUserId
        ) h ON h.professionalUserId = a.professionalUserId AND h.patientUserId = a.patientUserId
        ${periodRecordsJoin}
        WHERE ${filters}`;

      const [itemsResult, countResult, summaryResult] = await Promise.all([
        db.execute(sql`
          SELECT a.id AS authorizationId, a.patientUserId, u.name AS patientName,
            CASE WHEN a.status = 'approved' THEN u.email ELSE NULL END AS patientEmail,
            a.status AS authorizationStatus,
            CASE WHEN a.status = 'approved' THEN t.status ELSE NULL END AS trackingStatus,
            a.requestedAt,
            CASE WHEN a.status = 'approved' THEN t.nextReviewAt ELSE NULL END AS nextReviewAt,
            CASE WHEN a.status = 'approved' THEN t.nextWeighingAt ELSE NULL END AS nextWeighingAt,
            CASE WHEN a.status = 'approved' THEN m.lastFoodActivityAt ELSE NULL END AS lastFoodActivityAt,
            CASE WHEN a.status = 'approved' THEN h.lastProfessionalInteractionAt ELSE NULL END AS lastProfessionalInteractionAt,
            CASE WHEN a.status = 'approved' THEN pm.periodRecordCount ELSE 0 END AS periodRecordCount
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
            SUM(CASE WHEN a.status = 'approved' AND t.status = 'active' AND COALESCE(pm.periodRecordCount, 0) > 0 THEN 1 ELSE 0 END) AS activeWithRecentRecords,
            SUM(CASE WHEN a.status = 'approved' AND COALESCE(pm.periodRecordCount, 0) = 0 THEN 1 ELSE 0 END) AS withoutRecentActivity,
            SUM(CASE WHEN a.status = 'approved' AND t.nextReviewAt IS NOT NULL AND t.nextReviewAt <= ${now} THEN 1 ELSE 0 END) AS pendingReviews,
            SUM(CASE WHEN a.status = 'approved' AND t.nextWeighingAt IS NOT NULL AND t.nextWeighingAt <= ${now} THEN 1 ELSE 0 END) AS pendingWeighings
          FROM professionalPatientAuthorizations a
          LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
          ${periodRecordsJoin}
          WHERE a.professionalUserId = ${professionalUserId}`),
      ]);

      const total = asNumber(rowsFromResult(countResult)[0]?.total);
      const summary = rowsFromResult(summaryResult)[0] ?? {};
      return {
        items: rowsFromResult(itemsResult).map(row =>
          mapProfessionalPortfolioItem(row, now)
        ),
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
          activeWithRecentRecords: asNumber(summary.activeWithRecentRecords),
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
      activeWithRecentRecords: 0,
      withoutRecentActivity: 0,
      pendingReviews: 0,
      pendingWeighings: 0,
    },
    generatedAt: Date.now(),
  };
}

export const professionalPortfolioRepository =
  createProfessionalPortfolioRepository();
