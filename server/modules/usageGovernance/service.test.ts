import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSubscriptionStatus: vi.fn(),
  reserveUsageQuota: vi.fn(),
  listEconomicTelemetry: vi.fn(),
  purgeExpiredUsageTelemetry: vi.fn(),
}));

vi.mock("../billing/service", () => ({
  billingService: { getUserSubscriptionStatus: mocks.getUserSubscriptionStatus },
}));

vi.mock("../../repositories/usageGovernanceRepository", () => ({
  reserveUsageQuota: mocks.reserveUsageQuota,
  listEconomicTelemetry: mocks.listEconomicTelemetry,
  purgeExpiredUsageTelemetry: mocks.purgeExpiredUsageTelemetry,
}));

import {
  AiUsageLimitExceededError,
  enforceUsageAllowance,
  getInternalUsageAnalytics,
  runUsageRetention,
  USAGE_RETENTION_POLICY,
} from "./service";

function subscriptionStatus(input?: {
  reason?: string;
  planCode?: string;
  subscriptionPlanCode?: string;
  sponsorUserId?: number;
  entitlements?: string[];
}) {
  return {
    access: {
      allowed: true,
      reason: input?.reason ?? "active_subscription",
      ...(input?.planCode ? { planCode: input.planCode } : {}),
      ...(input?.sponsorUserId ? { sponsorUserId: input.sponsorUserId } : {}),
      entitlements: input?.entitlements ?? ["system_access"],
      sourceAvailable: true,
      evaluatedAt: new Date("2026-08-16T00:00:00.000Z"),
    },
    subscription: input?.subscriptionPlanCode
      ? { planCode: input.subscriptionPlanCode }
      : null,
    professionalSubscription: null,
  };
}

describe("usage governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_USAGE_PLAN_ALLOWANCES_JSON;
    delete process.env.AI_USAGE_ENTITLEMENT_ALLOWANCES_JSON;
    mocks.reserveUsageQuota.mockResolvedValue({ allowed: true, used: 1, limit: 180 });
  });

  it("preserves the original subscription plan when an admin override is the effective source", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue(subscriptionStatus({
      reason: "admin_override",
      subscriptionPlanCode: "individual_monthly_v1",
      entitlements: ["system_access", "assistant"],
    }));

    const result = await enforceUsageAllowance({
      userId: 42,
      capability: "QUESTION",
      origin: "whatsapp",
      flow: "whatsapp_question",
      conversationId: "wamid.raw-external-id",
    });

    expect(mocks.reserveUsageQuota).toHaveBeenCalledOnce();
    const reservation = mocks.reserveUsageQuota.mock.calls[0][0];
    expect(reservation.detail).toMatchObject({
      accessSource: "admin_override",
      effectivePlanCode: "individual_monthly_v1",
      originalSubscriptionPlanCode: "individual_monthly_v1",
      billedUserId: 42,
    });
    expect(JSON.stringify(reservation.detail)).not.toContain("wamid.raw-external-id");
    expect(result.correlation).toMatchObject({
      userId: 42,
      accessSource: "admin_override",
      planCode: "individual_monthly_v1",
      originalPlanCode: "individual_monthly_v1",
    });
  });

  it("attributes sponsored usage to the professional payer without changing the beneficiary quota owner", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue(subscriptionStatus({
      reason: "sponsored_by_professional",
      planCode: "professional_v1",
      sponsorUserId: 7,
    }));

    const result = await enforceUsageAllowance({
      userId: 99,
      capability: "QUESTION",
      origin: "whatsapp",
      flow: "whatsapp_question",
    });

    expect(mocks.reserveUsageQuota.mock.calls[0][0].userId).toBe(99);
    expect(mocks.reserveUsageQuota.mock.calls[0][0].detail.billedUserId).toBe(7);
    expect(result.correlation?.billedUserId).toBe(7);
  });

  it("supports plan-specific allowances and rejects before an outbound call when the window is exhausted", async () => {
    process.env.AI_USAGE_PLAN_ALLOWANCES_JSON = JSON.stringify({ individual_monthly_v1: 2 });
    mocks.getUserSubscriptionStatus.mockResolvedValue(subscriptionStatus({
      reason: "active_subscription",
      planCode: "individual_monthly_v1",
    }));
    mocks.reserveUsageQuota.mockResolvedValue({ allowed: false, used: 2, limit: 2 });

    await expect(enforceUsageAllowance({
      userId: 5,
      capability: "QUESTION",
      origin: "web",
      flow: "question_answer",
    })).rejects.toBeInstanceOf(AiUsageLimitExceededError);

    expect(mocks.reserveUsageQuota.mock.calls[0][0].maxCalls).toBe(2);
  });

  it("aggregates calls, tokens, provider cost and retry/timeout inflation without conversation text", async () => {
    mocks.listEconomicTelemetry.mockResolvedValue([
      {
        id: 1,
        userId: 42,
        origin: "whatsapp",
        status: "success",
        eventType: "ai.inference_call",
        createdAt: new Date("2026-08-16T00:05:00.000Z"),
        detail: JSON.stringify({
          capability: "QUESTION",
          flow: "whatsapp_question",
          callRole: "primary",
          outcome: "success",
          estimatedCostUsd: 0.01,
          usage: { totalTokens: 100 },
          correlation: { planCode: "individual_monthly_v1", accessSource: "active_subscription" },
        }),
      },
      {
        id: 2,
        userId: 42,
        origin: "whatsapp",
        status: "warning",
        eventType: "ai.inference_call",
        createdAt: new Date("2026-08-16T00:06:00.000Z"),
        detail: JSON.stringify({
          capability: "QUESTION",
          flow: "whatsapp_question",
          callRole: "retry",
          outcome: "timeout",
          estimatedCostUsd: 0.02,
          usage: { inputTokens: 50, outputTokens: 10 },
          correlation: { planCode: "individual_monthly_v1", accessSource: "active_subscription" },
        }),
      },
      {
        id: 3,
        userId: 42,
        origin: "whatsapp",
        status: "warning",
        eventType: "ai.usage_limit_exceeded",
        createdAt: new Date("2026-08-16T00:07:00.000Z"),
        detail: JSON.stringify({ capability: "QUESTION", limit: 2 }),
      },
    ]);

    const analytics = await getInternalUsageAnalytics({
      from: new Date("2026-08-16T00:00:00.000Z"),
      to: new Date("2026-08-16T01:00:00.000Z"),
    });

    expect(analytics.totals).toEqual({
      calls: 2,
      tokens: 160,
      estimatedCostUsd: 0.03,
      retryTimeoutCostUsd: 0.02,
    });
    expect(analytics.byFeatureAndPlan[0]).toMatchObject({
      feature: "whatsapp_question",
      calls: 2,
      retries: 1,
      timeouts: 1,
    });
    expect(analytics.pressureUsers[0]).toMatchObject({ userId: 42, calls: 2, limitExceeded: 1 });
  });

  it("delegates retention using the documented policy", async () => {
    mocks.purgeExpiredUsageTelemetry.mockResolvedValue({});
    const now = new Date("2026-08-16T12:00:00.000Z");
    await runUsageRetention(now);
    expect(mocks.purgeExpiredUsageTelemetry).toHaveBeenCalledWith(now);
    expect(USAGE_RETENTION_POLICY).toMatchObject({
      quotaReservationsHours: 48,
      detailedEconomicTelemetryDays: 90,
      persistedCostAggregates: false,
    });
  });
});
