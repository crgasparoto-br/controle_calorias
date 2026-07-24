import { TRPCError } from "@trpc/server";
import { professionalAccessRequestReceiptRepository } from "./accessRequestReceiptRepository";

const ACCESS_REQUEST_RECEIPT_UNAVAILABLE_MESSAGE =
  "Não foi possível validar a solicitação agora. Tente novamente em alguns instantes.";

export async function resolveProfessionalAccessReceiptForPatient(
  patientUserId: number,
  accessId: string
) {
  try {
    return (
      (await professionalAccessRequestReceiptRepository.resolveAuthorizationIdForPatient(
        accessId,
        patientUserId
      )) ?? accessId
    );
  } catch {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: ACCESS_REQUEST_RECEIPT_UNAVAILABLE_MESSAGE,
    });
  }
}
