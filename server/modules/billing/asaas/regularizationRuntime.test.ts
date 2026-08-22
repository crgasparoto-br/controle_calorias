import { describe, expect, it } from "vitest";
import {
  safeAsaasInvoiceUrl,
  selectAsaasRegularizationPayment,
} from "./regularizationRuntime";

describe("Asaas regularization flow", () => {
  it("accepts only HTTPS invoice URLs hosted by Asaas", () => {
    expect(safeAsaasInvoiceUrl("https://www.asaas.com/i/abc")).toContain(
      "https://www.asaas.com/i/abc"
    );
    expect(safeAsaasInvoiceUrl("https://sandbox.asaas.com/i/abc")).toContain(
      "https://sandbox.asaas.com/i/abc"
    );
    expect(safeAsaasInvoiceUrl("http://www.asaas.com/i/abc")).toBeNull();
    expect(safeAsaasInvoiceUrl("https://asaas.com.evil.test/i/abc")).toBeNull();
    expect(safeAsaasInvoiceUrl("javascript:alert(1)")).toBeNull();
  });

  it("selects the oldest actionable overdue payment without creating another charge", () => {
    const payment = selectAsaasRegularizationPayment({
      externalSubscriptionId: "sub_1",
      now: new Date("2026-08-22T12:00:00.000Z"),
      payments: [
        {
          id: "paid",
          subscription: "sub_1",
          status: "RECEIVED",
          dueDate: "2026-08-01",
          invoiceUrl: "https://www.asaas.com/i/paid",
        },
        {
          id: "late-2",
          subscription: "sub_1",
          status: "OVERDUE",
          dueDate: "2026-08-15",
          invoiceUrl: "https://www.asaas.com/i/late-2",
        },
        {
          id: "late-1",
          subscription: "sub_1",
          status: "OVERDUE",
          dueDate: "2026-08-10",
          invoiceUrl: "https://www.asaas.com/i/late-1",
        },
      ],
    });

    expect(payment?.id).toBe("late-1");
    expect(payment?.safeInvoiceUrl).toContain("/i/late-1");
  });

  it("does not expose a future pending charge or an untrusted invoice URL", () => {
    expect(
      selectAsaasRegularizationPayment({
        externalSubscriptionId: "sub_1",
        now: new Date("2026-08-22T12:00:00.000Z"),
        payments: [
          {
            id: "future",
            subscription: "sub_1",
            status: "PENDING",
            dueDate: "2026-09-01",
            invoiceUrl: "https://www.asaas.com/i/future",
          },
          {
            id: "unsafe",
            subscription: "sub_1",
            status: "OVERDUE",
            dueDate: "2026-08-10",
            invoiceUrl: "https://attacker.test/pay",
          },
        ],
      })
    ).toBeNull();
  });
});