import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sequence: [] as string[],
  fact: {
    id: "fact-1",
    factType: "past_due_notice_day_2",
    payloadJson: null,
  },
}));

const fakeDb = vi.hoisted(() => ({
  execute: vi.fn(async () => {
    state.sequence.push("db");
    return [[state.fact]];
  }),
  transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(fakeDb)
  ),
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => fakeDb),
}));

import {
  deliverBillingNotificationExternally,
  presentBillingFactAsNotification,
} from "./billingNotificationCenter";

describe("billing notification center", () => {
  beforeEach(() => {
    state.sequence.length = 0;
    fakeDb.execute.mockClear();
  });

  it("maps financial facts to user language without internal identifiers", () => {
    const notification = presentBillingFactAsNotification({
      factType: "past_due_notice_day_5",
      payloadJson: { providerEventId: "evt-secret", subscriptionId: "sub-secret" },
    });

    expect(notification).toMatchObject({
      campaign: "Regularização financeira",
      title: "Pagamento pendente",
      actionHref: "/billing",
    });
    const visible = JSON.stringify(notification);
    expect(visible).not.toContain("evt-secret");
    expect(visible).not.toContain("sub-secret");
    expect(visible).not.toContain("past_due_notice_day_5");
    expect(visible.toLowerCase()).not.toContain("backend");
    expect(visible.toLowerCase()).not.toContain("provider");
    expect(visible.toLowerCase()).not.toContain("callback");
    expect(visible.toLowerCase()).not.toContain("trial");
  });

  it("presents transition milestones without implying automatic billing", () => {
    const notification = presentBillingFactAsNotification({
      factType: "commercial_transition_notification",
      payloadJson: {
        milestone: "D7",
        validUntil: "2026-09-28T18:00:00.000Z",
        cutoverKey: "internal-key",
      },
    });

    expect(notification).toMatchObject({
      campaign: "Transição comercial",
      title: "Seu período de transição termina em 7 dias",
      actionHref: "/billing",
    });
    expect(notification?.consequence).toContain("Nenhuma cobrança ou assinatura");
    expect(JSON.stringify(notification)).not.toContain("internal-key");
  });

  it("presents mandatory professional capacity warnings with deadline and alternatives", () => {
    const notification = presentBillingFactAsNotification({
      factType: "professional_capacity_warning",
      payloadJson: {
        milestone: "D15",
        daysRemaining: 15,
        contractedLimit: 30,
        occupancy: 45,
        excess: 15,
        temporaryEndsAt: "2026-10-01T00:00:00.000Z",
      },
    });

    expect(notification?.title).toContain("15 dias");
    expect(notification?.whatOccurred).toContain("capacidade contratada de 30 pacientes");
    expect(notification?.whatOccurred).toContain("ocupação atual de 45");
    expect(notification?.expectedAction).toContain("redução natural");
    expect(notification?.expectedAction).toContain("mudança para um plano compatível");
    expect(notification?.expectedAction).toContain("administrativo");
  });

  it("explains when the portfolio exceeds every available plan without promising an automatic product", () => {
    const notification = presentBillingFactAsNotification({
      factType: "professional_capacity_admin_alert_opened",
      payloadJson: {
        occupancy: 101,
        highestPublicCapacity: 100,
      },
    });

    expect(notification?.title).toBe("Carteira encaminhada para análise comercial");
    expect(notification?.whatOccurred).toContain("maior capacidade disponível atualmente");
    expect(notification?.expectedAction).toContain("Nenhum novo plano será criado automaticamente");
  });

  it("persists delivery state before an external attempt and keeps the notification after channel failure", async () => {
    const result = await deliverBillingNotificationExternally({
      userId: 12,
      notificationId: "fact-1",
      channel: "whatsapp",
      deliver: async () => {
        state.sequence.push("external");
        return false;
      },
    });

    expect(result.status).toBe("failed");
    expect(state.sequence).toEqual(["db", "db", "external", "db", "db"]);
    expect(fakeDb.execute).toHaveBeenCalledTimes(4);
  });
});
