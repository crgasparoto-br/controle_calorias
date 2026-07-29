import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { createProfessionalPortfolioRepository } from "./professionalPortfolioRepository";

const input = {
  search: "ana",
  authorizationStatus: "approved" as const,
  trackingStatus: "active" as const,
  activity: "recent" as const,
  reportRecords: "all" as const,
  nextReview: "scheduled" as const,
  nextWeighing: "all" as const,
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
    patientEmail:
      professionalUserId === 101 ? "ana@example.com" : "bia@example.com",
    authorizationStatus: "approved",
    trackingStatus: "active",
    requestedAt: new Date("2026-07-01T12:00:00Z"),
    lastFoodActivityAt: new Date("2026-07-18T12:00:00Z"),
    lastProfessionalInteractionAt: null,
    nextReviewAt: new Date("2026-07-27T12:00:00Z"),
    nextWeighingAt: new Date("2026-07-28T12:00:00Z"),
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
        return [
          [
            {
              active: 4,
              paused: 2,
              ended: 1,
              notStarted: 3,
              pendingRequests: 5,
              activeWithRecentRecords: 7,
              withoutRecentActivity: 6,
              pendingReviews: 2,
              pendingWeighings: 1,
            },
          ],
        ];
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
    expect(queries[0].sql).toContain("ORDER BY COALESCE(u.`name`");
    expect(queries[0].sql).toContain("LIMIT ? OFFSET ?");
    expect(queries[0].sql).toContain("t.`nextReviewAt`");
    expect(queries[0].sql).toContain("t.`nextWeighingAt`");
    expect(queries[0].sql).toContain("periodMeals.`occurredAt` >=");
    expect(queries[0].sql).toMatch(/COALESCE\s*\(\s*CONVERT_TZ\s*\(/);
    expect(queries[0].sql).toContain(
      "NULLIF(TRIM(periodProfile.`timezone`), '')"
    );
    expect(queries[0].sql).toMatch(
      /CONVERT_TZ\s*\(\s*periodMeals\.`occurredAt`/
    );
    expect(queries[0].params).toContain("America/Sao_Paulo");
    expect(queries[0].sql).toContain("periodAccess.`professionalUserId`");
    expect(queries[0].sql).toContain("a.`status` <> 'pending'");
    expect(queries[0].sql).toContain("a.`status` = 'approved' AND");
    expect(queries[2].sql).toContain("COALESCE(pm.`periodRecordCount`, 0)");
    expect(queries[2].sql).toContain("t.`nextReviewAt` IS NOT NULL");
    expect(queries[2].sql).toContain("t.`nextWeighingAt` IS NOT NULL");
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 21,
      totalPages: 3,
    });
    expect(result.items[0]).toMatchObject({
      patientUserId: 41,
      patientName: "Ana",
      trackingStatus: "active",
      nextReviewAt: new Date("2026-07-27T12:00:00Z").getTime(),
      nextWeighingAt: new Date("2026-07-28T12:00:00Z").getTime(),
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

    expect(queries[0].sql).not.toContain("MAX(scopedMeals.`occurredAt`)");
    expect(queries[0].sql).toContain("periodMeals.`occurredAt` >=");
    expect(queries[2].sql).not.toContain("MAX(scopedMeals.`occurredAt`)");
  });

  it.each(["with_records", "without_records"] as const)(
    "applies the %s report-period filter to the same timezone-aware count used by the indicator",
    async reportRecords => {
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
        search: "",
        trackingStatus: "all",
        activity: "all",
        reportRecords,
        nextReview: "all",
        page: 1,
      });

      expect(queries[0].params).toContain(reportRecords);
      expect(queries[0].sql).toContain(
        "COALESCE(pm.`periodRecordCount`, 0)"
      );
      expect(queries[0].sql).toContain(
        reportRecords === "with_records" ? "> 0" : "= 0"
      );
      expect(queries[0].sql).toMatch(
        /CONVERT_TZ\s*\(\s*periodMeals\.`occurredAt`/
      );
    }
  );

  it.each(["scheduled", "due_soon", "overdue", "unavailable"] as const)(
    "applies the %s review filter at the canonical tracking boundary",
    async nextReview => {
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
        search: "",
        trackingStatus: "all",
        activity: "all",
        nextReview,
        page: 1,
      });

      expect(queries[0].sql).toContain("t.`nextReviewAt`");
      expect(queries[0].params).toContain(nextReview);
      expect(queries[0].sql).toContain("a.`status` = 'approved'");
      if (nextReview === "scheduled") {
        expect(queries[0].sql).toContain("t.`nextReviewAt` IS NOT NULL");
      } else if (nextReview === "due_soon") {
        expect(queries[0].sql).toContain("t.`nextReviewAt` >");
        expect(queries[0].sql).toContain("t.`nextReviewAt` <=");
      } else if (nextReview === "overdue") {
        expect(queries[0].sql).toContain("t.`nextReviewAt` <=");
      } else {
        expect(queries[0].sql).toContain("t.`nextReviewAt` IS NULL");
      }
    }
  );

  it.each(["scheduled", "due_soon", "overdue", "unavailable"] as const)(
    "applies the %s weighing filter at the canonical tracking boundary",
    async nextWeighing => {
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
        search: "",
        trackingStatus: "all",
        activity: "all",
        nextReview: "all",
        nextWeighing,
        page: 1,
      });

      expect(queries[0].sql).toContain("t.`nextWeighingAt`");
      expect(queries[0].params).toContain(nextWeighing);
      expect(queries[0].sql).toContain("a.`status` = 'approved'");
      if (nextWeighing === "scheduled") {
        expect(queries[0].sql).toContain("t.`nextWeighingAt` IS NOT NULL");
      } else if (nextWeighing === "due_soon") {
        expect(queries[0].sql).toContain("t.`nextWeighingAt` >");
        expect(queries[0].sql).toContain("t.`nextWeighingAt` <=");
      } else if (nextWeighing === "overdue") {
        expect(queries[0].sql).toContain("t.`nextWeighingAt` <=");
      } else {
        expect(queries[0].sql).toContain("t.`nextWeighingAt` IS NULL");
      }
    }
  );

  it("isolates two professionals and never returns the other professional patient", async () => {
    const dialect = new MySqlDialect();
    const execute = vi.fn(async query => {
      const compiled = dialect.sqlToQuery(query);
      const professionalUserId = compiled.params.find(
        value => value === 101 || value === 202
      ) as number;
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
      summary: {
        active: 0,
        pendingRequests: 0,
        pendingReviews: 0,
        pendingWeighings: 0,
      },
    });
  });

  it("loads aggregate report blocks through the canonical paginated portfolio query", async () => {
    const dialect = new MySqlDialect();
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    let call = 0;
    const db = {
      execute: vi.fn(async query => {
        const compiled = dialect.sqlToQuery(query);
        queries.push(compiled);
        call += 1;
        if (call % 3 === 1) return [[]];
        if (call % 3 === 2) return [[{ total: 0 }]];
        return [
          [
            {
              active: 5,
              paused: 1,
              ended: 2,
              notStarted: 3,
              activeWithRecentRecords: 3,
              withoutRecentActivity: 4,
              pendingReviews: 2,
              pendingWeighings: 1,
            },
          ],
        ];
      }),
    };
    const repository = createProfessionalPortfolioRepository({
      getDb: async () => db,
      onWarning: vi.fn(),
    });

    const activity = await repository.report(101, {
      block: "activity",
      reportStartDate: "2026-07-01",
      reportEndDate: "2026-07-20",
    });
    const schedule = await repository.report(101, { block: "schedule" });
    const tracking = await repository.report(101, { block: "tracking" });

    expect(queries).toHaveLength(9);
    expect(queries.every(query => query.params.includes(101))).toBe(true);
    expect(
      queries.filter(query => query.sql.includes("LIMIT ? OFFSET ?"))
    ).toHaveLength(3);
    expect(
      queries.filter(query => query.sql.includes("SELECT COUNT(*)"))
    ).toHaveLength(3);
    expect(
      queries.filter(query => query.sql.includes("activeWithRecentRecords"))
    ).toHaveLength(3);
    expect(
      queries.every(
        query => !query.sql.includes("MAX(scopedMeals.`occurredAt`)")
      )
    ).toBe(true);
    expect(queries[0].sql).toContain("periodMeals.`occurredAt` >=");
    expect(queries[0].sql).toMatch(/COALESCE\s*\(\s*CONVERT_TZ\s*\(/);
    expect(queries[0].sql).toContain(
      "NULLIF(TRIM(periodProfile.`timezone`), '')"
    );
    expect(queries[0].params).toContain("America/Sao_Paulo");
    expect(activity.summary).toMatchObject({
      activeWithRecentRecords: 3,
      withoutRecentActivity: 4,
      pendingReviews: null,
    });
    expect(schedule.summary).toMatchObject({
      pendingReviews: 2,
      pendingWeighings: 1,
      active: null,
    });
    expect(tracking.summary).toMatchObject({
      active: 5,
      paused: 1,
      ended: 2,
      notStarted: 3,
      activeWithRecentRecords: null,
    });
  });

  it("represents unavailable report persistence separately from a real zero", async () => {
    const repository = createProfessionalPortfolioRepository({
      getDb: async () => null,
      onWarning: vi.fn(),
    });

    const unavailable = await repository.report(101, { block: "schedule" });

    expect(unavailable.summary.pendingReviews).toBeNull();
    expect(unavailable.summary.pendingWeighings).toBeNull();
  });
});
