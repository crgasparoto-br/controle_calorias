import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resultRows: vi.fn((value: unknown) => value as Record<string, unknown>[]),
}));

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({ execute: mocks.execute })),
}));
vi.mock("./billingRepositorySupport", () => ({ resultRows: mocks.resultRows }));

const { claimUsageProviderDispatch } = await import("./usageProviderDispatchRepository");

describe("usage provider dispatch claim", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically claims a reserved position exactly once", async () => {
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(claimUsageProviderDispatch("meta:whatsapp:1", new Date("2026-08-17T18:00:00.000Z")))
      .resolves.toEqual({ claimed: true, state: "provider_dispatch_started" });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("closes a stale started lease as uncertain without acquiring a new provider claim", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ eventState: "provider_dispatch_started", providerDispatchStartedAt: "2026-08-17T17:50:00.000Z" }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(claimUsageProviderDispatch("meta:whatsapp:2", new Date("2026-08-17T18:00:00.000Z")))
      .resolves.toEqual({ claimed: false, state: "provider_dispatch_uncertain" });
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });

  it("does not steal a recent in-flight provider claim", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ eventState: "provider_dispatch_started", providerDispatchStartedAt: "2026-08-17T17:59:00.000Z" }])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(claimUsageProviderDispatch("meta:whatsapp:3", new Date("2026-08-17T18:00:00.000Z")))
      .resolves.toEqual({ claimed: false, state: "provider_dispatch_started" });
  });
});
