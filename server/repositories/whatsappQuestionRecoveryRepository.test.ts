import { describe, expect, it, vi } from "vitest";
import { createDrizzleWhatsAppQuestionRecoveryRepository } from "./whatsappQuestionRecoveryRepository";

describe("WhatsApp question recovery repository diagnostics", () => {
  it("reports lookup_failed when persistence is unavailable instead of returning silent empty work", async () => {
    const onWarning = vi.fn();
    const repository = createDrizzleWhatsAppQuestionRecoveryRepository({
      getDb: async () => null,
      onWarning,
    });

    const result = await repository.findRecoverableQuestionsWithDiagnostics?.({
      now: new Date("2026-09-14T00:00:00.000Z"),
      horizonMs: 20 * 60 * 1000,
      limit: 10,
    });

    expect(result).toEqual({
      candidates: [],
      diagnostics: {
        status: "lookup_failed",
        scanned: 0,
        eligible: 0,
        activeOwnerBlocked: 0,
        ineligible: 0,
        truncated: false,
      },
    });
    expect(onWarning).toHaveBeenCalledWith(
      "WhatsApp question recovery candidate lookup unavailable",
      expect.any(Error),
    );
  });
});
