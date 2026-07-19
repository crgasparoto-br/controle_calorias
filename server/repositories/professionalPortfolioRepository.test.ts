import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { createProfessionalPortfolioRepository } from "./professionalPortfolioRepository";

const input = {
  search: "ana",
  authorizationStatus: "approved" as const,
  trackingStatus: "active" as const,
  activity: "recent" as const,
  page: 2,
  pageSize: 10,
};

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
        if (call === 1) {
          return [
            [
              {
                authorizationId: "access-1",
                patientUserId: 41,
                patientName: "Ana",
                patientEmail: "ana@example.com",
                authorizationStatus: "approved",
                trackingStatus: "active",
                requestedAt: new Date("2026-07-01T12:00:00Z"),
                lastFoodActivityAt: new Date("2026-07-18T12:00:00Z"),
                lastProfessionalInteractionAt: null,
              },
            ],
          ];
        }
        if (call === 2) return [[{ total: 21 }]];
        return [
          [
            {
              active: 4,
              paused: 2,
              ended: 1,
              notStarted: 3,
              pendingRequests: 5,
              withoutRecentActivity: 6,
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
    expect(queries[0].sql).toContain("ORDER BY COALESCE(u.name");
    expect(queries[0].sql).toContain("LIMIT ? OFFSET ?");
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
      nextReviewAt: null,
    });
    expect(result.summary).toEqual({
      active: 4,
      paused: 2,
      ended: 1,
      notStarted: 3,
      pendingRequests: 5,
      withoutRecentActivity: 6,
    });
  });

  it("does not invent portfolio data when persistence is unavailable outside production", async () => {
    const repository = createProfessionalPortfolioRepository({
      getDb: async () => null,
      onWarning: vi.fn(),
    });
    await expect(repository.list(101, input)).resolves.toMatchObject({
      items: [],
      pagination: { total: 0, totalPages: 0 },
      summary: { active: 0, pendingRequests: 0 },
    });
  });
});
