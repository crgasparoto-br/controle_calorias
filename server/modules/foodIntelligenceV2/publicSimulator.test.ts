import { afterEach, describe, expect, it, vi } from "vitest";
import { createFoodD1PublicSimulator, type AuthorizedD1SimulationContext } from "./publicSimulator";

const originalFlag = process.env.FOOD_V2_D1_ENABLED;
const originalScope = process.env.FOOD_V2_D1_ENTRYPOINTS;
const materialSha = "a".repeat(40);
const allowed: AuthorizedD1SimulationContext = {
  approval: {
    status: "approved", gateAReference: "synthetic:independent-gate-a",
    rolloutReference: "synthetic:approved-rollout", auditedBaseSha: materialSha,
  },
  expectedAuditedBaseSha: materialSha,
  revisions: { code: materialSha, lexicon: "lex-test-1",
    knowledge: "kn-test-1", policy: "policy-test-1", resolver: "resolver-test-1" },
};
const testInput = { text: "1,5 fatias de mortadela", messageId: "synthetic-message-1",
  receivedAt: new Date("2026-11-01T12:00:00Z"), userTimezone: "America/Sao_Paulo" };
function setup(authorized: AuthorizedD1SimulationContext | null = allowed) {
  const readAuthorizedContext = vi.fn(async () => authorized);
  const knowledge = {
    readLocal: vi.fn(async () => ({ kind: "miss" as const, reason: "not_found" as const })),
    readPendingEvidence: vi.fn(async () => null),
    stagePendingEvidence: vi.fn(async () => { throw new Error("simulator must not stage"); }),
  };
  const lexicon = { load: vi.fn(async () => []) };
  return { simulator: createFoodD1PublicSimulator({ readAuthorizedContext, knowledge, lexicon }),
    readAuthorizedContext, knowledge, lexicon };
}
afterEach(() => {
  if (originalFlag === undefined) delete process.env.FOOD_V2_D1_ENABLED;
  else process.env.FOOD_V2_D1_ENABLED = originalFlag;
  if (originalScope === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
  else process.env.FOOD_V2_D1_ENTRYPOINTS = originalScope;
});

describe("#1308 public simulator D1 boundary (authenticated tRPC producer)", () => {
  it("does not inspect or contact V2 when the flag is OFF or another entrypoint is selected", async () => {
    delete process.env.FOOD_V2_D1_ENABLED;
    const backend = setup();
    expect(await backend.simulator(7, testInput)).toBeNull();
    expect(await backend.simulator(7, { ...testInput, pendingContextKind: "quantity" })).toBeNull();
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    expect(await backend.simulator(7, testInput)).toBeNull();
    expect(backend.readAuthorizedContext).not.toHaveBeenCalled();
    expect(backend.lexicon.load).not.toHaveBeenCalled();
  });

  it("rejects every pending interaction before consulting Gate A, the lexicon or nutrition", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "simulator";
    const backend = setup();
    for (const pendingContextKind of ["selection", "quantity", "confirmation", "professional_decision"] as const) {
      await expect(backend.simulator(7, {
        ...testInput, text: "50 g", pendingContextKind,
      })).rejects.toThrow("food-d1-public-simulator-pending-context-unsupported");
    }
    expect(backend.readAuthorizedContext).not.toHaveBeenCalled();
    expect(backend.lexicon.load).not.toHaveBeenCalled();
    expect(backend.knowledge.readLocal).not.toHaveBeenCalled();
  });

  it("fails closed before nutrition or a legacy meal effect without independent approval", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "simulator";
    const backend = setup(null);
    await expect(backend.simulator(7, testInput))
      .rejects.toThrow("public-simulator-gate-unavailable");
    expect(backend.knowledge.readLocal).not.toHaveBeenCalled();
    expect(backend.lexicon.load).not.toHaveBeenCalled();
  });

  it("requires an exact running SHA matching both Gate A and the revision contract", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "simulator";
    for (const rejected of [
      { ...allowed, approval: { ...allowed.approval, auditedBaseSha: "b".repeat(40) } },
      { ...allowed, revisions: { ...allowed.revisions, code: "b".repeat(40) } },
      { ...allowed, approval: { ...allowed.approval, gateAReference: "" } },
    ]) {
      const backend = setup(rejected);
      await expect(backend.simulator(7, testInput))
        .rejects.toThrow("public-simulator-gate-unavailable");
      expect(backend.knowledge.readLocal).not.toHaveBeenCalled();
    }
  });

  it("uses the real D1 LCL + resolver on approved evidence, read-only and without V1 projection", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "simulator";
    const backend = setup();
    const first = await backend.simulator(7, testInput);
    const second = await backend.simulator(7, testInput);
    expect(first).toMatchObject({ schemaVersion: 2, entrypoint: "simulator",
      committed: false, registeredCount: 0,
      operationKey: expect.any(String), items: expect.any(Array) });
    expect(first?.operationKey).toBe(second?.operationKey);
    expect(first?.items.length).toBeGreaterThan(0);
    expect(backend.knowledge.readLocal).toHaveBeenCalled();
    expect(backend.knowledge.stagePendingEvidence).not.toHaveBeenCalled();
    expect(backend.readAuthorizedContext).toHaveBeenCalledTimes(4);
  });

  it("does not continue if Gate A is revoked between preflight and execution", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "simulator";
    const backend = setup();
    backend.readAuthorizedContext.mockResolvedValueOnce(allowed).mockResolvedValueOnce(null);
    await expect(backend.simulator(7, testInput))
      .rejects.toThrow("independent-gates-not-approved");
    expect(backend.knowledge.readLocal).not.toHaveBeenCalled();
  });

  it("rejects anonymous users and empty text instead of borrowing a different identity", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "simulator";
    const backend = setup();
    await expect(backend.simulator(0, testInput))
      .rejects.toThrow("public-simulator-invalid-input");
    await expect(backend.simulator(7, { ...testInput, text: "  " }))
      .rejects.toThrow("public-simulator-invalid-input");
    expect(backend.knowledge.readLocal).not.toHaveBeenCalled();
  });
});
