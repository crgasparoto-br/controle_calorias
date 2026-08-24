import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordUsageEvent: vi.fn(),
  claimUsageProviderDispatch: vi.fn(),
  finalizeUsageProviderDispatch: vi.fn(),
}));

vi.mock("../../repositories/usageGovernanceRepository", () => ({
  recordUsageEvent: mocks.recordUsageEvent,
}));
vi.mock("../../repositories/usageProviderDispatchRepository", () => ({
  claimUsageProviderDispatch: mocks.claimUsageProviderDispatch,
  finalizeUsageProviderDispatch: mocks.finalizeUsageProviderDispatch,
}));

import { prepareAiProviderAttemptUsage } from "./providerAttemptUsage";

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    executionId: "exec-commercial-identity",
    capability: "QUESTION",
    flow: "whatsapp_question",
    origin: "whatsapp",
    provider: "openai",
    model: "gpt-4o-mini",
    callRole: "primary" as const,
    attemptIndex: 1,
    correlation: {
      beneficiaryUserId: 42,
      payerUserId: 7,
      sponsorUserId: 7,
      subscriptionId: "sub-professional",
      planCode: "plan-neighbor-a",
      productCode: "product-neighbor-b",
      versionCode: "version-neighbor-c",
      billingCycle: "monthly",
      accessSource: "sponsored_by_professional",
    },
    ...overrides,
  };
}

describe("AI provider-attempt usage audit remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE;
    mocks.recordUsageEvent.mockResolvedValue({ created: true });
    mocks.claimUsageProviderDispatch.mockResolvedValue({ claimed: true, state: "provider_dispatch_started" });
  });

  it("preserves distinct plan/product/version identities at the durable reservation boundary", async () => {
    await prepareAiProviderAttemptUsage(attempt());

    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: "sub-professional",
      productCode: "product-neighbor-b",
      versionCode: "version-neighbor-c",
    }));
    const persisted = mocks.recordUsageEvent.mock.calls[0]?.[0];
    expect(persisted.versionCode).not.toBe("plan-neighbor-a");
  });

  it("reuses the same idempotency key when the same logical provider attempt is prepared again", async () => {
    await prepareAiProviderAttemptUsage(attempt());
    await prepareAiProviderAttemptUsage(attempt());

    const first = mocks.recordUsageEvent.mock.calls[0]?.[0];
    const second = mocks.recordUsageEvent.mock.calls[1]?.[0];
    expect(first.idempotencyKey).toBe("ai:exec-commercial-identity:primary:1");
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("assigns a distinct durable identity to a retry while keeping the execution as retry root", async () => {
    await prepareAiProviderAttemptUsage(attempt());
    await prepareAiProviderAttemptUsage(attempt({ callRole: "retry" as const, attemptIndex: 2 }));

    const primary = mocks.recordUsageEvent.mock.calls[0]?.[0];
    const retry = mocks.recordUsageEvent.mock.calls[1]?.[0];
    expect(retry.idempotencyKey).not.toBe(primary.idempotencyKey);
    expect(retry).toMatchObject({
      idempotencyKey: "ai:exec-commercial-identity:retry:2",
      retryRootKey: "exec-commercial-identity",
    });
  });
});
