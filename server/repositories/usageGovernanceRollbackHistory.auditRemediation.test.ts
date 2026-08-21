import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (text, part, index) => text + part + (index < values.length ? String(values[index] ?? "") : ""),
    "",
  ),
}));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({ execute: mocks.execute })),
}));
vi.mock("./billingRepositorySupport", () => ({ resultRows: (value: unknown) => value }));

import { recordUsageEvent } from "./usageGovernanceRepository";

const historicalEvent = {
  id: "usage-original",
  idempotencyKey: "usage:immutable:1",
  beneficiaryUserId: 7,
  payerUserId: 7,
  subscriptionId: "sub-original",
  productCode: "professional-original",
  versionCode: "v1",
  billingCycle: "monthly",
  accessSource: "active_subscription",
  operation: "meal_text",
  channel: "web",
  provider: "openai",
  model: "gpt-test",
  unitType: "tokens",
  unitCount: 10,
  estimatedCostMicros: 100,
  currency: "USD",
  eventState: "success",
  attemptRole: "primary",
  correlationId: "corr-history",
  environment: "test",
  ruleVersion: "test",
  occurredAt: new Date("2026-08-01T12:00:00.000Z"),
};

describe("usage attribution historical immutability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects replay of the historical key after plan identity changes", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(recordUsageEvent(historicalEvent)).resolves.toEqual({ created: true });

    const firstInsert = String(mocks.execute.mock.calls[0][0]);
    const fingerprintMatch = firstInsert.match(/billingUsageEvents[\s\S]*?VALUES[\s\S]*?usage-original, usage:immutable:1, ([0-9a-f]{64})/i);
    expect(fingerprintMatch?.[1]).toMatch(/^[0-9a-f]{64}$/i);
    const originalFingerprint = fingerprintMatch![1];

    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ payloadFingerprint: originalFingerprint }]);

    await expect(recordUsageEvent({
      ...historicalEvent,
      id: "usage-replayed",
      subscriptionId: "sub-new",
      productCode: "professional-new",
      versionCode: "v2",
    })).rejects.toThrow("usage_event_idempotency_conflict");

    const queries = mocks.execute.mock.calls.map(call => String(call[0]));
    expect(queries.some(query => /UPDATE\s+billingUsageEvents/i.test(query))).toBe(false);
  });

  it("accepts an identical retry without rewriting the historical row", async () => {
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await recordUsageEvent(historicalEvent);
    const firstInsert = String(mocks.execute.mock.calls[0][0]);
    const fingerprint = firstInsert.match(/billingUsageEvents[\s\S]*?VALUES[\s\S]*?usage-original, usage:immutable:1, ([0-9a-f]{64})/i)?.[1];
    expect(fingerprint).toBeTruthy();

    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ payloadFingerprint: fingerprint }]);
    await expect(recordUsageEvent({ ...historicalEvent, id: "usage-retry" }))
      .resolves.toEqual({ created: false });

    const queries = mocks.execute.mock.calls.map(call => String(call[0]));
    expect(queries.some(query => /UPDATE\s+billingUsageEvents/i.test(query))).toBe(false);
  });
});
