import { describe, expect, it } from "vitest";
import { buildFoodResolutionDecisionFixture } from "./fixtures";
import { parseFoodResolutionDecision } from "./schemas";
import {
  createInMemoryPendingOperationStore,
  createPendingOperationV2,
  resumePendingOperation,
  type PendingOperation,
  type PendingOperationRequest,
} from "./pendingOperation";

const versions = {
  contractVersion: 2,
  resolverVersion: "resolver-v2",
  policyVersion: "policy-v1",
  lexiconRevision: "lex-1",
  knowledgeRevision: "knowledge-1",
};

function pendingFixture(): PendingOperation {
  const created = createPendingOperationV2({
    operationKey: "op-1298",
    ownerUserId: 7,
    createdAt: "2026-10-05T12:00:00.000Z",
    expiresAt: "2026-10-05T12:30:00.000Z",
    observationIds: ["obs-1"],
    target: { mealLabel: "almoço", date: "2026-10-05" },
    question: null,
    versionTag: versions,
  });
  if (!created.ok) throw new Error(created.detail);
  return created.pending;
}

const request: PendingOperationRequest = {
  operationKey: "op-1298",
  ownerUserId: 7,
  ...versions,
  authorization: "active",
  now: "2026-10-05T12:05:00.000Z",
};

describe("A-1298-007: evidência nutricional deve sustentar o número declarado", () => {
  it("rejeita valor divergente sem alterar a decisão original", () => {
    const decision = buildFoodResolutionDecisionFixture();
    const before = structuredClone(decision);
    decision.evidence[2].value = 9999;
    expect(parseFoodResolutionDecision(decision).ok).toBe(false);
    expect(before.evidence[2].value).toBe(270);
    expect(decision.evidence[2].value).toBe(9999);
  });

  it("aceita o valor de fonte da base ou do consumo", () => {
    const baseDecision = buildFoodResolutionDecisionFixture();
    expect(parseFoodResolutionDecision(baseDecision).ok).toBe(true);
    const consumedDecision = structuredClone(baseDecision);
    consumedDecision.evidence[2].value = 81;
    expect(parseFoodResolutionDecision(consumedDecision).ok).toBe(true);
  });

  it("rejeita unidade incorreta e segunda fonte conflitante", () => {
    const unit = buildFoodResolutionDecisionFixture();
    unit.evidence[2].unit = "g";
    expect(parseFoodResolutionDecision(unit).ok).toBe(false);

    const conflict = buildFoodResolutionDecisionFixture();
    conflict.evidence.push({
      ...conflict.evidence[2],
      evidenceId: "ev-extra",
      field: "nutrition.protein",
      value: 999,
      unit: "g",
    });
    conflict.nutrition.evidenceIds.push("ev-extra");
    expect(parseFoodResolutionDecision(conflict).ok).toBe(false);
  });

  it("não inventa nutriente presente no consumo quando a base é desconhecida", () => {
    const decision = buildFoodResolutionDecisionFixture();
    if (!decision.nutrition.consumed) throw new Error("fixture sem consumo");
    decision.nutrition.consumed.fiber = 2;
    expect(parseFoodResolutionDecision(decision).ok).toBe(false);
  });
});

describe("A-1298-008: pendência desserializada não contorna o contrato V2", () => {
  it("bloqueia retomada e efeito para IDs repetidos, alvo e pergunta inválidos", () => {
    const cases: PendingOperation[] = [
      { ...pendingFixture(), observationIds: ["obs-1", "obs-1"] },
      { ...pendingFixture(), target: { mealLabel: "", date: "2026-10-05" } },
      { ...pendingFixture(), question: { code: "quantity_missing", ref: " " } },
      { ...pendingFixture(), ownerUserId: 0 },
    ];
    for (const candidate of cases) {
      const store = createInMemoryPendingOperationStore();
      const input = { ...request, ownerUserId: candidate.ownerUserId };
      const original = structuredClone(store.exportState());
      const resumed = resumePendingOperation(candidate, input);
      expect(resumed.resumed).toBe(false);
      if (resumed.resumed) throw new Error("retomada inválida");
      expect(resumed.reason).toBe("invalid-pending-operation");
      expect(() => store.save(candidate)).toThrow("Pendência V2 persistida inválida");
      expect(store.exportState()).toStrictEqual(original);
    }
  });

  it("recusa envelope desconhecido, chave duplicada e dados corrompidos no restart", () => {
    const valid = pendingFixture();
    expect(() => createInMemoryPendingOperationStore({
      schemaVersion: 2 as 1,
      operations: [valid],
    })).toThrow();
    expect(() => createInMemoryPendingOperationStore({
      schemaVersion: 1,
      operations: [valid, structuredClone(valid)],
    })).toThrow();
    expect(() => createInMemoryPendingOperationStore({
      schemaVersion: 1,
      operations: [{ ...valid, observationIds: ["obs-1", "obs-1"] }],
    })).toThrow();
    expect(() => createInMemoryPendingOperationStore({
      schemaVersion: 1,
      operations: [{ ...valid, target: { ...valid.target, mealLabel: "" } }],
    })).toThrow();
    const restored = createInMemoryPendingOperationStore({
      schemaVersion: 1,
      operations: [valid],
    });
    expect(restored.get(valid.operationKey)?.versionTag).toStrictEqual(versions);
  });
});
