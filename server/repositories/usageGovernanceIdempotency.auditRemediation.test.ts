import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resultRows: vi.fn((value: unknown) => value),
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: Array.from(strings), values }),
}));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({ execute: mocks.execute })),
}));
vi.mock("./billingRepositorySupport", () => ({ resultRows: mocks.resultRows }));

import { recordUsageEvent, type UsageEventInput } from "./usageGovernanceRepository";

function usageEvent(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  return {
    id: "event-1",
    idempotencyKey: "callback:message-1",
    beneficiaryUserId: 42,
    patientUserId: 42,
    sponsorUserId: 7,
    payerUserId: 7,
    subscriptionId: "sub-professional",
    productCode: "product-neighbor-b",
    versionCode: "version-neighbor-c",
    billingCycle: "monthly",
    accessSource: "sponsored_by_professional",
    operation: "whatsapp_question",
    channel: "whatsapp",
    provider: "openai",
    model: "gpt-4o-mini",
    unitType: "tokens",
    unitCount: 100,
    estimatedCostMicros: 1250,
    effectiveCostMicros: null,
    currency: "USD",
    eventState: "success",
    attemptRole: "primary",
    retryRootKey: null,
    correlationId: "corr-1",
    environment: "test",
    ruleVersion: "test-rule",
    metadata: { source: "callback" },
    occurredAt: new Date("2026-08-18T12:00:00.000Z"),
    ...overrides,
  };
}

function payloadFingerprint(input: UsageEventInput) {
  const canonical = JSON.stringify({
    idempotencyKey: input.idempotencyKey, beneficiaryUserId: input.beneficiaryUserId,
    patientUserId: input.patientUserId ?? null, sponsorUserId: input.sponsorUserId ?? null,
    payerUserId: input.payerUserId, subscriptionId: input.subscriptionId ?? null,
    productCode: input.productCode ?? null, versionCode: input.versionCode ?? null,
    billingCycle: input.billingCycle ?? null, accessSource: input.accessSource,
    operation: input.operation, channel: input.channel, provider: input.provider ?? null,
    model: input.model ?? null, unitType: input.unitType, unitCount: input.unitCount,
    estimatedCostMicros: input.estimatedCostMicros ?? null, effectiveCostMicros: input.effectiveCostMicros ?? null,
    currency: input.currency ?? null, eventState: input.eventState, attemptRole: input.attemptRole,
    retryRootKey: input.retryRootKey ?? null, correlationId: input.correlationId,
    environment: input.environment, ruleVersion: input.ruleVersion,
    metadata: input.metadata ?? null,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

describe("usage governance idempotency audit remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resultRows.mockImplementation((value: unknown) => value);
  });

  it("creates the first durable event for a new idempotency key", async () => {
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(recordUsageEvent(usageEvent())).resolves.toEqual({ created: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("treats a persisted same-key same-payload replay after restart as the same event", async () => {
    const input = usageEvent({ id: "event-after-restart" });
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ payloadFingerprint: payloadFingerprint(input) }]);

    await expect(recordUsageEvent(input)).resolves.toEqual({ created: false });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects reprocessing that reuses the idempotency key with a different payload", async () => {
    const original = usageEvent();
    const changed = usageEvent({ id: "event-conflict", unitCount: 101 });
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ payloadFingerprint: payloadFingerprint(original) }]);

    await expect(recordUsageEvent(changed)).rejects.toThrow("usage_event_idempotency_conflict");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
