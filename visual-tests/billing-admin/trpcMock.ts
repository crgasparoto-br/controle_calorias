const resolved = async () => undefined;

function query(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: resolved,
  };
}

function mutation(path: string, options?: { onSuccess?: (data: any, variables: any) => void; onError?: (error: Error, variables: any) => void }) {
  return {
    mutate: (variables: any) => {
      if (path === "billing.adminRetryNotification") {
        const g = globalThis as any;
        g.__billingRetryAttempts = g.__billingRetryAttempts ?? [];
        g.__billingRetryAttempts.push(variables);
        if (g.__billingRetryAttempts.length === 1) options?.onError?.(new Error("synthetic lost response"), variables);
        else options?.onSuccess?.({ status: "delivered", idempotent: true }, variables);
        return;
      }
      options?.onSuccess?.({}, variables);
    },
    mutateAsync: async () => undefined,
    reset: () => undefined,
    isPending: false,
    isError: false,
    error: null,
  };
}

const analytics = {
  activeOverrides: 2,
  usersWithoutCommercialAccess: 5,
  subscriptionStatusTotals: { pending: 2, active: 18, past_due: 1, canceled: 3, expired: 1 },
  estimatedMonthlyRecurringRevenue: [
    { currency: "BRL", amountMinor: 449100, estimated: true },
  ],
  generatedAt: new Date("2026-08-27T12:00:00.000Z"),
  plans: [
    {
      planId: "professional-monthly",
      planCode: "professional",
      planName: "Profissional",
      versionCode: "professional-v1",
      audience: "professional",
      billingCycle: "monthly",
      currency: "BRL",
      unitAmount: 49900,
      active: true,
      subscriptionsByStatus: { pending: 1, active: 9, past_due: 1, canceled: 1, expired: 0 },
      coveredBeneficiaries: 146,
      capacityUsed: 146,
    },
  ],
};

const usageAnalytics = {
  policy: {
    fairUse: { alertThresholdPercentages: [70, 85, 100] },
    retention: { detailedUsageMonths: 13, dailyAggregateMonths: 24, monthlyEconomicYears: 5 },
  },
  coverage: { usage: { state: "complete", retentionMonths: 24 } },
  byDimensions: [
    {
      beneficiaryUserId: 22,
      sponsorUserId: 1,
      payerUserId: 1,
      productCode: "professional",
      versionCode: "professional-v1",
      billingCycle: "monthly",
    },
  ],
};

const economicRows = {
  month: "2026-08",
  rows: [
    {
      competenceMonth: "2026-08-01T00:00:00.000Z",
      payerUserId: 1,
      subscriptionId: "sub-visual-1",
      productCode: "professional",
      versionCode: "professional-v1",
      billingCycle: "monthly",
      currency: "BRL",
      recognizedContractRevenueMinor: 49900,
      discountMinor: 0,
      couponMinor: 4990,
      creditMinor: 0,
      refundMinor: 0,
      chargebackMinor: 0,
      taxMinor: 3500,
      receiptFeeMinor: 1200,
      financialCostMinor: 800,
      netEconomicRevenueMinor: 40210,
      variableCostMicros: 3800000,
      variableCostRatioBps: 945,
      rolling3MonthVariableCostRatioBps: 912,
      measurementCoverageBps: 10000,
    },
  ],
};

const adminOverview = {
  abuseCases: [],
  limitations: [],
  appeals: [],
  legalHolds: [],
  retentionAudits: [],
  retentionReprocesses: [],
  economicRows: economicRows.rows,
};

const rolloutOverview = {
  runtimeAccessMode: "open_access",
  currentApprovedPhase: "pilot_a",
  latestGate: null,
  snapshots: [],
  openIncidents: [],
  recentControls: [],
  guarantees: {
    noAutomaticProgression: true,
    controlPlaneDoesNotCreateCharges: true,
    rollbackPreservesFinancialFacts: true,
    openAccessSafeDefault: true,
  },
};

const notifications = {
  items: [{
    notificationId: "fact-visual-1", campaign: "Cobrança", campaignVersion: "v3", title: "Pagamento pendente", whatOccurred: "Pagamento não confirmado", effectiveAt: new Date("2026-08-27T10:00:00Z"), expectedAction: "regularizar", consequence: "acompanhar", support: "suporte", actionHref: "/billing",
    payerUserId: 44, factType: "past_due_reminder", category: "financial", audience: "individual", trigger: "past_due_reminder", milestone: null, correlationId: "corr-visual-456", idempotencyKey: "idem-visual-123", obsolete: false, paused: false, pauseReason: null, optOutApplicable: false, legalBasisClassification: "operacional", completionState: "open", readState: "unread", readAt: null, deliveryState: "failed", deliveryChannel: "whatsapp", deliveryUpdatedAt: new Date("2026-08-27T10:05:00Z"), situation: "Ação pendente",
    senders: { internal: { configured: true, label: "Central interna" }, email: { configured: false, label: "E-mail" }, whatsapp: { configured: true, label: "WhatsApp oficial" } },
    channels: [{ channel: "internal", state: "available", attempts: 1, definitiveFailure: false, acknowledged: true, responsibleUserId: null, nextAttemptAt: null, updatedAt: new Date("2026-08-27T10:00:00Z") }, { channel: "email", state: "not_attempted", attempts: 0, definitiveFailure: false, acknowledged: false, responsibleUserId: null, nextAttemptAt: null, updatedAt: null }, { channel: "whatsapp", state: "failed", attempts: 1, definitiveFailure: true, acknowledged: false, responsibleUserId: 9, nextAttemptAt: null, updatedAt: new Date("2026-08-27T10:05:00Z") }],
    audit: { sourceFactVersion: 3, sourceEffectiveAt: new Date("2026-08-27T10:00:00Z"), latestCampaignControlAt: null, latestCampaignControlActorUserId: null },
  }],
  analytics: [
    {
      campaign: "Renovação",
      campaignVersion: "v1",
      channel: "internal",
      created: 12,
      sent: 12,
      delivered: 12,
      failed: 0,
      retries: 0,
      deduplications: 0,
      opened: 9,
      actionCompleted: 8,
      optOut: null,
      tickets: null,
      averageResolutionMinutes: null,
    },
  ],
  matchedTotal: 12,
};

const dataByPath: Record<string, unknown> = {
  "billing.adminAnalytics": analytics,
  "billing.adminSearchUsers": [],
  "billing.adminListOverrides": [],
  "billing.adminCatalogVersions": [],
  "billing.adminCoupons": [],
  "billing.adminNotifications": notifications,
  "billing.adminRolloutOverview": rolloutOverview,
  "usageGovernance.analytics": usageAnalytics,
  "usageGovernance.adminOverview": adminOverview,
  "usageGovernance.adminEconomicRows": economicRows,
  "usageGovernance.consumptionChargingAuthorizations": [],
};

function branch(path: string[]): any {
  return new Proxy(() => undefined, {
    get(_target, property) {
      const key = String(property);
      if (key === "useQuery") return () => query(dataByPath[path.join(".")]);
      if (key === "useMutation") return (options: any) => mutation(path.join("."), options);
      return branch([...path, key]);
    },
  });
}

function utilsBranch(): any {
  return new Proxy(() => undefined, {
    get() {
      return utilsBranch();
    },
    apply() {
      return resolved();
    },
  });
}

export const trpc: any = new Proxy({}, {
  get(_target, property) {
    const key = String(property);
    if (key === "useUtils") return () => utilsBranch();
    return branch([key]);
  },
});
