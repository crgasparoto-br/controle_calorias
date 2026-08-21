import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiInferenceEvent } from "../../_core/ai/observability";

const mocks = vi.hoisted(() => ({
  getUserSubscriptionStatus: vi.fn(),
  getActiveUsageLimitation: vi.fn(),
  hasActiveUsageExemption: vi.fn(),
  recordUsageEvent: vi.fn(),
}));

vi.mock("../billing/service", () => ({
  billingService: { getUserSubscriptionStatus: mocks.getUserSubscriptionStatus },
}));

vi.mock("../../repositories/usageGovernanceRepository", () => ({
  getActiveUsageLimitation: mocks.getActiveUsageLimitation,
  listEconomicFactsPage: vi.fn(async () => []),
  listMonthlyEconomicAggregates: vi.fn(async () => []),
  listUsageDailyAggregatesPage: vi.fn(async () => []),
  listUsageEventsPage: vi.fn(async () => []),
  recordEconomicFact: vi.fn(async () => ({ created: true })),
  recordUsageEvent: mocks.recordUsageEvent,
  refreshUsageDailyAggregates: vi.fn(async () => undefined),
  upsertMonthlyEconomicAggregate: vi.fn(async () => undefined),
}));

vi.mock("../../repositories/usageGovernancePolicyRepository", () => ({
  hasActiveUsageExemption: mocks.hasActiveUsageExemption,
}));

vi.mock("../../repositories/usageGovernanceRetentionRepository", () => ({
  purgeUsageGovernanceRetention: vi.fn(async () => undefined),
}));

vi.mock("./providerAttemptUsage", () => ({
  prepareAiProviderAttemptUsage: vi.fn(),
  finalizeAiProviderAttemptUsage: vi.fn(),
}));

import {
  enforceUsageAllowance,
  recordAiEconomicUsage,
  recordDirectProcessingUsage,
} from "./service";

const individualSubscription = {
  id: "sub-individual",
  provider: "manual",
  planCode: "individual-monthly",
  productCode: "individual-product",
  versionCode: "individual-version-3",
  planName: "Individual",
  status: "active" as const,
  billingCycle: "monthly" as const,
  currency: "BRL",
  unitAmount: 4900,
  currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
  cancelAtPeriodEnd: false,
};

const professionalSubscription = {
  id: "sub-professional",
  provider: "manual",
  planId: "plan-professional",
  planCode: "professional-monthly",
  productCode: "professional-product",
  versionCode: "professional-version-7",
  planName: "Professional",
  status: "active" as const,
  billingCycle: "monthly" as const,
  currency: "BRL",
  unitAmount: 14900,
  currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
  cancelAtPeriodEnd: false,
  capacityLimit: 25,
  capacityUsed: 3,
  entitlements: ["system_access"],
};

function professionalSelfStatus() {
  return {
    access: {
      allowed: true,
      reason: "active_subscription" as const,
      planCode: individualSubscription.planCode,
      productCode: individualSubscription.productCode,
      versionCode: individualSubscription.versionCode,
      entitlements: ["system_access"],
      sourceAvailable: true,
      evaluatedAt: new Date(),
    },
    subscription: individualSubscription,
    professionalSubscription,
  };
}

function sponsoredPatientStatus() {
  return {
    access: {
      allowed: true,
      reason: "sponsored_by_professional" as const,
      sponsorUserId: 7,
      planCode: professionalSubscription.planCode,
      productCode: professionalSubscription.productCode,
      versionCode: professionalSubscription.versionCode,
      entitlements: ["system_access"],
      sourceAvailable: true,
      evaluatedAt: new Date(),
    },
    subscription: individualSubscription,
    professionalSubscription,
  };
}

function inferenceEvent(
  executionId: string,
  correlation: Record<string, string | number | boolean | null>,
): AiInferenceEvent {
  return {
    schemaVersion: 1,
    occurredAt: "2026-08-18T09:00:00.000Z",
    executionId,
    capability: "QUESTION",
    origin: "whatsapp",
    flow: "whatsapp_question",
    configuredProvider: "openai",
    configuredModel: "gpt-4o-mini",
    effectiveProvider: "openai",
    effectiveModel: "gpt-4o-mini",
    callRole: "primary",
    attemptIndex: 1,
    totalAttempts: 1,
    latencyMs: 10,
    totalLatencyMs: 10,
    outcome: "success",
    usage: { totalTokens: 100 },
    tools: [],
    estimatedCostUsd: 0.001,
    executionEstimatedCostUsd: 0.001,
    pricingCatalogVersion: "test",
    pricingEffectiveDate: "2026-08-01",
    fallback: {
      requested: false,
      enabled: false,
      kind: "none",
      eligibility: "not_needed",
      reason: "primary_succeeded",
      primaryAttempts: 1,
      fallbackCalls: 0,
    },
    degradation: "none",
    correlation,
  };
}

describe("usage governance commercial identity audit remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE;
    mocks.getActiveUsageLimitation.mockResolvedValue([]);
    mocks.hasActiveUsageExemption.mockResolvedValue(false);
    mocks.recordUsageEvent.mockResolvedValue({ created: true });
  });

  it("attributes professional self-use to the professional subscription and preserves product/version through AI measurement", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue(professionalSelfStatus());

    const allowance = await enforceUsageAllowance({
      userId: 7,
      capability: "QUESTION",
      origin: "whatsapp",
      flow: "whatsapp_question",
      conversationId: "private-conversation",
    });

    expect(allowance.correlation).toMatchObject({
      beneficiaryUserId: 7,
      payerUserId: 7,
      sponsorUserId: 0,
      subscriptionId: professionalSubscription.id,
      planCode: professionalSubscription.planCode,
      productCode: professionalSubscription.productCode,
      versionCode: professionalSubscription.versionCode,
    });

    await recordAiEconomicUsage(
      inferenceEvent("exec-self", allowance.correlation!),
    );

    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      beneficiaryUserId: 7,
      payerUserId: 7,
      sponsorUserId: null,
      subscriptionId: professionalSubscription.id,
      productCode: professionalSubscription.productCode,
      versionCode: professionalSubscription.versionCode,
    }));
  });

  it("uses the same professional commercial identity for direct self-processing", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue(professionalSelfStatus());

    await recordDirectProcessingUsage({
      userId: 7,
      idempotencyKey: "direct-self-identity",
      operation: "image_overlay",
      channel: "whatsapp",
      unitType: "pixels",
      unitCount: 100,
      correlationId: "corr-self",
    });

    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      beneficiaryUserId: 7,
      payerUserId: 7,
      sponsorUserId: null,
      subscriptionId: professionalSubscription.id,
      productCode: professionalSubscription.productCode,
      versionCode: professionalSubscription.versionCode,
    }));
  });

  it("keeps a sponsored patient as beneficiary while using the sponsor commercial identity", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue(sponsoredPatientStatus());

    const allowance = await enforceUsageAllowance({
      userId: 99,
      capability: "QUESTION",
      origin: "whatsapp",
      flow: "whatsapp_question",
    });

    expect(allowance.correlation).toMatchObject({
      beneficiaryUserId: 99,
      payerUserId: 7,
      sponsorUserId: 7,
      subscriptionId: professionalSubscription.id,
      productCode: professionalSubscription.productCode,
      versionCode: professionalSubscription.versionCode,
    });
  });

  it("does not redirect ordinary individual use when no professional subscription exists", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue({
      ...professionalSelfStatus(),
      professionalSubscription: null,
    });

    const allowance = await enforceUsageAllowance({
      userId: 8,
      capability: "QUESTION",
      origin: "web",
      flow: "question_answer",
    });

    expect(allowance.correlation).toMatchObject({
      beneficiaryUserId: 8,
      payerUserId: 8,
      subscriptionId: individualSubscription.id,
      productCode: individualSubscription.productCode,
      versionCode: individualSubscription.versionCode,
    });
  });
});
