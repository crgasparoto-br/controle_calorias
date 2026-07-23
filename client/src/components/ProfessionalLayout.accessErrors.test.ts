// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isProfessionalPatientAccessUnavailableError } from "./ProfessionalLayout";

describe("professional patient access error classification", () => {
  it("treats the exact route entitlement denial as revoked access", () => {
    expect(
      isProfessionalPatientAccessUnavailableError({
        message: "Este recurso não está disponível para o acesso profissional atual.",
        data: { code: "FORBIDDEN" },
      })
    ).toBe(true);
  });

  it("does not revoke the patient for a missing optional capability", () => {
    expect(
      isProfessionalPatientAccessUnavailableError({
        message: "Este recurso não está disponível para o acesso profissional atual.",
        data: { code: "PRECONDITION_FAILED" },
      })
    ).toBe(false);
  });

  it("still recognizes a revoked patient authorization without a tRPC code", () => {
    expect(
      isProfessionalPatientAccessUnavailableError(
        new Error("O acesso a este paciente não está mais disponível.")
      )
    ).toBe(true);
  });
});
