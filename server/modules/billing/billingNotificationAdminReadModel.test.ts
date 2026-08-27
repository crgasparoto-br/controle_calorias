import { describe, expect, it } from "vitest";
import {
  collectBillingAdminNotificationReadModel,
  type BillingAdminNotificationReadItem,
} from "./billingNotificationAdminReadModel";

function item(id: number, campaign: string): BillingAdminNotificationReadItem {
  return {
    notificationId: String(id),
    campaign,
    campaignVersion: "v1",
    category: "financial",
    audience: "individual",
    trigger: "renewal_confirmed",
    milestone: null,
    completionState: "completed",
    readState: "unread",
    channels: [
      { channel: "internal", state: "available", attempts: 1, definitiveFailure: false },
      { channel: "email", state: "not_attempted", attempts: 0, definitiveFailure: false },
      { channel: "whatsapp", state: "not_attempted", attempts: 0, definitiveFailure: false },
    ],
  };
}

describe("billing admin notification read model", () => {
  it("continues pagination until an older filtered communication is found", async () => {
    const rows = [
      ...Array.from({ length: 500 }, (_, index) => item(index + 1, "Recentes")),
      item(501, "Campanha alvo"),
    ];
    const calls: Array<{ offset: number; limit: number }> = [];

    const result = await collectBillingAdminNotificationReadModel({
      filter: { limit: 100, campaign: "Campanha alvo" },
      pageSize: 500,
      loadPage: async page => {
        calls.push(page);
        return rows.slice(page.offset, page.offset + page.limit);
      },
      hydrate: row => row,
    });

    expect(calls).toEqual([
      { offset: 0, limit: 500 },
      { offset: 500, limit: 500 },
    ]);
    expect(result.items.map(entry => entry.notificationId)).toEqual(["501"]);
    expect(result.matchedTotal).toBe(1);
  });

  it("builds analytics from the complete filtered population, not the visible item limit", async () => {
    const rows = [item(1, "Campanha alvo"), item(2, "Campanha alvo"), item(3, "Campanha alvo")];

    const result = await collectBillingAdminNotificationReadModel({
      filter: { limit: 1, campaign: "Campanha alvo" },
      pageSize: 2,
      loadPage: async page => rows.slice(page.offset, page.offset + page.limit),
      hydrate: row => row,
    });

    expect(result.items).toHaveLength(1);
    expect(result.matchedTotal).toBe(3);
    expect(result.analytics.find(row => row.channel === "internal")?.created).toBe(3);
  });
});
