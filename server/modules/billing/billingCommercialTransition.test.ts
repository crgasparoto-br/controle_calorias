import { describe, expect, it } from "vitest";
import {
  getCommercialTransitionWindow,
  runBillingCommercialTransitionBatch,
} from "./billingCommercialTransition";

const baseInput = {
  cutoverKey: "launch-2026",
  timezone: "America/Sao_Paulo",
  reason: "commercial rollout issue 898",
  batchSize: 100,
  retryFailed: false,
  actorUserId: 1,
};

describe("billing commercial transition", () => {
  it("uses one immutable 30-day absolute transition window", () => {
    const cutoverAt = new Date("2026-08-29T18:00:00.000Z");
    const window = getCommercialTransitionWindow(cutoverAt);

    expect(window.validFrom.toISOString()).toBe("2026-08-29T18:00:00.000Z");
    expect(window.validUntil.toISOString()).toBe("2026-09-28T18:00:00.000Z");
    expect(window.validFrom).not.toBe(cutoverAt);
  });

  it("requires an exact cutover confirmation before mutating", async () => {
    await expect(
      runBillingCommercialTransitionBatch({
        ...baseInput,
        cutoverAt: new Date(Date.now() - 60_000).toISOString(),
        dryRun: false,
        confirmation: "another-cutover",
      })
    ).rejects.toThrow("billing_transition_confirmation_required");
  });

  it("does not execute a cutover before its absolute instant", async () => {
    await expect(
      runBillingCommercialTransitionBatch({
        ...baseInput,
        cutoverAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        dryRun: false,
        confirmation: baseInput.cutoverKey,
      })
    ).rejects.toThrow("billing_transition_cutover_not_reached");
  });

  it("does not silently renew an already elapsed transition", async () => {
    await expect(
      runBillingCommercialTransitionBatch({
        ...baseInput,
        cutoverAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
        dryRun: false,
        confirmation: baseInput.cutoverKey,
      })
    ).rejects.toThrow("billing_transition_window_elapsed");
  });
});
