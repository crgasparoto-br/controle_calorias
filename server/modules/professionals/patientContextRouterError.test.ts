import { describe, expect, it } from "vitest";
import {
  ProfessionalEntitlementVerificationUnavailableError,
  ProfessionalResourceDeniedError,
} from "./entitlementAccess";
import { professionalPatientContextRouterError } from "./patientContextRouterError";

describe("professionalPatientContextRouterError", () => {
  it.each([
    "professional_record",
    "professional_reports",
    "professional_messages",
  ] as const)("maps a revoked route entitlement to FORBIDDEN: %s", resource => {
    const mapped = professionalPatientContextRouterError(
      resource,
      new ProfessionalResourceDeniedError(
        "Este recurso não está disponível para o acesso profissional atual."
      )
    );

    expect(mapped).toMatchObject({
      code: "FORBIDDEN",
      message:
        "Este recurso não está disponível para o acesso profissional atual.",
    });
  });

  it("maps entitlement verification outages to a recoverable service error", () => {
    const mapped = professionalPatientContextRouterError(
      "professional_reports",
      new ProfessionalEntitlementVerificationUnavailableError()
    );

    expect(mapped).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Não foi possível verificar o acesso profissional neste momento.",
    });
  });

  it("preserves temporary context failures without misclassifying them", () => {
    const temporary = new Error(
      "Não foi possível confirmar a autorização do paciente neste momento."
    );

    expect(
      professionalPatientContextRouterError("professional_reports", temporary)
    ).toBe(temporary);
  });
});
