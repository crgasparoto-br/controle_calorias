import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (text, part, index) => text + part + (index < values.length ? String(values[index] ?? "") : ""), "",
  ),
}));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    execute: mocks.execute,
    transaction: mocks.transaction,
  })),
}));
vi.mock("./billingRepositorySupport", () => ({ resultRows: (value: unknown) => value }));

const { listEconomicFactsPage, recordEconomicFact, recordUsageEvent } = await import("./usageGovernanceRepository");

const base = {
  id: "fact-effective",
  idempotencyKey: "effective-revenue-1",
  supersedesIdempotencyKey: "estimated-revenue-1",
  payloadFingerprint: "fingerprint-effective",
  subscriptionId: "sub-1",
  payerUserId: 7,
  productCode: "professional",
  versionCode: "v1",
  billingCycle: "monthly",
  factType: "contract_revenue",
  amountMinor: 9000,
  currency: "BRL",
  valueKind: "effective" as const,
  competenceStart: new Date("2026-08-01T00:00:00.000Z"),
  competenceEnd: new Date("2026-09-01T00:00:00.000Z"),
  effectiveAt: new Date("2026-08-31T12:00:00.000Z"),
  ruleVersion: "test",
  reason: "provider reconciliation",
  actorUserId: 1,
  correlationId: "corr-1",
};

describe("economic fact estimate/effective reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async callback => callback({ execute: mocks.execute }));
  });

  it("rejects conflicting reuse of an idempotency key but accepts an equivalent retry", async () => {
    mocks.execute.mockResolvedValueOnce([{ id: "existing", payloadFingerprint: "other" }]);
    await expect(recordEconomicFact(base)).rejects.toThrow("economic_fact_idempotency_conflict");

    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([{ id: "existing", payloadFingerprint: base.payloadFingerprint }]);
    await expect(recordEconomicFact(base)).resolves.toEqual({ created: false, id: "existing", superseded: false });
  });

  it.each(["contract_revenue", "discount", "coupon", "credit", "refund", "chargeback", "revenue_tax", "receipt_fee", "financial_cost"])(
    "atomically supersedes an estimate with one effective %s fact",
    async factType => {
      mocks.execute
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          id: `estimate-${factType}`, payerUserId: 7, subscriptionId: "sub-1", productCode: "professional",
          versionCode: "v1", billingCycle: "monthly", factType, currency: "BRL", valueKind: "estimated",
          competenceStart: "2026-08-01", competenceEnd: "2026-09-01", supersededAt: null,
        }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await expect(recordEconomicFact({ ...base, factType, id: `effective-${factType}` }))
        .resolves.toMatchObject({ created: true, superseded: true });
      expect(String(mocks.execute.mock.calls[2][0])).toContain("INSERT IGNORE INTO billingEconomicFacts");
      expect(String(mocks.execute.mock.calls[3][0])).toContain("supersededByFactId");
    },
  );

  it("excludes superseded estimates from aggregate reads without deleting their audit rows", async () => {
    mocks.execute.mockResolvedValueOnce([]);
    await listEconomicFactsPage({ from: base.competenceStart, to: base.competenceEnd });
    const query = String(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("supersededAt IS NULL");
    expect(query).not.toContain("DELETE");
  });

  it("rejects a conflicting retry against the detailed usage ledger idempotency key", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ payloadFingerprint: "different" }]);
    await expect(recordUsageEvent({
      id:"usage-1",idempotencyKey:"usage-key",beneficiaryUserId:7,payerUserId:7,
      accessSource:"active_subscription",operation:"meal_text",channel:"web",provider:"openai",model:"m",
      unitType:"tokens",unitCount:3,estimatedCostMicros:1,currency:"USD",eventState:"success",attemptRole:"primary",
      correlationId:"corr",environment:"test",ruleVersion:"test",occurredAt:new Date("2026-08-01"),
    })).rejects.toThrow("usage_event_idempotency_conflict");
  });
});
