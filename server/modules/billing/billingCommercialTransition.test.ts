import { describe, expect, it } from "vitest";
import {
  getCommercialTransitionDeliverySchedule,
  getCommercialTransitionMilestones,
  getCommercialTransitionSnapshotFingerprint,
  getCommercialTransitionWindow,
  runBillingCommercialTransitionBatch,
  runBillingCommercialTransitionFinalizeBatch,
  runBillingCommercialTransitionNotificationBatch,
} from "./billingCommercialTransition";
import { billingCommercialTransitionRunSchema } from "./billingCommercialTransitionSchemas";

const baseInput = {
  cutoverKey: "launch_2026",
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

  it("normalizes the cutover instant to the persisted second precision", () => {
    const parsed = billingCommercialTransitionRunSchema.parse({
      ...baseInput,
      cutoverAt: "2026-08-29T18:00:00.987Z",
      dryRun: false,
      confirmation: baseInput.cutoverKey,
    });

    expect(parsed.cutoverAt).toBe("2026-08-29T18:00:00.000Z");
  });

  it("fingerprints the frozen cohort deterministically and changes on membership drift", () => {
    const frozen = getCommercialTransitionSnapshotFingerprint([42, 7, 42, 19]);
    expect(frozen).toBe(getCommercialTransitionSnapshotFingerprint([19, 42, 7]));
    expect(frozen).not.toBe(getCommercialTransitionSnapshotFingerprint([7, 19, 42, 99]));
    expect(frozen).toMatch(/^[a-f0-9]{64}$/);
  });

  it("plans the five binding communication milestones from the immutable window", () => {
    const validFrom = new Date("2026-08-29T18:00:00.000Z");
    const validUntil = new Date("2026-09-28T18:00:00.000Z");
    expect(getCommercialTransitionMilestones(validFrom, validUntil).map(item => [
      item.milestone,
      item.scheduledAt.toISOString(),
    ])).toEqual([
      ["start", "2026-08-29T18:00:00.000Z"],
      ["D15", "2026-09-13T18:00:00.000Z"],
      ["D7", "2026-09-21T18:00:00.000Z"],
      ["D1", "2026-09-27T18:00:00.000Z"],
      ["end", "2026-09-28T18:00:00.000Z"],
    ]);
  });

  it("uses the required email and WhatsApp retry cadences", () => {
    const scheduledAt = new Date("2026-08-29T18:00:00.000Z");
    expect(getCommercialTransitionDeliverySchedule(scheduledAt, "email").map(item => item.dueAt.toISOString())).toEqual([
      "2026-08-29T18:00:00.000Z",
      "2026-08-29T19:00:00.000Z",
      "2026-08-30T18:00:00.000Z",
    ]);
    expect(getCommercialTransitionDeliverySchedule(scheduledAt, "whatsapp").map(item => item.dueAt.toISOString())).toEqual([
      "2026-08-29T18:00:00.000Z",
      "2026-08-29T20:00:00.000Z",
      "2026-08-30T18:00:00.000Z",
    ]);
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

  it("requires confirmation for notification and finalization writes before touching storage", async () => {
    const maintenance = {
      cutoverKey: baseInput.cutoverKey,
      dryRun: false,
      batchSize: 100,
      retryFailed: false,
      confirmation: "wrong-key",
      actorUserId: 1,
    };
    await expect(runBillingCommercialTransitionNotificationBatch(maintenance)).rejects.toThrow(
      "billing_transition_confirmation_required"
    );
    await expect(runBillingCommercialTransitionFinalizeBatch(maintenance)).rejects.toThrow(
      "billing_transition_confirmation_required"
    );
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
