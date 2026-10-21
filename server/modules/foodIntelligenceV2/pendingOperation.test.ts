import { describe, expect, it } from "vitest";
import {
  applyPendingOperationEffect,
  classifyPendingOperationOwner,
  createInMemoryPendingOperationStore,
  createPendingOperationV2,
  resumePendingOperation,
  type PendingOperation,
  type PendingOperationEffect,
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

function applyEffect(
  store: ReturnType<typeof createInMemoryPendingOperationStore>,
  effect: Partial<PendingOperationEffect> = {},
  request: Partial<PendingOperationRequest> = {}
) {
  return applyPendingOperationEffect(store, {
    request: buildRequest(request),
    effect: {
      effectId: "eff-1",
      appliedAt: "2026-10-05T12:06:00.000Z",
      mealItemId: "item-1",
      ...effect,
    },
  });
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

  it("A-1298-005: rejeita perguntas malformadas sem exceção ou mutação", () => {
    const validQuestion = {
      code: "quantity_conversion_unproven",
      ref: "clarify-1",
    } as const;
    const variants: Array<[unknown, string]> = [
      [undefined, "invalid-pending-operation"],
      [false, "invalid-pending-operation"],
      [[], "invalid-pending-operation"],
      [{}, "invalid-reason-code"],
      [{ ref: "clarify-1" }, "invalid-reason-code"],
      [{ code: validQuestion.code }, "invalid-pending-operation"],
      [{ ...validQuestion, ref: "" }, "invalid-pending-operation"],
      [{ ...validQuestion, ref: " " }, "invalid-pending-operation"],
      [{ ...validQuestion, ref: " clarify-1 " }, "invalid-pending-operation"],
      [{ ...validQuestion, ref: "x".repeat(201) }, "invalid-pending-operation"],
      [{ ...validQuestion, additional: true }, "invalid-pending-operation"],
    ];
    for (const [question, expectedReason] of variants) {
      const input = {
        operationKey: "op-1",
        ownerUserId: 7,
        createdAt: "2026-10-05T12:00:00.000Z",
        expiresAt: "2026-10-05T12:30:00.000Z",
        observationIds: ["obs-1"],
        target: { mealLabel: "almoço", date: "2026-10-05" },
        question: question as never,
        versionTag: VERSIONS,
      };
      const snapshot = structuredClone(input);
      const result = createPendingOperationV2(input);
      expect(result.ok, JSON.stringify(question)).toBe(false);
      if (!result.ok) expect(result.reason).toBe(expectedReason);
      expect(input).toStrictEqual(snapshot);
    }

    const accepted = createPendingOperationV2({
      operationKey: "op-1",
      ownerUserId: 7,
      createdAt: "2026-10-05T12:00:00.000Z",
      expiresAt: "2026-10-05T12:30:00.000Z",
      observationIds: ["obs-1"],
      target: { mealLabel: "almoço", date: "2026-10-05" },
      question: validQuestion,
      versionTag: VERSIONS,
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.pending.question).toStrictEqual(validQuestion);
  });

  it("R-1298-001: rejeita IDs/revisoes com whitespace externo sem mutacao", () => {
    const base = {
      operationKey: "op-1",
      ownerUserId: 7,
      createdAt: "2026-10-05T12:00:00.000Z",
      expiresAt: "2026-10-05T12:30:00.000Z",
      observationIds: ["obs-1"],
      target: { mealLabel: "almoço", date: "2026-10-05" },
      question: null,
      versionTag: VERSIONS,
    };
    const cases = [
      { operationKey: " op-1 " },
      { observationIds: [" obs-1"] },
      { observationIds: ["obs-1 "] },
      { versionTag: { ...VERSIONS, resolverVersion: " resolver-v2.0.0" } },
      { versionTag: { ...VERSIONS, policyVersion: "pol-2026-10-05 " } },
      { versionTag: { ...VERSIONS, lexiconRevision: " lex-2026-10-05" } },
      { versionTag: { ...VERSIONS, knowledgeRevision: "kn-2026-10-05 " } },
    ];
    for (const patch of cases) {
      const input = { ...base, ...patch };
      const untouched = structuredClone(input);
      const result = createPendingOperationV2(input);
      expect(result.ok).toBe(false);
      expect(input).toStrictEqual(untouched);
    }

    const persisted = buildOperation({ observationIds: [" obs-1"] });
    const resumed = resumePendingOperation(persisted, buildRequest());
    expect(resumed.resumed).toBe(false);
    if (!resumed.resumed) expect(resumed.reason).toBe("invalid-pending-operation");
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

    const future = buildOperation({
      versionTag: { ...VERSIONS, contractVersion: 3 },
    });
    expect(classifyPendingOperationOwner(future)).toBe("unknown-version");

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
      [{ now: "invalid" }, "invalid-request-time"],
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

  it("rejeita versão persistida desconhecida sem despachar para V1", () => {
    const result = resumePendingOperation(
      buildOperation({
        versionTag: { ...VERSIONS, contractVersion: 3 },
      }),
      buildRequest()
    );

    expect(result.resumed).toBe(false);
    if (result.resumed) throw new Error("esperado falha");
    expect(result.reason).toBe("unsupported-schema-version");
    expect(result.detail).toContain("nunca é tratada como V1");
  });

  it("rejeita datas e instantes inválidos persistidos antes de comparar expiração", () => {
    const cases: Array<[Partial<PendingOperation>, string]> = [
      [{ expiresAt: "not-an-instant" }, "invalid-pending-time"],
      [{ expiresAt: "2026-02-31T12:30:00.000Z" }, "invalid-pending-time"],
      [{ expiresAt: "2026-10-05T12:30:00" }, "invalid-pending-time"],
      [{ expiresAt: "2026-10-05T12:30:00+14:01" }, "invalid-pending-time"],
      [{ expiresAt: "2026-10-05T12:30:00-23:59" }, "invalid-pending-time"],
      [{ createdAt: "not-an-instant" }, "invalid-pending-time"],
      [
        {
          createdAt: "2026-10-05T12:40:00.000Z",
          expiresAt: "2026-10-05T12:20:00.000Z",
        },
        "invalid-pending-time",
      ],
      [{ target: { mealLabel: "almoço", date: "2026-02-31" } }, "invalid-pending-time"],
    ];

    for (const [overrides, expected] of cases) {
      const result = resumePendingOperation(
        buildOperation(overrides),
        buildRequest()
      );

      expect(result.resumed, `esperado falha ${expected}`).toBe(false);
      if (result.resumed) throw new Error("esperado falha");
      expect(result.reason).toBe(expected);
    }
  });
});

describe("efeito idempotente e sobrevivência a restart", () => {
  it("não aplica efeito sem retomada V2 válida", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation({ versionTag: null }));

    const result = applyEffect(store);

    expect(result).toMatchObject({
      applied: false,
      duplicate: false,
      reason: "legacy-handler-required",
    });
    expect(store.get("op-1")?.effect).toBeNull();
  });

  it("R-1298-001: bloqueia IDs de efeito com whitespace em novo efeito e retry", () => {
    for (const changes of [
      { effectId: " eff-1" },
      { effectId: "eff-1 " },
      { mealItemId: " item-1" },
      { mealItemId: "item-1 " },
    ]) {
      const store = createInMemoryPendingOperationStore();
      store.save(buildOperation());
      const result = applyEffect(store, changes);
      expect(result).toMatchObject({
        applied: false,
        duplicate: false,
        reason: "invalid-pending-time",
      });
      expect(store.get("op-1")?.effect).toBeNull();

      const stale = createInMemoryPendingOperationStore();
      expect(() => stale.save(buildOperation({
        effect: {
          effectId: "eff-1",
          appliedAt: "2026-10-05T12:06:00.000Z",
          mealItemId: "item-1",
          ...changes,
        },
      }))).toThrow("Pendência V2 persistida inválida");
      expect(stale.exportState().operations).toHaveLength(0);
    }
  });

  it("não aceita pendência com calendário impossível", () => {
    const result = createPendingOperationV2({
      operationKey: "op-invalid-date",
      ownerUserId: 7,
      createdAt: "2026-10-05T12:00:00.000Z",
      expiresAt: "2026-10-05T12:30:00.000Z",
      observationIds: ["obs-1"],
      target: { mealLabel: "almoço", date: "2026-02-31" },
      question: null,
      versionTag: VERSIONS,
    });

    expect(result.ok).toBe(false);
  });

  it("não aplica efeito quando a pendência persistida tem tempo inválido", () => {
    const store = createInMemoryPendingOperationStore();
    const invalid = buildOperation({ expiresAt: "2026-02-31T12:30:00.000Z" });
    expect(() => store.save(invalid)).toThrow("Pendência V2 persistida inválida");
    expect(resumePendingOperation(invalid, buildRequest())).toMatchObject({
      resumed: false,
      reason: "invalid-pending-time",
    });
    expect(store.get("op-1")?.effect).toBeNull();
  });

  it("não aplica efeito quando expiresAt persistido não sucede createdAt", () => {
    const store = createInMemoryPendingOperationStore();
    const invalid = buildOperation({
      createdAt: "2026-10-05T12:40:00.000Z",
      expiresAt: "2026-10-05T12:20:00.000Z",
    });
    expect(() => store.save(invalid)).toThrow("Pendência V2 persistida inválida");
    expect(resumePendingOperation(invalid, buildRequest())).toMatchObject({
      resumed: false,
      reason: "invalid-pending-time",
    });
    expect(store.get("op-1")?.effect).toBeNull();
  });

  it("não persiste efeito com appliedAt inválido", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());

    const result = applyEffect(store, {
      appliedAt: "2026-02-31T12:06:00.000Z",
    });

    expect(result).toMatchObject({
      applied: false,
      duplicate: false,
      reason: "invalid-pending-time",
    });
    expect(store.get("op-1")?.effect).toBeNull();
  });

  it("valida pendência e efeito persistidos antes de retornar duplicate", () => {
    const store = createInMemoryPendingOperationStore();
    const invalid = buildOperation({
      effect: {
        effectId: "eff-1",
        appliedAt: "2026-02-31T12:06:00.000Z",
        mealItemId: "item-1",
      },
    });
    expect(() => store.save(invalid)).toThrow("Pendência V2 persistida inválida");
    expect(resumePendingOperation(invalid, buildRequest())).toMatchObject({
      resumed: false,
      reason: "invalid-pending-operation",
    });
    expect(store.get("op-1")).toBeNull();
  });

  it("não retorna duplicate quando a pendência persistida tem tempo inválido", () => {
    const store = createInMemoryPendingOperationStore();
    const invalid = buildOperation({
      expiresAt: "2026-02-31T12:30:00.000Z",
      effect: {
        effectId: "eff-1",
        appliedAt: "2026-10-05T12:06:00.000Z",
        mealItemId: "item-1",
      },
    });
    expect(() => store.save(invalid)).toThrow("Pendência V2 persistida inválida");
    expect(resumePendingOperation(invalid, buildRequest())).toMatchObject({
      resumed: false,
      reason: "invalid-pending-time",
    });
  });

  it("A-1298-003: recusa retomada anterior à criação da pendência", () => {
    const result = resumePendingOperation(
      buildOperation(),
      buildRequest({ now: "2026-10-05T11:59:59.999Z" })
    );
    expect(result).toMatchObject({
      resumed: false,
      reason: "invalid-request-time",
    });
  });

  it("A-1298-003: recusa efeitos fora da janela de execução sem salvar estado", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());

    for (const appliedAt of [
      "2026-10-05T11:59:59.999Z",
      "2026-10-05T12:04:59.999Z",
      "2026-10-05T12:30:00.000Z",
      "2026-10-05T12:40:00.000Z",
    ]) {
      const result = applyEffect(store, { appliedAt });
      expect(result, appliedAt).toMatchObject({
        applied: false,
        duplicate: false,
        reason: "invalid-pending-time",
      });
      expect(store.get("op-1")?.effect).toBeNull();
    }
    expect(
      applyEffect(store, { appliedAt: "2026-10-05T12:29:59.999Z" })
    ).toMatchObject({ applied: true, duplicate: false });
  });

  it("A-1298-003: não reconhece como duplicata efeito persistido fora da janela", () => {
    for (const appliedAt of [
      "2026-10-05T11:59:59.999Z",
      "2026-10-05T12:30:00.000Z",
      "2026-10-05T12:40:00.000Z",
    ]) {
      const invalid = buildOperation({
        effect: { effectId: "eff-1", appliedAt, mealItemId: "item-1" },
      });
      const store = createInMemoryPendingOperationStore();
      expect(() => store.save(invalid)).toThrow("Pendência V2 persistida inválida");
      const state = { schemaVersion: 1 as const, operations: [invalid] };
      // A restauração agora rejeita o estado inválido antes de qualquer retry.
      expect(() => createInMemoryPendingOperationStore(state)).toThrow(
        "Pendência V2 persistida inválida; restauração recusada."
      );
      expect(state.operations[0].effect?.appliedAt).toBe(appliedAt);
    }
  });

  it("A-1298-010: impede estado obsoleto de apagar um efeito inclusive após restart", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());
    const stale = store.get("op-1");
    expect(stale).not.toBeNull();
    if (!stale) throw new Error("pendência não encontrada");

    const first = applyEffect(store);
    expect(first).toMatchObject({ applied: true, duplicate: false });
    const committed = store.exportState();

    expect(() => store.save(stale)).toThrow("Efeito já aplicado é imutável");
    expect(store.exportState()).toStrictEqual(committed);

    const replaced = structuredClone(committed.operations[0]);
    if (!replaced.effect) throw new Error("efeito ausente");
    replaced.effect.mealItemId = "item-conflitante";
    expect(() => store.save(replaced)).toThrow("Efeito já aplicado é imutável");
    expect(store.exportState()).toStrictEqual(committed);

    const restarted = createInMemoryPendingOperationStore(store.exportState());
    expect(() => restarted.save(stale)).toThrow("Efeito já aplicado é imutável");
    const retry = applyEffect(restarted);
    expect(retry).toMatchObject({ applied: false, duplicate: true });
    if (first.applied && retry.duplicate) {
      expect(retry.effect).toStrictEqual(first.effect);
    }
    expect(restarted.exportState()).toStrictEqual(committed);
  });

  it("A-1298-010: rejeita troca de versão, proprietário ou alvo ao regravar a mesma chave", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());
    const original = store.exportState();
    const base = original.operations[0];

    for (const mutated of [
      { ...base, versionTag: { ...VERSIONS, resolverVersion: "resolver-v3" } },
      { ...base, ownerUserId: 8 },
      { ...base, observationIds: ["obs-2"] },
      { ...base, target: { ...base.target, mealLabel: "jantar" } },
      { ...base, question: null },
    ]) {
      expect(() => store.save(mutated)).toThrow("Pendência existente não permite");
      expect(store.exportState()).toStrictEqual(original);
    }

    store.save(structuredClone(base)); // regravação idêntica é permitida
    expect(store.exportState()).toStrictEqual(original);
  });

  it("aplica uma única vez e devolve o mesmo efeito em retry", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());

    const first = applyEffect(store);
    const second = applyEffect(store, {
      appliedAt: "2026-10-05T12:07:00.000Z",
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
    applyEffect(store);

    // Reinício do processo: estado serializado, nova instância do store.
    const restarted = createInMemoryPendingOperationStore(store.exportState());
    const pending = restarted.get("op-1");

    expect(pending).not.toBeNull();
    if (!pending) throw new Error("esperado pendência persistida");
    expect(classifyPendingOperationOwner(pending)).toBe("v2");
    const resume = resumePendingOperation(pending, buildRequest());
    expect(resume.resumed).toBe(true);

    const replayed = applyEffect(restarted, {
      appliedAt: "2026-10-05T12:40:00.000Z",
    });
    expect(replayed).toMatchObject({ applied: false, duplicate: true });
  });

  it("trata operações distintas como efeitos distintos", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());
    store.save(buildOperation({ operationKey: "op-2" }));

    const first = applyEffect(store);
    const other = applyEffect(
      store,
      { effectId: "eff-2", mealItemId: "item-2" },
      { operationKey: "op-2" }
    );

    expect(first).toMatchObject({ applied: true, duplicate: false });
    expect(other).toMatchObject({ applied: true, duplicate: false });
  });

  it("A-1298-011: save recusa dados inválidos antes de alterar o store", () => {
    const store = createInMemoryPendingOperationStore();
    const pristine = store.exportState();
    for (const invalid of [
      buildOperation({ ownerUserId: 0 }),
      buildOperation({ observationIds: ["obs-1", "obs-1"] }),
      buildOperation({ target: { mealLabel: "", date: "2026-10-05" } }),
      buildOperation({ versionTag: undefined as never }),
    ]) {
      expect(() => store.save(invalid)).toThrow();
      expect(store.exportState()).toStrictEqual(pristine);
    }
    const existing = buildOperation();
    store.save(existing);
    const before = store.exportState();
    expect(() => store.save({ ...existing, ownerUserId: 0 })).toThrow();
    expect(store.exportState()).toStrictEqual(before);
  });

  it("A-1298-011: save não fabrica efeito confirmado nem duplicata", () => {
    const store = createInMemoryPendingOperationStore();
    const pending = buildOperation();
    const effect = {
      effectId: "forged-effect",
      appliedAt: "2026-10-05T12:06:00.000Z",
      mealItemId: "forged-item",
    };
    expect(() => store.save({ ...pending, effect })).toThrow(
      "Nova pendência não pode declarar efeito"
    );
    expect(store.exportState().operations).toHaveLength(0);
    store.save(pending);
    const initial = store.exportState();
    expect(() => store.save({ ...pending, effect })).toThrow(
      "Efeito só pode ser confirmado"
    );
    expect(store.exportState()).toStrictEqual(initial);
    const first = applyEffect(store);
    expect(first).toMatchObject({ applied: true, duplicate: false });
    const committed = store.exportState();
    store.save(structuredClone(committed.operations[0]));
    expect(store.exportState()).toStrictEqual(committed);
    expect(applyEffect(createInMemoryPendingOperationStore(committed))).toMatchObject({
      applied: false,
      duplicate: true,
    });
  });

  it("A-1298-012: retomar pendência malformada nunca lança exceção nem gera efeito", () => {
    const base = buildOperation();
    for (const [invalid, reason] of [
      [{ ...base, versionTag: undefined }, "pending-version-missing"],
      [{ ...base, versionTag: false }, "invalid-pending-operation"],
      [{ ...base, versionTag: {} }, "invalid-pending-operation"],
      [{ ...base, effect: {
        effectId: "eff-1", appliedAt: "not-a-date", mealItemId: "item-1",
      } }, "invalid-pending-operation"],
      [{ ...base, effect: {
        effectId: "eff-1", appliedAt: "2026-10-05T12:40:00.000Z", mealItemId: "item-1",
      } }, "invalid-pending-operation"],
    ] as const) {
      const original = structuredClone(invalid);
      const result = resumePendingOperation(invalid as unknown as PendingOperation, buildRequest());
      expect(result.resumed, reason).toBe(false);
      if (!result.resumed) expect(result.reason).toBe(reason);
      expect(invalid).toStrictEqual(original);
    }
    expect(resumePendingOperation(null as never, buildRequest())).toMatchObject({
      resumed: false,
      reason: "invalid-pending-operation",
    });
  });

  it("exporta estado sem expor a coleção interna", () => {
    const store = createInMemoryPendingOperationStore();
    store.save(buildOperation());

    const state = store.exportState();
    state.operations[0].target.mealLabel = "alterado fora do store";

    expect(store.get("op-1")?.target.mealLabel).toBe("café da manhã");
  });
});
