import { describe, expect, it, vi } from "vitest";

vi.mock("./service", () => ({ billingService: {} }));
vi.mock("./catalogRuntime", () => ({ billingCatalogService: {} }));
vi.mock("../onboarding/whatsappLeadService", () => ({ activateWhatsappOnboardingUser: vi.fn() }));

import { billingRouter } from "./router";

const regularUserContext = {
  user: { id: 71, email: "user@example.com", name: "user", role: "user" },
} as any;

describe("billing rollout admin authorization", () => {
  it("blocks rollout overview for a regular user", async () => {
    const caller = billingRouter.createCaller(regularUserContext);
    await expect(caller.adminRolloutOverview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks rollout pause mutation for a regular user before any resolver effect", async () => {
    const caller = billingRouter.createCaller(regularUserContext);
    await expect(caller.adminSetRolloutPause({
      phase: "pilot_a",
      paused: true,
      scope: "all",
      reason: "Pausa administrativa",
      reinforcedConfirmation: false,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
