import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
}));

import {
  assertProfessionalMessageRetryAccess,
  ProfessionalMessageAccessUnavailableError,
} from "./messageRetryAccess";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
});

describe("assertProfessionalMessageRetryAccess", () => {
  it("keeps approved and concurrently consumed retries idempotent", async () => {
    mocks.execute
      .mockResolvedValueOnce([
        [{ messageId: "message-1", authorizationStatus: "approved" }],
      ])
      .mockResolvedValueOnce([[]]);

    await expect(
      assertProfessionalMessageRetryAccess(7, "message-1")
    ).resolves.toBeUndefined();
    await expect(
      assertProfessionalMessageRetryAccess(7, "message-1")
    ).resolves.toBeUndefined();
  });

  it.each(["revoked", "rejected", "pending", null])(
    "classifies a known message with authorization %s as revoked access",
    async authorizationStatus => {
      mocks.execute.mockResolvedValueOnce([
        [{ messageId: "message-1", authorizationStatus }],
      ]);

      await expect(
        assertProfessionalMessageRetryAccess(7, "message-1")
      ).rejects.toBeInstanceOf(ProfessionalMessageAccessUnavailableError);
    }
  );

  it("fails closed without misclassifying a temporary database outage", async () => {
    mocks.getDb.mockResolvedValue(null);

    await expect(
      assertProfessionalMessageRetryAccess(7, "message-1")
    ).rejects.toThrow(
      "As mensagens profissionais estão temporariamente indisponíveis."
    );
  });
});
