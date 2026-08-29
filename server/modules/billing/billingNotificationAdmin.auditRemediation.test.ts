import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  event: null as null | { status: string; payload: Record<string, unknown>; dispatchStartedAt?: number },
  failFinalizationOnce: true,
  insertQuery: "",
  traces: [] as string[],
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (text, part, index) => text + part + (index < values.length ? String(values[index] ?? "") : ""),
    "",
  ),
}));
vi.mock("../../repositories/billingRepositorySupport", () => ({
  requireDb: async (getter: () => Promise<unknown>) => getter(),
  resultRows: (value: unknown) => value,
  dateOrNull: (value: unknown) => value == null ? null : new Date(String(value)),
}));
vi.mock("../../whatsappConfig", () => ({ getWhatsAppChannelConfig: () => ({ phoneNumberId: "123" }) }));
vi.mock("../whatsapp/replyTransport", () => ({
  sendWhatsAppLogicalReply: vi.fn(async (_to: string, _reply: unknown, _lifecycle: unknown, options: { traceId?: string }) => {
    state.traces.push(String(options?.traceId));
    return { primaryEffectiveOk: true };
  }),
}));
vi.mock("./billingNotificationCenter", () => ({
  presentBillingFactAsNotification: () => ({
    campaign: "past-due", title: "Pagamento pendente", whatOccurred: "Pagamento não confirmado", expectedAction: "regularizar",
    consequence: "acesso pode ser revisto", support: "suporte", actionHref: "/billing",
  }),
  deliverBillingNotificationExternally: vi.fn(async (input: { deliver: () => Promise<boolean> }) => ({ status: await input.deliver() ? "delivered" : "failed" })),
}));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({
    execute: async (query: string) => {
      if (query.includes("SELECT f.id") && query.includes("FROM billingSubscriptionFacts")) {
        return [{
          id: "fact-1", subscriptionId: "sub-1", payerUserId: 44, factType: "past_due_reminder", factVersion: 3,
          idempotencyKey: "idem-source-123", correlationId: "corr-source-456", payloadJson: "{}",
          effectiveAt: new Date("2026-08-20T00:00:00Z"), invalidatedAt: null, lifecycleState: "past_due",
          trialEndsAt: null, reconciliationRequired: false, cancelAtPeriodEnd: false, readAt: null,
          lastDeliveryChannel: null, lastDeliveryState: null, lastDeliveryAt: null, capacityResolved: false, individualRenewalResolved: false,
        }];
      }
      if (query.includes("FROM billingProviderEvents") && query.includes("eventType IN")) return [];
      if (query.includes("INSERT IGNORE INTO billingProviderEvents")) {
        state.insertQuery = query;
        if (!state.event) state.event = { status: "received", payload: {} };
        return [{ affectedRows: state.event.payload.resultStatus ? 0 : 1 }];
      }
      if (query.includes("SELECT status,payloadJson,updatedAt FROM billingProviderEvents")) {
        return state.event ? [{ status: state.event.status, payloadJson: JSON.stringify(state.event.payload), updatedAt: new Date(state.event.dispatchStartedAt ?? Date.now()) }] : [];
      }
      if (query.includes("$.dispatchStartedAt") && query.includes("UPDATE billingProviderEvents")) {
        if (!state.event) return [{ affectedRows: 0 }];
        const stale = !state.event.dispatchStartedAt || Date.now() - state.event.dispatchStartedAt >= 5 * 60 * 1000;
        if (!stale) return [{ affectedRows: 0 }];
        state.event.dispatchStartedAt = Date.now();
        return [{ affectedRows: 1 }];
      }
      if (query.includes("SELECT phoneNumber FROM whatsappConnections")) return [{ phoneNumber: "5511999999999" }];
      if (query.includes("$.resultStatus") && query.includes("UPDATE billingProviderEvents")) {
        if (state.failFinalizationOnce) { state.failFinalizationOnce = false; throw new Error("simulated-finalization-crash"); }
        if (state.event) { state.event.status = "processed"; state.event.payload.resultStatus = "delivered"; }
        return [{ affectedRows: 1 }];
      }
      return [];
    },
  })),
}));

const { retryBillingAdminNotification } = await import("./billingNotificationAdmin");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T12:00:00Z"));
  state.event = null;
  state.failFinalizationOnce = true;
  state.insertQuery = "";
  state.traces = [];
});

describe("billing notification admin audit remediation", () => {
  it("preserves source fact, idempotency and correlation as distinct identities", async () => {
    await expect(retryBillingAdminNotification({
      requestId: "retry-identity", notificationId: "fact-1", userId: 44, channel: "whatsapp", reason: "manual retry", actorUserId: 9,
    })).rejects.toThrow("simulated-finalization-crash");
    expect(state.insertQuery).toContain("fact-1");
    expect(state.insertQuery).toContain("idem-source-123");
    expect(state.insertQuery).toContain("corr-source-456");
    expect(state.insertQuery).toContain("billing-admin-retry:retry-identity");
  });

  it("repeats the same public entrypoint and key after restart without changing transport identity", async () => {
    const input = { requestId: "retry-stable", notificationId: "fact-1", userId: 44, channel: "whatsapp" as const, reason: "manual retry", actorUserId: 9 };
    await expect(retryBillingAdminNotification(input)).rejects.toThrow("simulated-finalization-crash");
    await expect(retryBillingAdminNotification(input)).resolves.toEqual({ idempotent: true, status: "pending" });
    expect(state.traces).toEqual(["billing-admin-retry:retry-stable"]);

    vi.advanceTimersByTime(6 * 60 * 1000);
    await expect(retryBillingAdminNotification(input)).resolves.toEqual({ idempotent: false, status: "delivered" });
    expect(state.traces).toEqual(["billing-admin-retry:retry-stable", "billing-admin-retry:retry-stable"]);
  });
});
