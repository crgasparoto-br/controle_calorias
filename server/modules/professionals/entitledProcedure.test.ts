import { describe, expect, it } from "vitest";
import {
  ProfessionalEntitlementDeniedError,
  type ProfessionalEntitlementResource,
} from "./entitlementService";
import {
  professionalEntitlementErrorCode,
  toProfessionalEntitlementTrpcError,
} from "./entitledProcedure";

const optionalResources: ProfessionalEntitlementResource[] = [
  "professional_operational_alerts",
  "professional_ai_assistance",
];

const routeResources: ProfessionalEntitlementResource[] = [
  "professional_dashboard",
  "professional_portfolio",
  "professional_record",
  "professional_messages",
  "professional_reports",
  "professional_settings",
];

describe("professional entitlement error mapping", () => {
  it.each(optionalResources)(
    "keeps a missing optional resource separate from patient access revocation: %s",
    resource => {
      const error = new ProfessionalEntitlementDeniedError("Recurso opcional ausente");

      expect(professionalEntitlementErrorCode(resource, error)).toBe(
        "PRECONDITION_FAILED"
      );
      expect(toProfessionalEntitlementTrpcError(resource, error)).toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "Recurso opcional ausente",
      });
    }
  );

  it.each(routeResources)(
    "maps a missing route entitlement to forbidden: %s",
    resource => {
      const error = new ProfessionalEntitlementDeniedError("Acesso da rota revogado");

      expect(professionalEntitlementErrorCode(resource, error)).toBe("FORBIDDEN");
      expect(toProfessionalEntitlementTrpcError(resource, error)).toMatchObject({
        code: "FORBIDDEN",
        message: "Acesso da rota revogado",
      });
    }
  );

  it("keeps inactive-profile failures forbidden even for optional resources", () => {
    expect(
      professionalEntitlementErrorCode(
        "professional_ai_assistance",
        new Error("Perfil profissional inativo")
      )
    ).toBe("FORBIDDEN");
  });
});
