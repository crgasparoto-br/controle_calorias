import { TRPCError } from "@trpc/server";
import {
  registerProtectedProcedureResultPolicy,
  type ProtectedProcedureResultPolicy,
} from "../../_core/procedureResultPolicy";
import {
  professionalAccessRequestReceiptRepository,
  type ProfessionalAccessRequestReceipt,
} from "./accessRequestReceiptRepository";
import { approvePatientAccess, revokePatientAccess } from "./service";
import { PROFESSIONAL_PENDING_REQUEST_NAME } from "./portfolioPagination";

export const PROFESSIONAL_REQUEST_ACCESS_PATH =
  "nutrition.professionals.requestAccess";
export const PROFESSIONAL_MY_ACCESSES_PATH =
  "nutrition.professionals.myAccesses";
export const PROFESSIONAL_PORTFOLIO_PATH = "nutrition.professionals.portfolio";
export const PROFESSIONAL_HISTORY_PATH = "nutrition.professionals.history";
export const PROFESSIONAL_APPROVE_ACCESS_PATH =
  "nutrition.professionals.approveAccess";
export const PROFESSIONAL_REVOKE_ACCESS_PATH =
  "nutrition.professionals.revokeAccess";
export const PROFESSIONAL_REQUEST_ACCESS_REJECTED_MESSAGE =
  "Não foi possível enviar a solicitação com os dados informados. Confira o contato ou tente novamente mais tarde.";
export const PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE =
  "Não foi possível enviar a solicitação agora. Tente novamente em alguns instantes.";
export { PROFESSIONAL_PENDING_REQUEST_NAME };
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
  resolveAuthorizationIdForPatient: typeof professionalAccessRequestReceiptRepository.resolveAuthorizationIdForPatient;
  listActiveReceipts: typeof professionalAccessRequestReceiptRepository.listActiveReceipts;
  approveAccess: typeof approvePatientAccess;
  revokeAccess: typeof revokePatientAccess;
};

const defaultDependencies: RequestAccessBoundaryDependencies = {
  createUnresolvedReceipt:
    professionalAccessRequestReceiptRepository.createUnresolvedReceipt,
  createLinkedReceipt:
    professionalAccessRequestReceiptRepository.createLinkedReceipt,
  resolveAuthorizationIdForPatient:
    professionalAccessRequestReceiptRepository.resolveAuthorizationIdForPatient,
  listActiveReceipts:
    professionalAccessRequestReceiptRepository.listActiveReceipts,
  approveAccess: approvePatientAccess,
  revokeAccess: revokePatientAccess,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function errorMessages(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return [];
  if (typeof error === "string") return [error];
  if (typeof error !== "object") return [];
  seen.add(error);

  const messages: string[] = [];
  if (error instanceof Error && error.message) messages.push(error.message);
  const record = asRecord(error);
  if (!record) return messages;
  if (typeof record.message === "string") messages.push(record.message);
  for (const nested of [record.cause, record.error, record.data]) {
    messages.push(...errorMessages(nested, seen));
  }
  return Array.from(new Set(messages));
}

function errorCode(error: unknown, seen = new Set<unknown>()): string | null {
  if (!error || typeof error !== "object" || seen.has(error)) return null;
  seen.add(error);
  const record = asRecord(error);
  if (!record) return null;
  if (typeof record.code === "string") return record.code;
  for (const nested of [record.cause, record.error, record.data]) {
    const code = errorCode(nested, seen);
    if (code) return code;
  }
  return null;
}

function isExpectedTargetRejection(error: unknown) {
  return errorMessages(error).some(message =>
    TARGET_REJECTION_MESSAGES.has(message)
  );
}

function unavailableError(cause?: unknown) {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
    cause,
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

function approvedAccessResult(data: Record<string, unknown>) {
  return {
    id: data.id,
    status: "approved" as const,
    requestedAt:
      typeof data.requestedAt === "number" ? data.requestedAt : Date.now(),
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
  if (status === "pending") {
    if (typeof item.authorizationId !== "string" || !item.authorizationId) {
      return [];
    }
    return [
      {
        authorizationId: item.authorizationId,
        patientUserId: 0,
        patientName: PROFESSIONAL_PENDING_REQUEST_NAME,
        patientEmail: null,
        authorizationStatus: "pending" as const,
        trackingStatus: null,
        requestedAt:
          typeof item.requestedAt === "number" ? item.requestedAt : 0,
        lastFoodActivityAt: null,
        lastProfessionalInteractionAt: null,
        nextReviewAt: null,
        nextWeighingAt: null,
        pendingItems: 1,
        hasRecordsInReportPeriod: false,
      },
    ];
  }
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
      if (authorizationStatus === "approved") {
        return successfulMiddlewareResult(
          record,
          approvedAccessResult(data),
          ctx
        );
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
      throw unavailableError(record.error);
    }

    const receipt =
      await dependencies.createUnresolvedReceipt(professionalUserId);
    return successfulMiddlewareResult(record, publicReceipt(receipt), ctx);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw unavailableError(error);
  }
}

async function protectMyAccessesResult(
  record: Record<string, unknown>,
  professionalUserId: number,
  dependencies: RequestAccessBoundaryDependencies
) {
  if (!record.ok || !Array.isArray(record.data)) return record;
  try {
    const receipts = await dependencies.listActiveReceipts(professionalUserId);
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
  } catch (error) {
    throw unavailableError(error);
  }
}

function protectPortfolioResult(record: Record<string, unknown>) {
  if (!record.ok) return record;
  const data = asRecord(record.data);
  if (!data || !Array.isArray(data.items)) return record;
  return {
    ...record,
    data: {
      ...data,
      items: data.items.flatMap(sanitizePortfolioItem),
    },
  };
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

async function protectPatientDecisionResult(
  path: string,
  record: Record<string, unknown>,
  input: unknown,
  patientUserId: number,
  ctx: unknown,
  dependencies: RequestAccessBoundaryDependencies
) {
  if (record.ok) return record;
  const accessId = asRecord(input)?.accessId;
  if (typeof accessId !== "string" || !accessId) return record;

  let authorizationId: string | null;
  try {
    authorizationId = await dependencies.resolveAuthorizationIdForPatient(
      accessId,
      patientUserId
    );
  } catch (error) {
    throw unavailableError(error);
  }
  if (!authorizationId) return record;

  try {
    const data =
      path === PROFESSIONAL_APPROVE_ACCESS_PATH
        ? await dependencies.approveAccess(patientUserId, authorizationId)
        : await dependencies.revokeAccess(patientUserId, authorizationId);
    return successfulMiddlewareResult(record, data, ctx);
  } catch (error) {
    throw unavailableError(error);
  }
}

export function createProfessionalRequestAccessPublicBoundary(
  dependencies: RequestAccessBoundaryDependencies = defaultDependencies
): ProtectedProcedureResultPolicy {
  return async ({ path, result, ctx, input }) => {
    const record = asRecord(result);
    if (!record || typeof record.ok !== "boolean") return result;

    if (path === PROFESSIONAL_REQUEST_ACCESS_PATH) {
      return protectRequestAccessResult(record, ctx.user.id, ctx, dependencies);
    }
    if (path === PROFESSIONAL_MY_ACCESSES_PATH) {
      return protectMyAccessesResult(record, ctx.user.id, dependencies);
    }
    if (path === PROFESSIONAL_PORTFOLIO_PATH) {
      return protectPortfolioResult(record);
    }
    if (path === PROFESSIONAL_HISTORY_PATH) {
      return protectHistoryResult(record);
    }
    if (
      path === PROFESSIONAL_APPROVE_ACCESS_PATH ||
      path === PROFESSIONAL_REVOKE_ACCESS_PATH
    ) {
      return protectPatientDecisionResult(
        path,
        record,
        input,
        ctx.user.id,
        ctx,
        dependencies
      );
    }
    return result;
  };
}

export function registerProfessionalRequestAccessPublicBoundary() {
  return registerProtectedProcedureResultPolicy(
    createProfessionalRequestAccessPublicBoundary()
  );
}
