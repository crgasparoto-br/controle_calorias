import { describe, expect, it } from "vitest";
import {
  applyPendingOperationEffect,
  classifyPendingOperationOwner,
  createInMemoryPendingOperationStore,
  createPendingOperationV2,
  resumePendingOperation,
  type PendingOperation,
  type PendingOperationRequest,
  type PendingOperationVersionTag,
} from "./pendingOperation";

const VERSIONS: PendingOperationVersionTag = {
  contractVersion: 2,
  resolverVersion: "resolver-v2.0.0",
  policyVersion: "pol-2026-10-05",
  lexiconRevision: "lex-2026-10-05",
  knowledgeRevision: "kn-2026-10-05",
};

function buildOperation(
  overrides: Partial<PendingOperation> = {}
): PendingOperation {
  const result = createPendingOperationV2({
    operationKey: "op-1",
    ownerUserId: 7,
    createdAt: "2026-10-05T12:00:00.000Z",
    expiresAt: "2026-10-05T12:30:00.000Z",
    observationIds: ["obs-1"],
    target: { mealLabel: "café da manhã", date: "2026-10-05" },
    question: { code: "quantity_conversion_unproven", ref: "clarify-1" },
    versionTag: VERSIONS,
  });
  if (!result.ok) throw new Error(result.detail);
  return { ...result.pending, ...overrides };
}

function buildRequest(
  overrides: Partial<PendingOperationRequest> = {}
): PendingOperationRequest {
  return {
    operationKey: "op-1",
    ownerUserId: 7,
    contractVersion: VERSIONS.contractVersion,
    resolverVersion: VERSIONS.resolverVersion,
    policyVersion: VERSIONS.policyVersion,
    lexiconRevision: VERSIONS.lexiconRevision,
    knowledgeRevision: VERSIONS.knowledgeRevision,
    authorization: "active",
    now: "2026-10-05T12:05:00.000Z",
    ...overrides,
  };
}

describe("criação da pendência versionada", () => {
  it("fixa contrato, resolvedor, política, léxico e conhecimento", () => {
    const result = createPendingOperationV2({
      operationKey: "op-1",
      ownerUserId: 7,
      createdAt: "2026-10-05T12:00:00.000Z",
      expiresAt: "2026-10-05T12:30:00.000Z",
      observationIds: ["obs-1", "obs-2"],
      target: { mealLabel: "almoço", date: "2026-10-05" },
      question: null,
      versionTag: VERSIONS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.owner).toBe("v2");
    expect(result.pending.versionTag).toStrictEqual(VERSIONS);
    expect(result.pending.effect).toBeNull();
    expect(result.pending.question).toBeNull();
  });

  it("recusa versão de contrato incompatível sem assumir a versão corrente", () => {
    const result = createPendingOperationV2({
      operationKey: "op-1",
      ownerUserId: 7,
      createdAt: "2026-10-05T12:00:00.000Z",
      expiresAt: "2026-10-05T12:30:00.000Z",
      observationIds: ["obs-1"],
      target: { mealLabel: "almoço", date: "2026-10-05" },
      question: null,
      versionTag: { ...VERSIONS, contractVersion: 1 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperado recusa");
    expect(result.reason).toBe("unsupported-schema-version");
  });

  it("recusa motivo fora do registro tipado e alvo sem data explícita", () => {
    const reason = createPendingOperationV2({
      operationKey: "op-1",
      ownerUserId: 7,
      createdAt: "2026-10-05T12:00:00.000Z",
      expiresAt: "2026-10-05T12:30:00.000Z",
      observationIds: ["obs-1"],
      target: { mealLabel: "almoço", date: "2026-10-05" },
      question: { code: "texto_livre_qualquer" as never, ref: "x" },
      versionTag: VERSIONS,
    });
    expect(reason.ok).toBe(false);
    if (reason.ok) throw new Error("esperado recusa");
    expect(reason.reason).toBe("invalid-reason-code");

    const target = createPendingOperationV2({
      operationKey: "op-1",
      ownerUserId: 7,
      createdAt: "2026-10-05T12:00:00.000Z",
      expiresAt: "2026-10-05T12:30:00.000Z",
      observationIds: ["obs-1"],
      target: { mealLabel: "almoço", date: "amanhã" },
      question: null,
      versionTag: VERSIONS,
    });
    expect(target.ok).toBe(false);
    if (target.ok) throw new Error("esperado recusa");
    expect(target.reason).toBe("invalid-pending-operation");
  });
});

describe("classificação de proprietário", () => {
  it("usa o contrato persistido e nunca infere por data ou texto", () => {
    const v2 = buildOperation();
    expect(classifyPendingOperationOwner(v2)).toBe("v2");

    const legacySemTag = buildOperation({ versionTag: null });
    expect(classifyPendingOperationOwner(legacySemTag)).toBe("legacy-v1");

    const legacyV1 = buildOperation({
      versionTag: { ...VERSIONS, contractVersion: 1 },
    });
    expect(classifyPendingOperationOwner(legacyV1)).toBe("legacy-v1");

    // Pendência antiga criada "agora" continua legada: data não é critério.
    const legadaRecente = buildOperation({
      versionTag: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(classifyPendingOperationOwner(legadaRecente)).toBe("legacy-v1");
  });
});

describe("retomada da pendência", () => {
  it("retoma quando versões fixadas e autorização permanecem válidas", () => {
    const pending = buildOperation();

    const result = resumePendingOperation(pending, buildRequest());

    expect(result.resumed).toBe(true);
    if (!result.resumed) throw new Error(result.detail);
    expect(result.versions).toStrictEqual(VERSIONS);
    expect(result.pending).toBe(pending);
  });

  it("falha explicitamente em cada incompatibilidade", () => {
    const pending = buildOperation();

    const cases: Array<[Partial<PendingOperationRequest>, string]> = [
      [{ operationKey: "op-2" }, "operation-key-mismatch"],
      [{ ownerUserId: 8 }, "owner-mismatch"],
      [{ now: "2026-10-05T12:30:00.000Z" }, "expired"],
      [{ authorization: "revoked" }, "authorization-invalid"],
      [{ authorization: "restricted" }, "authorization-invalid"],
      [{ authorization: "expired" }, "authorization-invalid"],
      [{ resolverVersion: "resolver-v2.1.0" }, "resolver-version-changed"],
      [{ policyVersion: "pol-2026-11-01" }, "resolver-version-changed"],
      [{ lexiconRevision: "lex-2026-11-01" }, "resolver-version-changed"],
      [{ knowledgeRevision: "kn-2026-11-01" }, "resolver-version-changed"],
      [{ contractVersion: 3 }, "resolver-version-changed"],
    ];

    for (const [overrides, expected] of cases) {
      const result = resumePendingOperation(pending, buildRequest(overrides));
      expect(result.resumed, `esperado falha ${expected}`).toBe(false);
      if (result.resumed) throw new Error("esperado falha");
      expect(result.reason).toBe(expected);
    }
  });

  it("mantém pendência legada no handler compatível", () => {
    const result = resumePendingOperation(
      buildOperation({ versionTag: null }),
      buildRequest()
    );

    expect(result.resumed).toBe(false);
    if (result.resumed) throw new Error("esperado falha");
    expect(result.reason).toBe("legacy-handler-required");
  });
});

describe("efeito idempotente e sobrevivência a restart", () => {
  it("aplica uma única vez e devolve o mesmo efeito em retry", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());

    const first = applyPendingOperationEffect(store, {
      operationKey: "op-1",
      ownerUserId: 7,
      effect: {
        effectId: "eff-1",
        appliedAt: "2026-10-05T12:06:00.000Z",
        mealItemId: "item-1",
      },
    });
    const second = applyPendingOperationEffect(store, {
      operationKey: "op-1",
      ownerUserId: 7,
      effect: {
        effectId: "eff-1",
        appliedAt: "2026-10-05T12:07:00.000Z",
        mealItemId: "item-1",
      },
    });

    expect(first).toMatchObject({ applied: true, duplicate: false });
    expect(second).toMatchObject({ applied: false, duplicate: true });
    if (!first.applied || !second.duplicate)
      throw new Error("esperado efeito único");
    expect(second.effect).toStrictEqual(first.effect);
    expect(store.get("op-1")?.effect?.appliedAt).toBe(
      "2026-10-05T12:06:00.000Z"
    );
  });

  it("sobrevive a restart com versão fixada e sem efeito duplicado", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());
    applyPendingOperationEffect(store, {
      operationKey: "op-1",
      ownerUserId: 7,
      effect: {
        effectId: "eff-1",
        appliedAt: "2026-10-05T12:06:00.000Z",
        mealItemId: "item-1",
      },
    });

    // Reinício do processo: estado serializado, nova instância do store.
    const restarted = createInMemoryPendingOperationStore(store.exportState());
    const pending = restarted.get("op-1");

    expect(pending).not.toBeNull();
    if (!pending) throw new Error("esperado pendência persistida");
    expect(classifyPendingOperationOwner(pending)).toBe("v2");
    const resume = resumePendingOperation(pending, buildRequest());
    expect(resume.resumed).toBe(true);

    const replayed = applyPendingOperationEffect(restarted, {
      operationKey: "op-1",
      ownerUserId: 7,
      effect: {
        effectId: "eff-1",
        appliedAt: "2026-10-05T12:40:00.000Z",
        mealItemId: "item-1",
      },
    });
    expect(replayed).toMatchObject({ applied: false, duplicate: true });
  });

  it("trata operações distintas como efeitos distintos", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());
    store.save(buildOperation({ operationKey: "op-2" }));

    const first = applyPendingOperationEffect(store, {
      operationKey: "op-1",
      ownerUserId: 7,
      effect: {
        effectId: "eff-1",
        appliedAt: "2026-10-05T12:06:00.000Z",
        mealItemId: "item-1",
      },
    });
    const other = applyPendingOperationEffect(store, {
      operationKey: "op-2",
      ownerUserId: 7,
      effect: {
        effectId: "eff-2",
        appliedAt: "2026-10-05T12:06:00.000Z",
        mealItemId: "item-2",
      },
    });

    expect(first).toMatchObject({ applied: true, duplicate: false });
    expect(other).toMatchObject({ applied: true, duplicate: false });
  });

  it("exporta estado sem expor a coleção interna", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());

    const state = store.exportState();
    state.operations[0].target.mealLabel = "alterado fora do store";

    expect(store.get("op-1")?.target.mealLabel).toBe("café da manhã");
  });
});
