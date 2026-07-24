import { TRPCError } from "@trpc/server";
import {
  registerProtectedProcedureResultPolicy,
  type ProtectedProcedureResultPolicy,
} from "../../_core/procedureResultPolicy";
import {
  professionalAccessRequestReceiptRepository,
  type ProfessionalAccessRequestReceipt,
} from "./accessRequestReceiptRepository";

export const PROFESSIONAL_REQUEST_ACCESS_PATH =
  "nutrition.professionals.requestAccess";
export const PROFESSIONAL_MY_ACCESSES_PATH =
  "nutrition.professionals.myAccesses";
export const PROFESSIONAL_PORTFOLIO_PATH =
  "nutrition.professionals.portfolio";
export const PROFESSIONAL_HISTORY_PATH = "nutrition.professionals.history";
export const PROFESSIONAL_REQUEST_ACCESS_REJECTED_MESSAGE =
  "Não foi possível enviar a solicitação com os dados informados. Confira o contato ou tente novamente mais tarde.";
export const PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE =
  "Não foi possível enviar a solicitação agora. Tente novamente em alguns instantes.";
export const PROFESSIONAL_PENDING_REQUEST_NAME =
  "Solicitação aguardando confirmação";
export const PROFESSIONAL_REJECTED_REQUEST_NAME = "Solicitação recusada";
export const PROFESSIONAL_REVOKED_REQUEST_NAME = "Acesso revogado";

const REQUEST_ACCESS_STATUSES = new Set([
  "pending",
  "approved",
  "rejected",
  "revoked",
]);
const TARGET_REJECTION_MESSAGES = new Set([
  "Nenhuma pessoa foi encontrada com esse e-mail ou celular.",
  "Profissional e pessoa acompanhada precisam ser usuários diferentes.",
]);
const INTERNAL_RECEIPT_EVENTS = new Set([
  "access_request_received",
  "access_request_linked",
]);
const PRECONSENT_HISTORY_EVENTS = new Set([
  "access_requested",
  "access_authorization_whatsapp_sent",
  "access_authorization_whatsapp_failed",
  "access_reconciled",
]);
const NON_APPROVED_HISTORY_EVENTS = new Set([
  "access_rejected",
  "access_revoked",
]);

type RequestAccessBoundaryDependencies = {
  createUnresolvedReceipt: typeof professionalAccessRequestReceiptRepository.createUnresolvedReceipt;
  createLinkedReceipt: typeof professionalAccessRequestReceiptRepository.createLinkedReceipt;
  listActiveReceipts: typeof professionalAccessRequestReceiptRepository.listActiveReceipts;
};

const defaultDependencies: RequestAccessBoundaryDependencies = {
  createUnresolvedReceipt:
    professionalAccessRequestReceiptRepository.createUnresolvedReceipt,
  createLinkedReceipt:
    professionalAccessRequestReceiptRepository.createLinkedReceipt,
  listActiveReceipts:
    professionalAccessRequestReceiptRepository.listActiveReceipts,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  return typeof record?.message === "string" ? record.message : "";
}

function errorCode(error: unknown) {
  const record = asRecord(error);
  if (typeof record?.code === "string") return record.code;
  const data = asRecord(record?.data);
  return typeof data?.code === "string" ? data.code : null;
}

function isExpectedTargetRejection(error: unknown) {
  return TARGET_REJECTION_MESSAGES.has(errorMessage(error));
}

function unavailableError() {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
  });
}

function successfulMiddlewareResult(
  record: Record<string, unknown>,
  data: unknown,
  ctx: unknown
) {
  const { error: _error, ...withoutError } = record;
  return {
    ...withoutError,
    ok: true,
    data,
    ctx: record.ctx ?? ctx,
  };
}

function publicReceipt(receipt: ProfessionalAccessRequestReceipt) {
  return {
    id: receipt.id,
    status: "pending" as const,
    requestedAt: receipt.requestedAt,
  };
}

function dedupeReceipts(receipts: ProfessionalAccessRequestReceipt[]) {
  const linkedAuthorizationIds = new Set<string>();
  return receipts.filter(receipt => {
    if (!receipt.linkedAuthorizationId) return true;
    if (linkedAuthorizationIds.has(receipt.linkedAuthorizationId)) return false;
    linkedAuthorizationIds.add(receipt.linkedAuthorizationId);
    return true;
  });
}

function receiptPortfolioItem(receipt: ProfessionalAccessRequestReceipt) {
  return {
    authorizationId: receipt.id,
    patientUserId: 0,
    patientName: PROFESSIONAL_PENDING_REQUEST_NAME,
    patientEmail: null,
    authorizationStatus: "pending" as const,
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

function receiptAccessItem(
  receipt: ProfessionalAccessRequestReceipt,
  professionalUserId: number
) {
  return {
    id: receipt.id,
    professionalUserId,
    status: "pending" as const,
    reason: "",
    requestedAt: receipt.requestedAt,
    approvedAt: null,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: null,
    responseOrigin: null,
    responseDecision: null,
    authorizationMessageStatus: null,
    authorizationMessageSentAt: null,
    authorizationMessageError: null,
    patient: null,
  };
}

function sanitizeNonApprovedAccess(value: unknown) {
  const item = asRecord(value);
  if (!item) return null;
  const status = item.status;
  if (status === "approved") return item;
  if (status === "pending") return null;
  const {
    patient: _patient,
    patientUserId: _patientUserId,
    authorizationMessageError: _authorizationMessageError,
    ...safe
  } = item;
  return {
    ...safe,
    patient: null,
    authorizationMessageError: null,
  };
}

function sanitizePortfolioItem(value: unknown) {
  const item = asRecord(value);
  if (!item) return [];
  const status = item.authorizationStatus;
  if (status === "pending") return [];
  if (status === "approved") return [item];
  if (status !== "rejected" && status !== "revoked") return [];
  return [
    {
      ...item,
      patientUserId: 0,
      patientName:
        status === "rejected"
          ? PROFESSIONAL_REJECTED_REQUEST_NAME
          : PROFESSIONAL_REVOKED_REQUEST_NAME,
      patientEmail: null,
      trackingStatus: null,
      lastFoodActivityAt: null,
      lastProfessionalInteractionAt: null,
      nextReviewAt: null,
      nextWeighingAt: null,
      pendingItems: 0,
      hasRecordsInReportPeriod: false,
    },
  ];
}

function portfolioInputAllowsReceipts(input: unknown) {
  const value = asRecord(input) ?? {};
  const page = typeof value.page === "number" ? value.page : 1;
  const search = typeof value.search === "string" ? value.search.trim() : "";
  const authorization =
    typeof value.authorizationStatus === "string"
      ? value.authorizationStatus
      : "all";
  const tracking =
    typeof value.trackingStatus === "string" ? value.trackingStatus : "all";
  const activity =
    typeof value.activity === "string" ? value.activity : "all";
  const review =
    typeof value.nextReview === "string" ? value.nextReview : "all";
  return (
    page === 1 &&
    search === "" &&
    (authorization === "all" || authorization === "pending") &&
    tracking === "all" &&
    activity === "all" &&
    review === "all"
  );
}

async function protectRequestAccessResult(
  record: Record<string, unknown>,
  professionalUserId: number,
  ctx: unknown,
  dependencies: RequestAccessBoundaryDependencies
) {
  try {
    if (record.ok) {
      const data = asRecord(record.data);
      const authorizationId = data?.id;
      const authorizationStatus = data?.status;
      const patientUserId = data?.patientUserId;
      if (
        typeof authorizationId !== "string" ||
        !authorizationId ||
        typeof authorizationStatus !== "string" ||
        !REQUEST_ACCESS_STATUSES.has(authorizationStatus) ||
        typeof patientUserId !== "number" ||
        !Number.isSafeInteger(patientUserId) ||
        patientUserId <= 0
      ) {
        throw unavailableError();
      }
      const receipt = await dependencies.createLinkedReceipt({
        professionalUserId,
        authorizationId,
        patientUserId,
        requestedAt:
          typeof data.requestedAt === "number" ? data.requestedAt : Date.now(),
      });
      return successfulMiddlewareResult(record, publicReceipt(receipt), ctx);
    }

    if (!isExpectedTargetRejection(record.error)) {
      if (errorCode(record.error) === "BAD_REQUEST") return record;
      throw unavailableError();
    }

    const receipt = await dependencies.createUnresolvedReceipt(
      professionalUserId
    );
    return successfulMiddlewareResult(record, publicReceipt(receipt), ctx);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw unavailableError();
  }
}

async function protectMyAccessesResult(
  record: Record<string, unknown>,
  professionalUserId: number,
  dependencies: RequestAccessBoundaryDependencies
) {
  if (!record.ok || !Array.isArray(record.data)) return record;
  try {
    const receipts = dedupeReceipts(
      await dependencies.listActiveReceipts(professionalUserId)
    );
    const visibleAccesses = record.data
      .map(sanitizeNonApprovedAccess)
      .filter((item): item is Record<string, unknown> => Boolean(item));
    return {
      ...record,
      data: [
        ...receipts.map(receipt =>
          receiptAccessItem(receipt, professionalUserId)
        ),
        ...visibleAccesses,
      ],
    };
  } catch {
    throw unavailableError();
  }
}

async function protectPortfolioResult(
  record: Record<string, unknown>,
  professionalUserId: number,
  input: unknown,
  dependencies: RequestAccessBoundaryDependencies
) {
  if (!record.ok) return record;
  const data = asRecord(record.data);
  if (!data || !Array.isArray(data.items)) return record;
  const safeItems = data.items.flatMap(sanitizePortfolioItem);
  try {
    const receipts = portfolioInputAllowsReceipts(input)
      ? dedupeReceipts(
          await dependencies.listActiveReceipts(professionalUserId)
        )
      : [];
    return {
      ...record,
      data: {
        ...data,
        items: [...receipts.map(receiptPortfolioItem), ...safeItems],
      },
    };
  } catch {
    throw unavailableError();
  }
}

function protectHistoryResult(record: Record<string, unknown>) {
  if (!record.ok || !Array.isArray(record.data)) return record;
  const events = record.data.flatMap(event => {
    const value = asRecord(event);
    if (!value || typeof value.eventType !== "string") return [];
    if (
      INTERNAL_RECEIPT_EVENTS.has(value.eventType) ||
      PRECONSENT_HISTORY_EVENTS.has(value.eventType)
    ) {
      return [];
    }
    if (NON_APPROVED_HISTORY_EVENTS.has(value.eventType)) {
      return [
        {
          ...value,
          patientUserId: null,
          entityId: null,
        },
      ];
    }
    return [value];
  });
  return { ...record, data: events };
}

export function createProfessionalRequestAccessPublicBoundary(
  dependencies: RequestAccessBoundaryDependencies = defaultDependencies
): ProtectedProcedureResultPolicy {
  return async ({ path, result, ctx, input }) => {
    const record = asRecord(result);
    if (!record || typeof record.ok !== "boolean") return result;

    if (path === PROFESSIONAL_REQUEST_ACCESS_PATH) {
      return protectRequestAccessResult(
        record,
        ctx.user.id,
        ctx,
        dependencies
      );
    }
    if (path === PROFESSIONAL_MY_ACCESSES_PATH) {
      return protectMyAccessesResult(record, ctx.user.id, dependencies);
    }
    if (path === PROFESSIONAL_PORTFOLIO_PATH) {
      return protectPortfolioResult(record, ctx.user.id, input, dependencies);
    }
    if (path === PROFESSIONAL_HISTORY_PATH) {
      return protectHistoryResult(record);
    }
    return result;
  };
}

export function registerProfessionalRequestAccessPublicBoundary() {
  return registerProtectedProcedureResultPolicy(
    createProfessionalRequestAccessPublicBoundary()
  );
}
