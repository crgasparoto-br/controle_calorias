import { describe, expect, it, vi } from "vitest";
import { readThroughGovernedKnowledge } from "./knowledgeRead";
import { createFoodV2KnowledgeRepository } from "./repository";

vi.mock("../../db", () => ({ getDb: vi.fn(async () => null) }));

describe("B2 actual database adapter fail-closed", () => {
  const request = { normalizedName: "pao", userId: 41,
    resolverVersion: "v2", policyVersion: "p1" };
  it("does not treat missing local database as a food miss or consult the network", async () => {
    const external = vi.fn(async () => null);
    expect(await readThroughGovernedKnowledge(
      request, createFoodV2KnowledgeRepository(), external,
    )).toEqual({ kind: "unavailable", reason: "governed_store_unavailable" });
    expect(external).not.toHaveBeenCalled();
  });
  it("throws on unavailable pending-evidence storage rather than masquerading as a cache miss", async () => {
    await expect(createFoodV2KnowledgeRepository().readPendingEvidence(request))
      .rejects.toThrow(/unavailable/i);
  });
});
