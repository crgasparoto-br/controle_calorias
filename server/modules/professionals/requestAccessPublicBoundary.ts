import { TRPCError } from "@trpc/server";
import { registerProtectedProcedureResultPolicy } from "../../_core/procedureResultPolicy";

export const PROFESSIONAL_REQUEST_ACCESS_PATH =
  "nutrition.professionals.requestAccess";
export const PROFESSIONAL_REQUEST_ACCESS_REJECTED_MESSAGE =
  "Não foi possível enviar a solicitação com os dados informados. Confira o contato ou tente novamente mais tarde.";
export const PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE =
  "Não foi possível enviar a solicitação agora. Tente novamente em alguns instantes.";

const REQUEST_ACCESS_STATUSES = new Set([
  "pending",
  "approved",
  "rejected",
  "revoked",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function errorCode(error: unknown) {
  const record = asRecord(error);
  return typeof record?.code === "string" ? record.code : null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  return typeof record?.message === "string" ? record.message : "";
}

function isExpectedRequestRejection(error: unknown) {
  const code = errorCode(error);
  if (code === "BAD_REQUEST" || code === "NOT_FOUND") return true;

  const message = errorMessage(error);
  return [
    "Nenhuma pessoa foi encontrada com esse e-mail ou celular.",
    "Profissional e pessoa acompanhada precisam ser usuários diferentes.",
  ].includes(message);
}

export function sanitizeProfessionalRequestAccessResult(result: unknown) {
  const record = asRecord(result);
  if (!record || typeof record.ok !== "boolean") return result;

  if (record.ok) {
    const data = asRecord(record.data);
    const id = data?.id;
    const status = data?.status;
    if (
      typeof id !== "string" ||
      !id ||
      typeof status !== "string" ||
      !REQUEST_ACCESS_STATUSES.has(status)
    ) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
      });
    }
    return { ...record, data: { id, status } };
  }

  const error = record.error;
  if (isExpectedRequestRejection(error)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: PROFESSIONAL_REQUEST_ACCESS_REJECTED_MESSAGE,
    });
  }

  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
  });
}

export function registerProfessionalRequestAccessPublicBoundary() {
  return registerProtectedProcedureResultPolicy(({ path, result }) =>
    path === PROFESSIONAL_REQUEST_ACCESS_PATH
      ? sanitizeProfessionalRequestAccessResult(result)
      : result
  );
}
