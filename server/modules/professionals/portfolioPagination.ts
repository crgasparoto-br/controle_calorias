import type { ProfessionalPortfolioResult } from "../../repositories/professionalPortfolioRepository";
import type { ProfessionalAccessRequestReceiptPage } from "./accessRequestReceiptRepository";
import type { ProfessionalPortfolioInput } from "./schemas";

export const PROFESSIONAL_PENDING_REQUEST_NAME =
  "Solicitação aguardando confirmação";

export function portfolioIncludesOpaquePendingReceipts(
  input: ProfessionalPortfolioInput
) {
  return (
    input.search.trim() === "" &&
    (input.authorizationStatus === "all" ||
      input.authorizationStatus === "pending") &&
    input.trackingStatus === "all" &&
    input.activity === "all" &&
    input.nextReview === "all"
  );
}

export function buildProfessionalPortfolioWindow(
  input: ProfessionalPortfolioInput,
  pendingTotal: number,
  pendingItemsOnPage: number
) {
  const combinedOffset = (input.page - 1) * input.pageSize;
  return {
    offset: Math.max(0, combinedOffset - pendingTotal),
    limit: Math.max(0, input.pageSize - pendingItemsOnPage),
  };
}

function pendingReceiptPortfolioItem(
  receipt: ProfessionalAccessRequestReceiptPage["items"][number]
): ProfessionalPortfolioResult["items"][number] {
  return {
    authorizationId: receipt.id,
    patientUserId: 0,
    patientName: PROFESSIONAL_PENDING_REQUEST_NAME,
    patientEmail: null,
    authorizationStatus: "pending",
    trackingStatus: null,
    requestedAt: receipt.requestedAt,
    lastFoodActivityAt: null,
    lastProfessionalInteractionAt: null,
    nextReviewAt: null,
    nextWeighingAt: null,
    pendingItems: 1,
    hasRecordsInReportPeriod: false,
  };
}

export function combineProfessionalPortfolioPage(input: {
  portfolioInput: ProfessionalPortfolioInput;
  pendingPage: ProfessionalAccessRequestReceiptPage;
  portfolio: ProfessionalPortfolioResult;
}): ProfessionalPortfolioResult {
  const total = input.pendingPage.total + input.portfolio.pagination.total;
  return {
    ...input.portfolio,
    items: [
      ...input.pendingPage.items.map(pendingReceiptPortfolioItem),
      ...input.portfolio.items,
    ],
    pagination: {
      page: input.portfolioInput.page,
      pageSize: input.portfolioInput.pageSize,
      total,
      totalPages:
        total === 0 ? 0 : Math.ceil(total / input.portfolioInput.pageSize),
    },
    summary: {
      ...input.portfolio.summary,
      pendingRequests: input.pendingPage.total,
    },
  };
}
