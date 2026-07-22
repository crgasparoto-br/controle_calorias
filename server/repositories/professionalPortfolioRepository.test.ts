import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { createProfessionalPortfolioRepository } from "./professionalPortfolioRepository";

const input = {
  search: "ana",
  authorizationStatus: "approved" as const,
  trackingStatus: "active" as const,
  activity: "recent" as const,
  nextReview: "scheduled" as const,
  page: 2,
  pageSize: 10,
  reportStartDate: "2026-07-14",
  reportEndDate: "2026-07-20",
  includeHistoricalActivity: true,
};

function rowFor(professionalUserId: number) {
  return {
    authorizationId: `access-${professionalUserId}`,
    patientUserId: professionalUserId === 101 ? 41 : 42,
    patientName: professionalUserId === 101 ? "Ana" : "Beatriz",
    patientEmail: professionalUserId === 101 ? "ana@example.com" : "bia@example.com",
    authorizationStatus: "approved",
    trackingStatus: "active",
    requestedAt: new Date("2026-07-01T12:00:00Z"),
    lastFoodActivityAt: new Date("2026-07-18T12:00:00Z"),
    lastProfessionalInteractionAt: null,
    nextReviewAt: new Date("2026-07-25T12:00:00Z"),
    nextWeighingAt: null,
  };
}

describe("professionalPortfolioRepository", () => {
  it("keeps every query scoped to the authenticated professional and maps stable pagination", async () => {
    const dialect = new MySqlDialect();
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    let call = 0;
    const db = {
      execute: vi.fn(async query => {
        const compiled = dialect.sqlToQuery(query);
        queries.push(compiled);
        call += 1;
        if (call === 1) return [[rowFor(101)]];
        if (call === 2) return [[{ total: 21 }]];
        return [[{
          active: 4,
          paused: 2,
          ended: 1,
          notStarted: 3,
          pendingRequests: 5,
          activeWithRecentRecords: 7,
          withoutRecentActivity: 6,
          pendingReviews: 2,
          pendingWeighings: 1,
        }]];
      }),
    };
    const repository = createProfessionalPortfolioRepository({
      getDb: async () => db,
      onWarning: vi.fn(),
    });

    const result = await repository.list(101, input);

    expect(queries).toHaveLength(3);
    expect(queries.every(query => query.params.includes(101))).toBe(true);
    expect(queries.some(query => query.params.includes(202))).toBe(false);
    expect(queries[0].sql).toContain("ORDER BY COALESCE(u.name");
    expect(queries[0].sql).toContain("LIMIT ? OFFSET ?");
    expect(queries[0].sql).toContain("nextReviewAt");
    expect(queries[0].sql).toContain("periodMeals.occurredAt >=");
    expect(queries[0].sql).toContain("CONVERT_TZ(periodMeals.occurredAt");
    expect(queries[0].sql).toContain("periodAccess.professionalUserId");
    expect(queries[2].sql).toContain("COALESCE(pm.periodRecordCount, 0)");
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 21, totalPages: 3 });
    expect(result.items[0]).toMatchObject({
      patientUserId: 41,
      patientName: "Ana",
      trackingStatus: "active",
      nextReviewAt: new Date("2026-07-25T12:00:00Z").getTime(),
    });
    expect(result.summary).toEqual({
      active: 4,
      paused: 2,
      ended: 1,
      notStarted: 3,
      pendingRequests: 5,
      activeWithRecentRecords: 7,
      withoutRecentActivity: 6,
      pendingReviews: 2,
      pendingWeighings: 1,
    });
  });

  it("does not scan historical meals when the report view only needs the selected period", async () => {
    const dialect = new MySqlDialect();
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      execute: vi.fn(async query => {
        queries.push(dialect.sqlToQuery(query));
        return [[]];
      }),
    };
    const repository = createProfessionalPortfolioRepository({
      getDb: async () => db,
      onWarning: vi.fn(),
    });

    await repository.list(101, {
      ...input,
      activity: "all",
      includeHistoricalActivity: false,
    });

    expect(queries[0].sql).not.toContain("MAX(scopedMeals.occurredAt)");
    expect(queries[0].sql).toContain("periodMeals.occurredAt >=");
    expect(queries[2].sql).not.toContain("MAX(scopedMeals.occurredAt)");
  });

  it("isolates two professionals and never returns the other professional patient", async () => {
    const dialect = new MySqlDialect();
    const execute = vi.fn(async query => {
      const compiled = dialect.sqlToQuery(query);
      const professionalUserId = compiled.params.find(value => value === 101 || value === 202) as number;
      const callIndex = execute.mock.calls.length % 3;
      if (callIndex === 1) return [[rowFor(professionalUserId)]];
      if (callIndex === 2) return [[{ total: 1 }]];
      return [[{}]];
    });
    const repository = createProfessionalPortfolioRepository({
      getDb: async () => ({ execute }),
      onWarning: vi.fn(),
    });

    const [first, second] = await Promise.all([
      repository.list(101, { ...input, page: 1 }),
      repository.list(202, { ...input, page: 1 }),
    ]);

    expect(first.items.map(item => item.patientUserId)).toEqual([41]);
    expect(second.items.map(item => item.patientUserId)).toEqual([42]);
    expect(first.items.some(item => item.patientUserId === 42)).toBe(false);
    expect(second.items.some(item => item.patientUserId === 41)).toBe(false);
  });

  it("does not invent portfolio data when persistence is unavailable outside production", async () => {
    const repository = createProfessionalPortfolioRepository({
      getDb: async () => null,
      onWarning: vi.fn(),
    });
    await expect(repository.list(101, input)).resolves.toMatchObject({
      items: [],
      pagination: { total: 0, totalPages: 0 },
      summary: { active: 0, pendingRequests: 0, pendingReviews: 0, pendingWeighings: 0 },
    });
  });
});
