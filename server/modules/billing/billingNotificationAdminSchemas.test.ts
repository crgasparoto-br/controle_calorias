import { describe, expect, it } from "vitest";
import {
  billingAdminCampaignControlSchema,
  billingAdminNotificationRetrySchema,
} from "./billingNotificationAdminSchemas";

describe("billing notification admin schemas", () => {
  it("requires an idempotent request id and audit reason for manual retry", () => {
    const parsed = billingAdminNotificationRetrySchema.parse({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      notificationId: "fact-1",
      userId: 10,
      channel: "whatsapp",
      reason: "Retry autorizado após análise operacional",
    });
    expect(parsed.channel).toBe("whatsapp");
    expect(parsed.reason).toContain("Retry");
  });

  it("keeps campaign pause changes explicit and justified", () => {
    expect(() => billingAdminCampaignControlSchema.parse({
      campaign: "Regularização financeira",
      campaignVersion: "v2",
      paused: true,
      reason: "x",
    })).toThrow();
  });
});
