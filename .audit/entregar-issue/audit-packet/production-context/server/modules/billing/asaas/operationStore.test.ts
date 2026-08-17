import { describe, expect, it } from "vitest";
import { isAsaasProviderTerminalFailure } from "./operationStore";

describe("Asaas operation terminal policy", () => {
  it("treats only provider terminal checkout and Pix authorization outcomes as authoritative", () => {
    expect(isAsaasProviderTerminalFailure("checkout", "checkout_expired")).toBe(true);
    expect(
      isAsaasProviderTerminalFailure(
        "pix_automatic_authorization",
        "authorization_closed"
      )
    ).toBe(true);

    expect(isAsaasProviderTerminalFailure("checkout", "outcome_unknown")).toBe(false);
    expect(isAsaasProviderTerminalFailure("checkout", "unexpected")).toBe(false);
    expect(
      isAsaasProviderTerminalFailure(
        "pix_automatic_authorization",
        "provider_mutation_failed"
      )
    ).toBe(false);
    expect(isAsaasProviderTerminalFailure("reconciliation", "checkout_expired")).toBe(false);
  });
});
