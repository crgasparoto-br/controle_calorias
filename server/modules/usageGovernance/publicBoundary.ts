import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";

const API_UNEXPECTED_ERROR = "API_UNEXPECTED_ERROR";
const API_UNEXPECTED_ERROR_MESSAGE = "Não foi possível atualizar a governança de consumo.";

export type GovernancePublicResponse = {
  setHeader(name: string, value: string): unknown;
};

function isExpectedGovernanceError(code: string) {
  const infrastructureFailure = /(?:persistence|database|sql|adapter|unavailable|timeout|connection|internal|unexpected)/i.test(code);
  if (infrastructureFailure) return false;
  return code.startsWith("usage_") || code.startsWith("consumption_charge_") || code.startsWith("economic_fact_");
}

export function governanceError(error: unknown, response: GovernancePublicResponse): never {
  const code = error instanceof Error ? error.message : "usage_governance_error";
  if (isExpectedGovernanceError(code)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: code });
  }
  const correlationId = crypto.randomUUID();
  response.setHeader("x-error-code", API_UNEXPECTED_ERROR);
  response.setHeader("x-correlation-id", correlationId);
  console.error("Unexpected usage-governance public-boundary failure", {
    correlationId,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: API_UNEXPECTED_ERROR_MESSAGE });
}
