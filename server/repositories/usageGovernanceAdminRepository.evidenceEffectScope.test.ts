import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  abuseCase: {} as Record<string, unknown>,
  insertCount: 0,
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (text, part, index) => text + part + (index < values.length ? String(values[index] ?? "") : ""),
    "",
  ),
}));
vi.mock("./billingRepositorySupport", () => ({ resultRows: (value: unknown) => value }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    transaction: async <T>(callback: (tx: { execute: (query: string) => Promise<unknown> }) => Promise<T>) => callback({
      execute: async query => {
        if (query.includes("SELECT * FROM billingUsageAbuseCases")) return [state.abuseCase];
        if (query.includes("SELECT * FROM billingUsageLimitations WHERE abuseCaseId")) return [];
        if (query.includes("INSERT INTO billingUsageLimitations")) {
          state.insertCount += 1;
          return [{ affectedRows: 1 }];
        }
        return [];
      },
    }),
  })),
}));

const { createLimitation } = await import("./usageGovernanceAdminRepository");

function emergencyInput(operations: string[]) {
  return {
    id: "emergency-1",
    abuseCaseId: "case-1",
    subjectUserId: 99,
    operations,
    reason: "bounded emergency protection",
    startsAt: new Date("2026-08-18T12:00:00.000Z"),
    endsAt: new Date("2026-08-19T12:00:00.000Z"),
    emergencySecurity: true,
    approvedByUserId: 11,
    communicatedAt: null,
    appealOfferedAt: null,
  };
}

describe("usage limitation transactional evidence-effect scope", () => {
  beforeEach(() => {
    state.insertCount = 0;
    state.abuseCase = {
      id: "case-1",
      subjectUserId: 99,
      sanitizedEvidenceJson: JSON.stringify({
        securityRiskConfirmed: true,
        affectedOperations: ["image_processing"],
      }),
    };
  });

  it("revalidates the evidence scope under the case lock before insert", async () => {
    await expect(createLimitation(emergencyInput(["audio_processing"])))
      .rejects.toThrow("usage_emergency_security_operation_not_evidenced");
    expect(state.insertCount).toBe(0);
  });

  it("rejects a mixed request atomically under the lock", async () => {
    await expect(createLimitation(emergencyInput(["image_processing", "audio_processing"])))
      .rejects.toThrow("usage_emergency_security_operation_not_evidenced");
    expect(state.insertCount).toBe(0);
  });

  it("admits a matching emergency operation after locked revalidation", async () => {
    await expect(createLimitation(emergencyInput(["image_processing"])))
      .resolves.toMatchObject({ lifecycleKind: "emergency" });
    expect(state.insertCount).toBe(1);
  });
});
