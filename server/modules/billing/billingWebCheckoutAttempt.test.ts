import { describe, expect, it } from "vitest";
import {
  billingWebCheckoutSignatureHash,
  decideBillingWebCheckoutAttempt,
  type BillingWebCheckoutAttemptSignature,
  type StoredBillingWebCheckoutAttempt,
} from "./billingWebCheckoutAttempt";

const base: BillingWebCheckoutAttemptSignature = {
  userId: 12,
  versionCode: "individual_monthly_v1",
  paymentMethod: "credit_card",
  trialChoice: "waive",
  couponCode: null,
};

function stored(
  overrides: Partial<StoredBillingWebCheckoutAttempt> = {}
): StoredBillingWebCheckoutAttempt {
  return {
    signatureHash: billingWebCheckoutSignatureHash(base),
    contractKey: "web_existing",
    versionCode: base.versionCode,
    paymentMethod: base.paymentMethod,
    trialChoice: base.trialChoice,
    couponCode: null,
    generation: 1,
    released: false,
    ...overrides,
  };
}

describe("billing web checkout attempt decision", () => {
  it("creates one durable claim when no attempt exists", () => {
    expect(
      decideBillingWebCheckoutAttempt({
        incoming: base,
        existing: null,
        providerState: null,
        candidateContractKey: "web_new",
      })
    ).toEqual({
      status: "claimed",
      contractKey: "web_new",
      reused: false,
      generation: 1,
      persist: true,
    });
  });

  it("reuses the same canonical key while an equivalent attempt is in flight", () => {
    expect(
      decideBillingWebCheckoutAttempt({
        incoming: { ...base, couponCode: " promo " },
        existing: stored({
          signatureHash: billingWebCheckoutSignatureHash({
            ...base,
            couponCode: "PROMO",
          }),
          couponCode: "PROMO",
        }),
        providerState: "prepared",
        candidateContractKey: "web_other_tab",
      })
    ).toMatchObject({
      status: "claimed",
      contractKey: "web_existing",
      reused: true,
      persist: false,
    });
  });

  it("blocks an incompatible plan, method or coupon while the current attempt is active", () => {
    expect(
      decideBillingWebCheckoutAttempt({
        incoming: { ...base, paymentMethod: "pix_automatic" },
        existing: stored(),
        providerState: "created",
        candidateContractKey: "web_other_tab",
      })
    ).toMatchObject({
      status: "conflict",
      contractKey: "web_existing",
      paymentMethod: "credit_card",
    });
  });

  it("rotates the canonical key after the provider attempt is terminal", () => {
    expect(
      decideBillingWebCheckoutAttempt({
        incoming: { ...base, paymentMethod: "pix_automatic" },
        existing: stored(),
        providerState: "failed",
        candidateContractKey: "web_retry",
      })
    ).toEqual({
      status: "claimed",
      contractKey: "web_retry",
      reused: false,
      generation: 2,
      persist: true,
    });
  });

  it("rotates after the backend confirms the previous subscription expired", () => {
    expect(
      decideBillingWebCheckoutAttempt({
        incoming: {
          ...base,
          replaceExisting: true,
          versionCode: "individual_yearly_v1",
        },
        existing: stored(),
        providerState: "created",
        candidateContractKey: "web_after_expiry",
      })
    ).toEqual({
      status: "claimed",
      contractKey: "web_after_expiry",
      reused: false,
      generation: 2,
      persist: true,
    });
  });

  it("allows a safe pre-provider failure to release the claim for a new signature", () => {
    expect(
      decideBillingWebCheckoutAttempt({
        incoming: { ...base, couponCode: null },
        existing: stored({ released: true, couponCode: "INVALID" }),
        providerState: null,
        candidateContractKey: "web_retry",
      })
    ).toMatchObject({
      status: "claimed",
      contractKey: "web_retry",
      reused: false,
      generation: 2,
      persist: true,
    });
  });
});
