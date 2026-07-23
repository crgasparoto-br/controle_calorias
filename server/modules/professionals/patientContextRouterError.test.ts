import { describe, expect, it } from "vitest";
import { ProfessionalEntitlementDeniedError } from "./entitlementService";
import { professionalPatientContextRouterError } from "./patientContextRouterError";

describe("professionalPatientContextRouterError", () => {
  it.each([
    "professional_record",
    "professional_reports",
    "professional_messages",
  ] as const)("maps a revoked route entitlement to FORBIDDEN: %s", resource => {
    const mapped = professionalPatientContextRouterError(
      resource,
      new ProfessionalEntitlementDeniedError(
        "Este recurso não está disponível para o acesso profissional atual."
      )
    );

    expect(mapped).toMatchObject({
      code: "FORBIDDEN",
      message:
        "Este recurso não está disponível para o acesso profissional atual.",
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
