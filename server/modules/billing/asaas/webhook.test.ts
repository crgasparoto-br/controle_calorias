import { describe, expect, it } from "vitest";
import {
  authenticateAsaasWebhook,
  authoritativePaymentOccurredAt,
  financialKind,
  financialKindFromPaymentStatus,
  isPixAuthorizationTerminal,
  normalizeAsaasWebhookEnvelope,
} from "./webhook";

describe("Asaas webhook boundary", () => {
  it("accepts only the exact configured asaas-access-token", () => {
    expect(
      authenticateAsaasWebhook(
        { "asaas-access-token": "secret-123" },
        "secret-123"
      )
    ).toBe(true);
    expect(
      authenticateAsaasWebhook({ "asaas-access-token": "wrong" }, "secret-123")
    ).toBe(false);
    expect(authenticateAsaasWebhook({}, "secret-123")).toBe(false);
  });

  it("normalizes only replay-safe payment metadata", () => {
    const normalized = normalizeAsaasWebhookEnvelope({
      id: "evt_1",
      event: "PAYMENT_CONFIRMED",
      dateCreated: "2026-08-11 10:30:00",
      payment: {
        id: "pay_1",
        status: "CONFIRMED",
        value: 39.9,
        dueDate: "2026-08-11",
        subscription: "sub_remote_1",
        customer: "cus_1",
        externalReference: "contract-1",
        creditCard: { number: "should-never-be-persisted" },
      },
    });
    expect(normalized.providerEventId).toBe("evt_1");
    expect(normalized.metadata).toMatchObject({
      objectId: "pay_1",
      amountMinor: 3990,
      contractReference: "contract-1",
      subscriptionReference: "sub_remote_1",
      customerReference: "cus_1",
      dueDate: "2026-08-11",
    });
    expect(JSON.stringify(normalized.metadata)).not.toContain(
      "should-never-be-persisted"
    );
  });

  it("keeps Pix instruction refusal operational while treating authorization refusal as terminal", () => {
    expect(
      financialKind("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED")
    ).toBeNull();
    expect(
      isPixAuthorizationTerminal(
        "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED"
      )
    ).toBe(true);
    expect(financialKind("PAYMENT_OVERDUE")).toBe("payment_failed");
  });

  it("treats only final payment statuses from authoritative reads as financial facts", () => {
    expect(financialKindFromPaymentStatus("PENDING")).toBeNull();
    expect(financialKindFromPaymentStatus("CONFIRMED")).toBe(
      "payment_confirmed"
    );
    expect(financialKindFromPaymentStatus("RECEIVED")).toBe(
      "payment_confirmed"
    );
    expect(financialKindFromPaymentStatus("OVERDUE")).toBe("payment_failed");
    expect(financialKindFromPaymentStatus("REFUND_REQUESTED")).toBeNull();
    expect(
      authoritativePaymentOccurredAt({
        id: "pay-1",
        status: "CONFIRMED",
        dateCreated: "2026-08-13",
      })
    ).toBeNull();
    expect(
      authoritativePaymentOccurredAt({
        id: "pay-1",
        status: "CONFIRMED",
        dateCreated: "2026-08-13",
        confirmedDate: "2026-08-14",
      })?.toISOString()
    ).toBe("2026-08-14T12:00:00.000Z");
  });

  it("normalizes Automatic Pix instruction metadata without treating raw provider data as durable state", () => {
    const normalized = normalizeAsaasWebhookEnvelope({
      id: "evt_instruction",
      event: "PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED",
      paymentInstruction: {
        id: "instruction_1",
        status: "REFUSED",
        dueDate: "2026-09-11",
        pixAutomaticAuthorizationId: "aut_1",
        internalReason: { secret: "must-not-persist" },
      },
    });
    expect(normalized.metadata).toMatchObject({
      objectId: "instruction_1",
      authorizationReference: "aut_1",
      status: "REFUSED",
      dueDate: "2026-09-11",
    });
    expect(JSON.stringify(normalized.metadata)).not.toContain(
      "must-not-persist"
    );
  });

  it("normalizes Pix Automático authorization correlation without granting access", () => {
    const normalized = normalizeAsaasWebhookEnvelope({
      id: "evt_auth",
      event: "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED",
      authorization: {
        id: "aut_1",
        status: "ACTIVE",
        customerId: "cus_1",
      },
    });
    expect(normalized.metadata).toMatchObject({
      objectId: "aut_1",
      authorizationReference: "aut_1",
      status: "ACTIVE",
    });
  });
});
