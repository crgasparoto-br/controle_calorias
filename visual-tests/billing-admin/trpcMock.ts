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

function mutation() {
  return {
    mutate: () => undefined,
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
  plans: [
    {
      planId: "professional-monthly",
      planName: "Profissional",
      versionCode: "professional-v1",
      billingCycle: "monthly",
      currency: "BRL",
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
  items: [],
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
};

function branch(path: string[]): any {
  return new Proxy(() => undefined, {
    get(_target, property) {
      const key = String(property);
      if (key === "useQuery") return () => query(dataByPath[path.join(".")]);
      if (key === "useMutation") return () => mutation();
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
