import { describe, expect, it } from "vitest";
import type { ProfessionalPortfolioResult } from "../../repositories/professionalPortfolioRepository";
import type { ProfessionalPortfolioInput } from "./schemas";
import {
  buildProfessionalPortfolioWindow,
  combineProfessionalPortfolioPage,
  portfolioIncludesOpaquePendingReceipts,
} from "./portfolioPagination";

const baseInput: ProfessionalPortfolioInput = {
  search: "",
  authorizationStatus: "all",
  trackingStatus: "all",
  activity: "all",
  reportRecords: "all",
  nextReview: "all",
  nextWeighing: "all",
  page: 1,
  pageSize: 20,
  includeHistoricalActivity: true,
};

function emptyPortfolio(
  page: number,
  total: number,
  items: ProfessionalPortfolioResult["items"] = []
): ProfessionalPortfolioResult {
  return {
    items,
    pagination: {
      page,
      pageSize: 20,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / 20),
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
    generatedAt: 1_800_000_000_000,
  };
}

describe("professional portfolio pagination", () => {
  it("shifts the identified window after opaque pending receipts", () => {
    expect(buildProfessionalPortfolioWindow(baseInput, 65, 20)).toEqual({
      offset: 0,
      limit: 0,
    });
    expect(
      buildProfessionalPortfolioWindow({ ...baseInput, page: 4 }, 65, 5)
    ).toEqual({ offset: 0, limit: 15 });
    expect(
      buildProfessionalPortfolioWindow({ ...baseInput, page: 5 }, 65, 0)
    ).toEqual({ offset: 15, limit: 20 });
  });

  it("combines totals and keeps the final pending page reachable", () => {
    const input = { ...baseInput, page: 4 };
    const pendingPage = {
      total: 65,
      items: Array.from({ length: 5 }, (_, index) => ({
        id: `receipt-${60 + index}`,
        status: "pending" as const,
        requestedAt: 1_800_000_000_000 - index,
        linkedAuthorizationId: null,
      })),
    };
    const identifiedItem: ProfessionalPortfolioResult["items"][number] = {
      authorizationId: "approved-1",
      patientUserId: 1,
      patientName: "Pessoa aprovada",
      patientEmail: "approved@example.com",
      authorizationStatus: "approved",
      trackingStatus: "active",
      requestedAt: 1_700_000_000_000,
      lastFoodActivityAt: null,
      lastProfessionalInteractionAt: null,
      nextReviewAt: null,
      nextWeighingAt: null,
      pendingItems: 0,
      hasRecordsInReportPeriod: false,
    };
    const result = combineProfessionalPortfolioPage({
      portfolioInput: input,
      pendingPage,
      portfolio: emptyPortfolio(4, 35, [identifiedItem]),
    });

    expect(result.items).toHaveLength(6);
    expect(
      result.items.slice(0, 5).every(item => item.patientUserId === 0)
    ).toBe(true);
    expect(result.items[5]).toEqual(identifiedItem);
    expect(result.pagination).toEqual({
      page: 4,
      pageSize: 20,
      total: 100,
      totalPages: 5,
    });
    expect(result.summary.pendingRequests).toBe(65);
  });

  it("does not mix opaque receipts into identifiable filters", () => {
    expect(
      portfolioIncludesOpaquePendingReceipts({ ...baseInput, search: "ana" })
    ).toBe(false);
    expect(
      portfolioIncludesOpaquePendingReceipts({
        ...baseInput,
        trackingStatus: "active",
      })
    ).toBe(false);
    expect(
      portfolioIncludesOpaquePendingReceipts({
        ...baseInput,
        authorizationStatus: "approved",
      })
    ).toBe(false);
    expect(
      portfolioIncludesOpaquePendingReceipts({
        ...baseInput,
        authorizationStatus: "pending",
      })
    ).toBe(true);
    expect(
      portfolioIncludesOpaquePendingReceipts({
        ...baseInput,
        reportRecords: "with_records",
        reportStartDate: "2026-07-01",
        reportEndDate: "2026-07-07",
      })
    ).toBe(false);
    expect(
      portfolioIncludesOpaquePendingReceipts({
        ...baseInput,
        nextWeighing: "overdue",
      })
    ).toBe(false);
  });
});
