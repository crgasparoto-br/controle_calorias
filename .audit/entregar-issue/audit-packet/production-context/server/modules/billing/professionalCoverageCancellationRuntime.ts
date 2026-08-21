import type {
  IndividualRenewalCancellationInput,
  IndividualRenewalCancellationResult,
} from "./professionalCoverageService";

export async function cancelIndividualRenewalForProfessionalCoverage(
  input: IndividualRenewalCancellationInput
): Promise<IndividualRenewalCancellationResult> {
  if (input.provider !== "asaas") {
    return {
      status: "pending",
      errorCode: "provider_cancellation_not_configured",
    };
  }
  try {
    const { requestAsaasCancellation } = await import("./asaas/runtime");
    await requestAsaasCancellation({
      subscriptionId: input.subscriptionId,
      payerUserId: input.payerUserId,
      correlationId: input.correlationId,
    });
    return { status: "confirmed" };
  } catch (error) {
    return {
      status: "pending",
      errorCode:
        error instanceof Error ? error.name.slice(0, 120) : "unknown_error",
    };
  }
}
