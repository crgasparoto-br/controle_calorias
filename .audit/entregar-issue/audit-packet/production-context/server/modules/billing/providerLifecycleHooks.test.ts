import { describe, expect, it, vi } from "vitest";
import {
  configureBillingProviderLifecycleHooks,
  enrichBillingProviderFinancialFact,
  runBillingProviderAfterStartContract,
} from "./providerLifecycleHooks";
import type { BillingStartContractInput } from "./subscriptionLifecycle";
import type {
  BillingPrepareContractResult,
  BillingProviderNeutralFinancialFact,
} from "./subscriptionLifecycleTypes";

const input = {
  contractKey: "hook-contract",
  providerCode: "hook-provider",
  payerUserId: 1,
  versionCode: "individual-monthly-v1",
  paymentMethod: "credit_card",
  trialChoice: "waive",
  correlationId: "hook-attempt",
} satisfies BillingStartContractInput;

const result = {
  ok: false,
  reason: "trial_already_used",
} satisfies BillingPrepareContractResult;

const fact = {
  providerCode: "hook-provider",
  providerEventId: "evt-1",
  subscriptionId: "sub-1",
  kind: "payment_confirmed",
  occurredAt: new Date("2026-08-11T12:00:00.000Z"),
  correlationId: "evt-1",
} satisfies BillingProviderNeutralFinancialFact;

describe("billing provider lifecycle hook registry", () => {
  it("runs provider-specific post-start and financial enrichment without leaking provider types into the domain service", async () => {
    const afterStartContract = vi.fn(async () => undefined);
    const enrichFinancialFact = vi.fn(async current => ({
      ...current,
      commercialConfirmationKey: "provider-key",
    }));
    configureBillingProviderLifecycleHooks("hook-provider", {
      afterStartContract,
      enrichFinancialFact,
    });

    await runBillingProviderAfterStartContract(input, result);
    const enriched = await enrichBillingProviderFinancialFact(fact);

    expect(afterStartContract).toHaveBeenCalledWith(input, result);
    expect(enriched.commercialConfirmationKey).toBe("provider-key");
  });
});
