import { describe, expect, it, vi } from "vitest";
import { buildFoodObservationFixture } from "./fixtures";
import {
  parseFoodResolutionDecision, type FoodObservation,
} from "./schemas";
import {
  resolveFoodObservation, resolveFoodObservations, type FoodResolverContext,
} from "./resolver";
import type {
  FoodKnowledgeStore, GovernedFoodMatch, FoodKnowledgeLocalResult,
} from "./knowledgeRead";

const context: FoodResolverContext = {
  traceId: "trace-1305", userId: 7,
  knowledgeRevision: "food-knowledge-v2", policyVersion: "policy-v2",
  resolverVersion: "resolver-c2",
};
const match: GovernedFoodMatch = {
  kind: "match", matchingEvidence: "exact_variant",
  foodId: 101, variantId: 102, profileId: 103,
  variantName: "Mortadela", sourceId: 104,
  sourceVersion: "source-1",
  sourceReference: "https://example.org/mortadela",
  nutrition: {
    caloriesKcal: 270, proteinG: 12, carbG: 3, fatG: 23,
    basisQuantity: 100, basisUnit: "g",
  },
  governanceStatus: "verified",
  knowledgeValidity: { checkedAt: "2026-01-01T00:00:00Z", validUntil: null,
    userId: context.userId, resolverVersion: context.resolverVersion },
  portions: [{ portionId: 105, foodEntityId: 101, variantId: 102,
    label: "fatia", unit: "fatia", quantity: 1, grams: 20, status: "verified",
    measureKind: "exact", confidence: null, sourceId: 106, sourceVersion: "portion-v1",
    sourceReference: "https://example.org/portions/105", sourcePortionCode: "slice-105",
    evidenceId: 107, validFrom: null, validTo: null, updatedAt: "2026-10-20T00:00:00Z" }],
};

function fakeStore(local: FoodKnowledgeLocalResult): FoodKnowledgeStore {
  return {
    readLocal: vi.fn().mockResolvedValue(local),
    readPendingEvidence: vi.fn().mockResolvedValue(null),
    stagePendingEvidence: vi.fn().mockResolvedValue(false),
  };
}

function alternativeFor(hypothesisId: string, foodName: string | null): FoodObservation["alternatives"][number] {
  return {
    hypothesisId,
    identityHints: { foodName, brand: null, variant: null, preparation: [], qualifiers: [], barcode: null },
    quantityHints: {
      value: null, unit: null, servingText: null,
      visiblePackageQuantity: null, visiblePackageUnit: null,
    },
    evidenceIds: ["ev-ident"], confidence: null,
  };
}

describe("#1305 Food Intelligence V2 — núcleo", () => {
  it("resolve com perfil local verificado, conversão comprovada e proveniência", async () => {
    const store = fakeStore(match);
    const decision = await resolveFoodObservation(buildFoodObservationFixture(), context, store);
    expect(decision.status).toBe("resolved");
    expect(decision.nextAction).toBe("propose");
    expect(decision.unresolvedFields).toEqual([]);
    expect(decision.identity.variantId).toBe(102);
    expect(decision.quantity.grams).toBe(30);
    expect(decision.nutrition.consumed?.calories).toBe(81);
    expect(decision.nutrition.consumed?.protein).toBeCloseTo(3.6);
    expect(decision.nutrition.profileId).toBe(103);
    expect(decision.nutrition.sourceId).toBe(104);
    expect(decision.nutrition.verified).toBe(true);
    expect(decision.nutrition.snapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
    expect(store.readPendingEvidence).not.toHaveBeenCalled();
  });

  it("F-1305-003: ancora cada macronutriente no perfil governado, não no texto", async () => {
    const observation = buildFoodObservationFixture({
      surfaceSpan: { sourceRef: "user:7:surface-only", span: { start: 0, end: 22 }, region: null },
    });
    const decision = await resolveFoodObservation(observation, context, fakeStore(match));
    expect(decision.status).toBe("resolved");
    const nutrientEvidence = decision.evidence.filter(item => decision.nutrition.evidenceIds.includes(item.evidenceId));
    expect(nutrientEvidence).toHaveLength(4);
    for (const item of nutrientEvidence) {
      expect(item.sourceId).toBe(match.sourceId);
      expect(item.origin).toBe("catalog");
      expect(item.anchor).toStrictEqual({
        sourceRef: "food-nutrition-profile:" + match.profileId + ":" + decision.nutrition.snapshotHash,
        span: null, region: null,
      });
      expect(item.anchor.sourceRef).not.toBe(observation.surfaceSpan.sourceRef);
    }
    const otherSource = await resolveFoodObservation(observation, context, fakeStore({
      ...match, sourceVersion: "source-2", sourceReference: "https://example.org/other-profile",
    }));
    expect(otherSource.nutrition.snapshotHash).not.toBe(decision.nutrition.snapshotHash);
    expect(otherSource.evidence.filter(item => otherSource.nutrition.evidenceIds.includes(item.evidenceId))
      .every(item => item.anchor.sourceRef !== nutrientEvidence[0].anchor.sourceRef)).toBe(true);
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
  });

  it("F-1305-004: classificação alimentar positiva e negativa verificadas não podem rejeitar", async () => {
    const observation = buildFoodObservationFixture();
    const claim = (id: string, value: boolean, verified = true): FoodObservation["evidence"][number] => ({
      ...observation.evidence[0], evidenceId: id, field: "classification.isFood", origin: "catalog",
      value, unit: null, verified, sourceId: value ? 901 : 902,
      anchor: { sourceRef: "catalog:" + id, span: null, region: null },
    });
    const positive = claim("food-true", true);
    const negative = claim("food-false", false);
    const conflicting = { ...observation, evidence: [...observation.evidence, positive, negative] };
    const result = await resolveFoodObservation(conflicting, context, fakeStore(match));
    expect(result.status).toBe("unknown");
    expect(result.nextAction).toBe("clarify");
    expect(result.reasonCodes).toContain("source_conflict");
    expect(result.reasonCodes).not.toContain("non_food");
    expect(result.nutrition.consumed).toBeNull();
    expect(result.evidence).toEqual(expect.arrayContaining([positive, negative]));
    expect(parseFoodResolutionDecision(result).ok).toBe(true);

    const onlyNegative = await resolveFoodObservation({ ...observation,
      evidence: [...observation.evidence, negative] }, context, fakeStore(match));
    expect(onlyNegative.reasonCodes).toContain("non_food");
    expect(onlyNegative.nextAction).toBe("reject");
    const onlyPositive = await resolveFoodObservation({ ...observation,
      evidence: [...observation.evidence, positive] }, context, fakeStore(match));
    expect(onlyPositive.status).toBe("resolved");
    const unverifiedNegative = await resolveFoodObservation({ ...observation,
      evidence: [...observation.evidence, positive, claim("food-uncertain", false, false)] }, context, fakeStore(match));
    expect(unverifiedNegative.status).toBe("resolved");
  });

  it("F-1305-005: não herda nenhuma evidência entre usuários, mesmo com trace e observação iguais", async () => {
    const privateObservation = buildFoodObservationFixture({
      surfaceSpan: { sourceRef: "user:7:private", span: { start: 0, end: 22 }, region: null },
    });
    privateObservation.evidence[0].anchor = privateObservation.surfaceSpan;
    const previous = await resolveFoodObservation(privateObservation, context, fakeStore(match));
    expect(previous.status).toBe("resolved");
    expect(previous.ownerUserId).toBe(7);
    const noClaims = buildFoodObservationFixture({
      identityHints: { foodName: null }, evidence: [],
      quantityHints: { value: null, unit: null, servingText: null },
    });
    const differentUser = await resolveFoodObservation(noClaims, {
      ...context, userId: 8, previousDecision: previous,
    }, fakeStore({ kind: "miss", reason: "not_found" }));
    expect(differentUser.ownerUserId).toBe(8);
    expect(differentUser.revision).toBe(1);
    expect(differentUser.decisionId).not.toBe(previous.decisionId);
    expect(differentUser.identity.foodEntityId).toBeNull();
    expect(differentUser.quantity.value).toBeNull();
    expect(differentUser.nutrition.consumed).toBeNull();
    expect(differentUser.evidence).toStrictEqual([]);
    expect(parseFoodResolutionDecision(differentUser).ok).toBe(true);

    // Missing nutrition validity does not remove the new explicit owner binding.
    const unresolved = await resolveFoodObservation(privateObservation, context,
      fakeStore({ kind: "miss", reason: "not_found" }));
    expect(unresolved.knowledgeValidity).toBeUndefined();
    expect(unresolved.ownerUserId).toBe(7);
    const otherUnresolved = await resolveFoodObservation(noClaims,
      { ...context, userId: 8, previousDecision: unresolved },
      fakeStore({ kind: "miss", reason: "not_found" }));
    expect(otherUnresolved.evidence).toStrictEqual([]);
    expect(otherUnresolved.revision).toBe(1);
  });

  it("F-1305-005: snapshot V2 legado só continua com proprietário autenticado comprovado", async () => {
    const observation = buildFoodObservationFixture();
    const previous = await resolveFoodObservation(observation, context, fakeStore(match));
    const noClaims = buildFoodObservationFixture({
      identityHints: { foodName: null }, evidence: [],
      quantityHints: { value: null, unit: null, servingText: null },
    });
    const legacyWithProof = structuredClone(previous);
    delete legacyWithProof.ownerUserId;
    const allowed = await resolveFoodObservation(noClaims, { ...context,
      previousDecision: legacyWithProof }, fakeStore({ kind: "miss", reason: "not_found" }));
    expect(allowed.ownerUserId).toBe(7);
    expect(allowed.revision).toBe(previous.revision + 1);
    expect(allowed.nutrition).toEqual(previous.nutrition);
    const unbound = structuredClone(legacyWithProof);
    delete unbound.knowledgeValidity;
    const denied = await resolveFoodObservation(noClaims, { ...context,
      previousDecision: unbound }, fakeStore({ kind: "miss", reason: "not_found" }));
    expect(denied.ownerUserId).toBe(7);
    expect(denied.revision).toBe(1);
    expect(denied.evidence).toStrictEqual([]);
    const tampered = structuredClone(previous);
    if (!tampered.knowledgeValidity) throw new Error("fixture sem validade");
    tampered.knowledgeValidity.userId = 8;
    const deniedTampered = await resolveFoodObservation(noClaims, { ...context,
      previousDecision: tampered }, fakeStore({ kind: "miss", reason: "not_found" }));
    expect(deniedTampered.evidence).toStrictEqual([]);
    const anonymous = await resolveFoodObservation(noClaims, { ...context, userId: null,
      previousDecision: previous }, fakeStore({ kind: "miss", reason: "not_found" }));
    expect(anonymous.evidence).toStrictEqual([]);
    expect(anonymous.ownerUserId).toBeNull();
  });

  it("não inventa conversão de fatia nem calorias sem porção governada", async () => {
    const decision = await resolveFoodObservation(
      buildFoodObservationFixture(), context,
      fakeStore({ ...match, portions: [] }),
    );
    expect(decision.status).toBe("partially_resolved");
    expect(decision.nextAction).toBe("clarify");
    expect(decision.quantity.value).toBe(1.5);
    expect(decision.quantity.unit).toBe("fatia");
    expect(decision.quantity.grams).toBeNull();
    expect(decision.nutrition.consumed).toBeNull();
    expect(decision.nutrition.verified).toBe(false);
    expect(decision.unresolvedFields).toContain("nutrition");
    expect(decision.reasonCodes).toContain("quantity_conversion_unproven");
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
  });

  it("não ignora qualificador explícito para reutilizar a composição genérica", async () => {
    const observation = buildFoodObservationFixture({
      identityHints: {
        foodName: "mortadela",
        qualifiers: [{ value: "sem açúcar", attributeCode: null, role: "sweetening", confidence: null }],
      },
    });
    const decision = await resolveFoodObservation(observation, context, fakeStore(match));
    expect(decision.status).toBe("unknown");
    expect(decision.reasonCodes).toContain("brand_variant_unresolved");
    expect(decision.nutrition.consumed).toBeNull();
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
  });

  it("perfil governado provisório não é usado sem política calibrada #1306", async () => {
    const decision = await resolveFoodObservation(
      buildFoodObservationFixture(), context,
      fakeStore({ ...match, governanceStatus: "provisional" }),
    );
    expect(decision.status).toBe("partially_resolved");
    expect(decision.nextAction).toBe("clarify");
    expect(decision.reasonCodes).toContain("policy_not_calibrated");
    expect(decision.nutrition.basis).toBeNull();
    expect(decision.nutrition.consumed).toBeNull();
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
  });

  it("não transforma uma fonte desconhecida em zeros ou alimento registrado", async () => {
    const store = fakeStore({ kind: "miss", reason: "not_found" });
    const decision = await resolveFoodObservation(buildFoodObservationFixture(), context, store);
    expect(decision.status).toBe("unknown");
    expect(decision.nextAction).not.toBe("propose");
    expect(decision.nutrition.basis).toBeNull();
    expect(decision.nutrition.consumed).toBeNull();
    expect(decision.unresolvedFields).toContain("nutrition");
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
  });

  it("não aceita perfil genérico para marca ou barcode incompatíveis", async () => {
    const observation = buildFoodObservationFixture({
      identityHints: { brand: "Marca A", barcode: null },
    });
    const store = fakeStore({ kind: "miss", reason: "incompatible_evidence" });
    const decision = await resolveFoodObservation(observation, context, store);
    expect(decision.status).toBe("unknown");
    expect(decision.reasonCodes).toContain("brand_variant_unresolved");
    expect(decision.nutrition.consumed).toBeNull();
    expect(store.readLocal).toHaveBeenCalledWith(expect.objectContaining({ brand: "Marca A" }));
  });

  it("conflito de fontes não escolhe o último perfil", async () => {
    const decision = await resolveFoodObservation(
      buildFoodObservationFixture(), context,
      fakeStore({ kind: "conflict", reason: "material_nutrition_conflict" }),
    );
    expect(decision.reasonCodes).toContain("source_conflict");
    expect(decision.nextAction).toBe("clarify");
    expect(decision.nutrition.consumed).toBeNull();
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
  });

  it("indisponibilidade do repositório gera retry, sem apelar a IA para decidir", async () => {
    const store = fakeStore({ kind: "miss", reason: "not_found" });
    vi.mocked(store.readLocal).mockRejectedValueOnce(new Error("database down"));
    const external = vi.fn();
    const decision = await resolveFoodObservation(buildFoodObservationFixture(), context, store, external);
    expect(decision.status).toBe("unknown");
    expect(decision.nextAction).toBe("retry");
    expect(decision.reasonCodes).toContain("context_unavailable");
    expect(decision.nutrition.consumed).toBeNull();
    expect(external).not.toHaveBeenCalled();
  });

  it("nunca apresenta nutrição externa provisória como verificada sem identidade governada", async () => {
    const store = fakeStore({ kind: "miss", reason: "not_found" });
    const external = vi.fn().mockResolvedValue({
      sourceId: 1, sourceReference: "https://example.org/food",
      identity: { name: "mortadela" },
      nutrition: { caloriesKcal: 270, proteinG: 12, carbG: 3, fatG: 23, basisQuantity: 100, basisUnit: "g" },
    });
    const decision = await resolveFoodObservation(buildFoodObservationFixture(), context, store, external);
    expect(external).toHaveBeenCalledTimes(1);
    expect(decision.status).toBe("unknown");
    expect(decision.nextAction).not.toBe("propose");
    expect(decision.nutrition.verified).toBe(false);
    expect(decision.nutrition.consumed).toBeNull();
  });

  it("mantém quantidade aceita após nova observação sem quantidade", async () => {
    const store = fakeStore(match);
    const original = await resolveFoodObservation(buildFoodObservationFixture(), context, store);
    const updatedObservation = buildFoodObservationFixture({
      quantityHints: { value: null, unit: null, servingText: null },
    });
    const updated = await resolveFoodObservation(
      updatedObservation, { ...context, previousDecision: original }, store,
    );
    expect(updated.revision).toBe(2);
    expect(updated.decisionId).toBe(original.decisionId);
    expect(updated.quantity).toEqual(original.quantity);
    expect(updated.nutrition.consumed).toEqual(original.nutrition.consumed);
    expect(parseFoodResolutionDecision(updated).ok).toBe(true);
  });

  it("nova quantidade conflitante não sobrescreve silenciosamente a aceita", async () => {
    const store = fakeStore(match);
    const previous = await resolveFoodObservation(buildFoodObservationFixture(), context, store);
    const changed = buildFoodObservationFixture({
      quantityHints: { value: 2, unit: "fatia", servingText: "2 fatias" },
    });
    const result = await resolveFoodObservation(
      changed, { ...context, previousDecision: previous }, store,
    );
    expect(result.status).not.toBe("resolved");
    expect(result.quantity.value).toBe(1.5);
    expect(result.reasonCodes).toContain("source_conflict");
  });

  it("resolve itens individualmente, sem apagar decisão válida quando outro falha", async () => {
    const good = buildFoodObservationFixture();
    const bad: FoodObservation = buildFoodObservationFixture({
      observationId: "obs-2",
      identityHints: { foodName: "alimento desconhecido" },
    });
    const store = fakeStore(match);
    vi.mocked(store.readLocal).mockImplementation(async request =>
      request.normalizedName === "mortadela" ? match : { kind: "miss", reason: "not_found" });
    const decisions = await resolveFoodObservations([good, bad], context, store);
    expect(decisions).toHaveLength(2);
    expect(decisions[0].status).toBe("resolved");
    expect(decisions[1].status).toBe("unknown");
  });

  it("não decide por score quando a observação conserva duas hipóteses concorrentes", async () => {
    const observation = buildFoodObservationFixture({
      alternatives: [
        {
          hypothesisId: "candidate-a",
          identityHints: { foodName: "Alimento A", brand: null, variant: null, preparation: [], qualifiers: [], barcode: null },
          quantityHints: { value: null, unit: null, servingText: null, visiblePackageQuantity: null, visiblePackageUnit: null },
          evidenceIds: ["ev-ident"], confidence: 0.9,
        },
        {
          hypothesisId: "candidate-b",
          identityHints: { foodName: "Alimento B", brand: null, variant: null, preparation: [], qualifiers: [], barcode: null },
          quantityHints: { value: null, unit: null, servingText: null, visiblePackageQuantity: null, visiblePackageUnit: null },
          evidenceIds: ["ev-ident"], confidence: 0.4,
        },
      ],
    });
    const decision = await resolveFoodObservation(observation, context, fakeStore(match));
    expect(decision.status).toBe("ambiguous");
    expect(decision.nextAction).toBe("clarify");
    expect(decision.alternatives.map(a => a.name)).toEqual(["Alimento A", "Alimento B"]);
    expect(decision.nutrition.consumed).toBeNull();
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
  });

  it("impede perfil genérico ou variante sem prova da marca explícita", async () => {
    const observation = buildFoodObservationFixture({
      identityHints: { brand: "Marca A" },
    });
    for (const local of [
      { ...match, matchingEvidence: "generic_family" as const },
      { ...match, matchingEvidence: "exact_variant" as const },
      { ...match, matchingEvidence: "exact_variant" as const, matchedBrand: "Marca B" },
    ]) {
      const decision = await resolveFoodObservation(observation, context, fakeStore(local));
      expect(decision.status).toBe("unknown");
      expect(decision.nutrition.consumed).toBeNull();
      expect(decision.reasonCodes).toContain("brand_variant_unresolved");
    }
    const granted = await resolveFoodObservation(observation, context, fakeStore({
      ...match, matchingEvidence: "exact_variant", matchedBrand: "Marca A",
    }));
    expect(granted.status).toBe("resolved");
    expect(granted.identity.brand).toBe("Marca A");
  });

  it("A-007: preserva marca governada sem alegação e revalida sua prova após mudar o produto", async () => {
    const measured = (brand: string | null) => {
      const input = buildFoodObservationFixture({
        identityHints: { brand }, quantityHints: { value: 30, unit: "g", servingText: "30 g" },
      });
      input.evidence[1] = { ...input.evidence[1], value: 30, unit: "g" };
      return input;
    };
    const original = await resolveFoodObservation(measured(null), context, fakeStore({
      ...match, matchedBrand: "Marca A",
    }));
    expect(original.status).toBe("resolved");
    expect(original.identity.brand).toBe("Marca A");
    const originalProof = original.evidence.find(item =>
      original.identity.evidenceIds.includes(item.evidenceId) && item.field === "identity.brand" &&
      item.value === "Marca A" && item.origin === "catalog");
    expect(originalProof).toMatchObject({ verified: true, sourceId: null,
      anchor: { sourceRef: "food-variant:102" } });
    const previous = JSON.parse(JSON.stringify(original)) as typeof original;
    const next = await resolveFoodObservation(measured("Marca B"),
      { ...context, previousDecision: previous }, fakeStore({
        ...match, variantId: 203, matchedBrand: "Marca B",
      }));
    expect(next.status).toBe("resolved");
    expect(next.identity.variantId).toBe(203);
    expect(next.identity.brand).toBe("Marca B");
    expect(next.evidence.some(item => item.evidenceId === originalProof?.evidenceId)).toBe(false);
    expect(next.evidence.some(item => item.field === "identity.brand" && item.value === "Marca B" &&
      item.verified && item.origin === "catalog" && item.anchor.sourceRef === "food-variant:203")).toBe(true);
    expect(original.identity.brand).toBe("Marca A");
    expect(parseFoodResolutionDecision(next).ok).toBe(true);
  });

  it("exige prova governada do mesmo barcode antes de aceitar nutrição comercial", async () => {
    const observation = buildFoodObservationFixture({
      identityHints: { barcode: "7891234567890" },
    });
    const negative = await resolveFoodObservation(observation, context, fakeStore({
      ...match, matchingEvidence: "barcode", matchedBarcode: "7891234567891",
    }));
    expect(negative.status).toBe("unknown");
    expect(negative.nutrition.consumed).toBeNull();
    const positive = await resolveFoodObservation(observation, context, fakeStore({
      ...match, matchingEvidence: "barcode", matchedBarcode: "7891234567890",
    }));
    expect(positive.status).toBe("resolved");
    expect(positive.identity.barcode).toBe("7891234567890");
  });

  it("não degrada identidade e macros quando continuação omite alimento e quantidade", async () => {
    const store = fakeStore(match);
    const original = await resolveFoodObservation(buildFoodObservationFixture(), context, store);
    const continuation = buildFoodObservationFixture({
      identityHints: { foodName: null },
      quantityHints: { value: null, unit: null, servingText: null },
      evidence: [],
    });
    const current = await resolveFoodObservation(
      continuation, { ...context, previousDecision: original }, store,
    );
    expect(current.status).toBe("resolved");
    expect(current.identity).toEqual(original.identity);
    expect(current.quantity).toEqual(original.quantity);
    expect(current.nutrition).toEqual(original.nutrition);
    expect(current.revision).toBe(original.revision + 1);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
    expect(store.readLocal).toHaveBeenCalledTimes(1);
  });

  it("continuação com quantidade divergente conserva fatos e exige clarificação", async () => {
    const store = fakeStore(match);
    const original = await resolveFoodObservation(buildFoodObservationFixture(), context, store);
    const continuation = buildFoodObservationFixture({
      identityHints: { foodName: null },
      quantityHints: { value: 2, unit: "fatia", servingText: "2 fatias" },
      evidence: [],
    });
    const current = await resolveFoodObservation(
      continuation, { ...context, previousDecision: original }, store,
    );
    expect(current.status).toBe("partially_resolved");
    expect(current.nextAction).toBe("clarify");
    expect(current.reasonCodes).toContain("source_conflict");
    expect(current.quantity).toEqual(original.quantity);
    expect(current.nutrition).toEqual(original.nutrition);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });

  it("não retorna decisão inválida quando evidências atingem limite máximo", async () => {
    const seed = buildFoodObservationFixture();
    const observation = buildFoodObservationFixture({
      evidence: Array.from({ length: 200 }, (_, i) => ({
        ...seed.evidence[0],
        evidenceId: "ev-budget-" + i,
      })),
    });
    const current = await resolveFoodObservation(observation, context, fakeStore(match));
    expect(current.status).toBe("unknown");
    expect(current.nextAction).not.toBe("propose");
    expect(current.reasonCodes).toContain("decision_validation_failed");
    expect(current.nutrition.consumed).toBeNull();
    expect(current.evidence).toHaveLength(200);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });

  it("conserva perfil já verificado quando mesma identidade reaparece sem nova prova", async () => {
    const store = fakeStore(match);
    const original = await resolveFoodObservation(buildFoodObservationFixture(), context, store);
    vi.mocked(store.readLocal).mockRejectedValueOnce(new Error("temporarily unavailable"));
    const continuation = buildFoodObservationFixture({
      quantityHints: { value: null, unit: null, servingText: null },
    });
    const current = await resolveFoodObservation(
      continuation, { ...context, previousDecision: original }, store,
    );
    expect(current.status).toBe("resolved");
    expect(current.identity).toEqual(original.identity);
    expect(current.nutrition).toEqual(original.nutrition);
    expect(store.readLocal).toHaveBeenCalledTimes(1);
  });

  it("snapshot vincula a prova comercial, não apenas perfil e fonte", async () => {
    const requestedA = buildFoodObservationFixture({ identityHints: { brand: "Marca A" } });
    const requestedB = buildFoodObservationFixture({ identityHints: { brand: "Marca B" } });
    const first = await resolveFoodObservation(requestedA, context,
      fakeStore({ ...match, matchedBrand: "Marca A" }));
    const second = await resolveFoodObservation(requestedB, context,
      fakeStore({ ...match, matchedBrand: "Marca B" }));
    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
    expect(first.nutrition.snapshotHash).not.toBe(second.nutrition.snapshotHash);
  });

  it("A-001: continuação não propõe identidade quando chegam alternativas concorrentes", async () => {
    const store = fakeStore(match);
    const original = await resolveFoodObservation(buildFoodObservationFixture(), context, store);
    expect(original.status).toBe("resolved");
    const conflicting = buildFoodObservationFixture({
      alternatives: [
        alternativeFor("mortadela", "Mortadela"),
        alternativeFor("presunto", "Presunto"),
      ],
    });
    const current = await resolveFoodObservation(
      conflicting, { ...context, previousDecision: original }, store,
    );
    expect(current.status).toBe("ambiguous");
    expect(current.nextAction).toBe("clarify");
    expect(current.reasonCodes).toContain("source_conflict");
    expect(current.alternatives.map(a => a.name)).toEqual(["Mortadela", "Presunto"]);
    expect(current.nutrition.consumed).toBeNull();
    expect(current.quantity.value).toBe(original.quantity.value);
    expect(current.quantity.unit).toBe(original.quantity.unit);
    expect(current.quantity.grams).toBeNull();
    expect(current.quantity.source).toBe("observation");
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });

  it("A-002: alternativa não materializável preserva quantidade faltante para clarificação", async () => {
    const alternatives = [
      alternativeFor("named", "Mortadela"),
      alternativeFor("unnamed", null),
    ];
    const missing = await resolveFoodObservation(buildFoodObservationFixture({
      quantityHints: { value: null, unit: null, servingText: null }, alternatives,
    }), context, fakeStore(match));
    expect(missing.status).toBe("unknown");
    expect(missing.quantity.value).toBeNull();
    expect(missing.unresolvedFields).toContain("quantity");
    expect(missing.nextAction).toBe("clarify");
    expect(parseFoodResolutionDecision(missing).ok).toBe(true);

    const supplied = await resolveFoodObservation(buildFoodObservationFixture({
      alternatives,
    }), context, fakeStore(match));
    expect(supplied.status).toBe("unknown");
    expect(supplied.quantity.value).toBe(1.5);
    expect(supplied.unresolvedFields).not.toContain("quantity");
    expect(parseFoodResolutionDecision(supplied).ok).toBe(true);
  });

  it("A-003: evidência verificada de quantidade conflitante bloqueia macros e proposta", async () => {
    const seed = buildFoodObservationFixture({
      quantityHints: { value: 100, unit: "g", servingText: "100 g" },
      evidence: [buildFoodObservationFixture().evidence[0], {
        ...buildFoodObservationFixture().evidence[1], value: 100, unit: "g",
      }],
    });
    const conflict = await resolveFoodObservation({
      ...seed,
      evidence: [...seed.evidence, {
        ...seed.evidence[1], evidenceId: "qty-200", field: "quantity.value",
        value: 200, unit: "g", verified: true,
      }],
    }, context, fakeStore(match));
    expect(conflict.status).toBe("partially_resolved");
    expect(conflict.nextAction).toBe("clarify");
    expect(conflict.reasonCodes).toContain("source_conflict");
    expect(conflict.unresolvedFields).toContain("quantity");
    expect(conflict.nutrition.consumed).toBeNull();
    expect(conflict.quantity.evidenceIds).toContain("qty-200");
    expect(parseFoodResolutionDecision(conflict).ok).toBe(true);
  });

  it("A-003: quantidade e evidência verificadas em unidades físicas equivalentes permanecem válidas", async () => {
    const seed = buildFoodObservationFixture({
      quantityHints: { value: 0.1, unit: "kg", servingText: "100 g" },
      evidence: [buildFoodObservationFixture().evidence[0], {
        ...buildFoodObservationFixture().evidence[1], value: 0.1, unit: "kg",
      }],
    });
    const equivalent = await resolveFoodObservation({
      ...seed,
      evidence: [...seed.evidence, {
        ...seed.evidence[1], evidenceId: "qty-100g", field: "quantity.value",
        value: 100, unit: "g", verified: true,
      }],
    }, context, fakeStore(match));
    expect(equivalent.status).toBe("resolved");
    expect(equivalent.quantity.grams).toBe(100);
    expect(equivalent.nutrition.consumed?.calories).toBe(270);
    expect(parseFoodResolutionDecision(equivalent).ok).toBe(true);
  });

  it("A-003: divergência em gramas após porção governada não é atribuída como prova nutricional", async () => {
    const seed = buildFoodObservationFixture();
    const mismatched = await resolveFoodObservation({
      ...seed,
      evidence: [...seed.evidence, {
        ...seed.evidence[1], evidenceId: "qty-40g", field: "quantity.grams",
        value: 40, unit: "g", verified: true,
      }],
    }, context, fakeStore(match));
    expect(mismatched.quantity.grams).toBe(30);
    expect(mismatched.status).toBe("partially_resolved");
    expect(mismatched.unresolvedFields).toContain("quantity");
    expect(mismatched.nutrition.consumed).toBeNull();
    expect(parseFoodResolutionDecision(mismatched).ok).toBe(true);
  });

  it("F-1305-001: evidência nutricional nova incompatível bloqueia proposta inicial e continuação", async () => {
    const seed = buildFoodObservationFixture();
    const label = {
      ...seed.evidence[1], evidenceId: "label-calories-conflict",
      field: "nutrition.calories", origin: "nutrition_label" as const,
      value: 999, unit: "kcal", verified: true,
    };
    const contradictory = { ...seed, evidence: [...seed.evidence, label] };
    const store = fakeStore(match);

    const first = await resolveFoodObservation(contradictory, context, store);
    expect(first.status).toBe("partially_resolved");
    expect(first.nextAction).toBe("clarify");
    expect(first.reasonCodes).toContain("source_conflict");
    expect(first.unresolvedFields).toContain("nutrition");
    expect(first.nutrition.consumed).toBeNull();
    expect(parseFoodResolutionDecision(first).ok).toBe(true);

    const accepted = await resolveFoodObservation(seed, context, store);
    const continued = await resolveFoodObservation(contradictory,
      { ...context, previousDecision: accepted }, store);
    expect(continued.status).toBe("partially_resolved");
    expect(continued.nextAction).toBe("clarify");
    expect(continued.unresolvedFields).toContain("nutrition");
    expect(continued.reasonCodes).toContain("source_conflict");
    expect(continued.nutrition).toEqual(accepted.nutrition);
    expect(parseFoodResolutionDecision(continued).ok).toBe(true);
  });

  it("F-1305-001: evidência verificada de consumo compatível não cria falso conflito", async () => {
    const seed = buildFoodObservationFixture();
    const current = await resolveFoodObservation({
      ...seed, evidence: [...seed.evidence, {
        ...seed.evidence[1], evidenceId: "label-calories-compatible",
        field: "nutrition.calories", origin: "nutrition_label",
        value: 81, unit: "kcal", verified: true,
      }],
    }, context, fakeStore(match));
    expect(current.status).toBe("resolved");
    expect(current.nutrition.consumed?.calories).toBe(81);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });

  it("F-1305-002: alternativas invalidam gramatura dependente da variante, não a quantidade textual", async () => {
    const seed = buildFoodObservationFixture();
    const candidates = buildFoodObservationFixture({
      alternatives: [
        alternativeFor("candidate-mortadela", "Mortadela"),
        alternativeFor("candidate-presunto", "Presunto"),
      ],
    });
    const store = fakeStore(match);
    const first = await resolveFoodObservation(candidates, context, store);
    expect(first.status).toBe("ambiguous");
    expect(first.quantity.value).toBe(1.5);
    expect(first.quantity.unit).toBe("fatia");
    expect(first.quantity.grams).toBeNull();
    expect(first.nutrition.consumed).toBeNull();
    expect(first.evidence.some(item => item.field === "quantity.grams" && item.origin === "catalog")).toBe(false);
    expect(parseFoodResolutionDecision(first).ok).toBe(true);

    const accepted = await resolveFoodObservation(seed, context, store);
    expect(accepted.quantity.grams).toBe(30);
    const continued = await resolveFoodObservation(candidates,
      { ...context, previousDecision: accepted }, store);
    expect(continued.status).toBe("ambiguous");
    expect(continued.quantity.value).toBe(accepted.quantity.value);
    expect(continued.quantity.grams).toBeNull();
    expect(continued.quantity.evidenceIds).not.toContain(
      accepted.quantity.evidenceIds.find(id => id.startsWith("r-")));
    expect(parseFoodResolutionDecision(continued).ok).toBe(true);
  });

  it("F-1305-003: hipótese única materialmente distinta exige clarificação", async () => {
    const observation = buildFoodObservationFixture({
      alternatives: [alternativeFor("candidate-presunto", "Presunto")],
      unresolvedReason: "unknown_surface",
    });
    const current = await resolveFoodObservation(observation, context, fakeStore(match));
    expect(current.status).toBe("unknown");
    expect(current.nextAction).toBe("clarify");
    expect(current.reasonCodes).toContain("source_conflict");
    expect(current.alternatives).toHaveLength(1);
    expect(current.quantity.value).toBe(1.5);
    expect(current.quantity.grams).toBeNull();
    expect(current.nutrition.consumed).toBeNull();
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });

  it("F-1305-003: hipótese única comprovadamente equivalente não reabre decisão", async () => {
    const seed = buildFoodObservationFixture();
    const alternative = {
      ...alternativeFor("same-governed-variant", "Mortadela"),
      quantityHints: { ...seed.quantityHints },
    };
    const decision = await resolveFoodObservation({
      ...seed, alternatives: [alternative],
    }, context, fakeStore(match));
    expect(decision.status).toBe("resolved");
    expect(decision.quantity.grams).toBe(30);
    expect(decision.nutrition.consumed?.calories).toBe(81);
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
  });

  it.each(["foreign-variant", "foreign-family", "missing-source", "missing-revision", "expired", "not-yet-valid"])(
    "portion provenance fails closed: %s", async failure => {
      const portion = { ...match.portions[0] };
      if (failure === "foreign-variant") portion.variantId = 999;
      if (failure === "foreign-family") portion.foodEntityId = 999;
      if (failure === "missing-source") portion.sourceId = 0;
      if (failure === "missing-revision") portion.sourceVersion = "";
      if (failure === "expired") portion.validTo = "2026-10-20T00:00:00Z";
      if (failure === "not-yet-valid") portion.validFrom = "2026-11-01T00:00:00Z";
      const current = await resolveFoodObservation(buildFoodObservationFixture(),
        { ...context, now: new Date("2026-10-21T12:00:00Z") }, fakeStore({ ...match, portions: [portion] }));
      expect(current.nextAction).not.toBe("propose");
      expect(current.quantity.grams).toBeNull();
      expect(current.quantity.portionId).toBeNull();
      expect(current.nutrition.consumed).toBeNull();
      expect(parseFoodResolutionDecision(current).ok).toBe(true);
    },
  );

  it.each(["variant", "portion-id", "source", "revision", "grams", "measure-kind", "missing-snapshot"])(
    "the public schema rejects a forged portion binding: %s", async change => {
      const valid = await resolveFoodObservation(buildFoodObservationFixture(), context, fakeStore(match));
      expect(valid.status).toBe("resolved");
      const forged = JSON.parse(JSON.stringify(valid)) as typeof valid;
      if (change === "variant") forged.identity.variantId = 999;
      if (change === "portion-id") forged.quantity.portionId = 999;
      if (change === "source") forged.quantity.portionSnapshot!.sourceId = 999;
      if (change === "revision") forged.quantity.portionSnapshot!.sourceVersion = "other-version";
      if (change === "grams") forged.quantity.portionSnapshot!.grams = 45;
      if (change === "measure-kind") forged.quantity.measureKind = "usual_average";
      if (change === "missing-snapshot") forged.quantity.portionSnapshot = null;
      expect(parseFoodResolutionDecision(forged).ok).toBe(false);
    },
  );

  it("binds the nutritional snapshot to the selected portion revision even with identical macros", async () => {
    const seed = buildFoodObservationFixture();
    const first = await resolveFoodObservation(seed, context, fakeStore(match));
    const edited = { ...match, portions: [{ ...match.portions[0], sourceVersion: "portion-v2" }] };
    const second = await resolveFoodObservation(seed, context, fakeStore(edited));
    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
    expect(second.nutrition.consumed).toEqual(first.nutrition.consumed);
    expect(second.nutrition.snapshotHash).not.toBe(first.nutrition.snapshotHash);
    expect(second.quantity.portionSnapshot?.sourceVersion).toBe("portion-v2");
  });

  it("does not reuse an expired portion through the continuity fast path", async () => {
    const at = new Date("2026-10-21T12:00:00Z");
    const expiring = { ...match, portions: [{ ...match.portions[0], validTo: "2026-10-22T00:00:00Z" }] };
    const store = fakeStore(expiring);
    const first = await resolveFoodObservation(buildFoodObservationFixture(), { ...context, now: at }, store);
    expect(first.status).toBe("resolved");
    const second = await resolveFoodObservation(buildFoodObservationFixture(),
      { ...context, now: new Date("2026-10-22T00:00:00Z"), previousDecision: first }, store);
    expect(second.nextAction).not.toBe("propose");
    expect(second.quantity.value).toBe(1.5);
    expect(second.quantity.grams).toBeNull();
    expect(second.quantity.portionSnapshot).toBeNull();
    expect(second.nutrition.consumed).toBeNull();
    expect(store.readLocal).toHaveBeenCalledTimes(2);
    expect(parseFoodResolutionDecision(second).ok).toBe(true);
  });


  it.each([
    { value: 100, unit: "g", grams: 100, calories: 270 },
    { value: 2, unit: "fatia", grams: 40, calories: 108 },
  ])("completa quantidade ausente com $value $unit, inclusive sem repetir identidade", async supplied => {
    const seed = buildFoodObservationFixture();
    const missing = buildFoodObservationFixture({
      quantityHints: { value: null, unit: null, servingText: null },
    });
    missing.evidence = seed.evidence.filter(item => !item.field.startsWith("quantity."));
    const store = fakeStore(match);
    const first = await resolveFoodObservation(missing, context, store);
    expect(first.reasonCodes).toContain("quantity_missing");
    const frozen = JSON.stringify(first);
    for (const foodName of ["mortadela", null]) {
      const reply = buildFoodObservationFixture({
        identityHints: { foodName },
        quantityHints: { value: supplied.value, unit: supplied.unit, servingText: null },
      });
      reply.evidence = [{ ...seed.evidence[1], value: supplied.value, unit: supplied.unit }];
      const current = await resolveFoodObservation(reply,
        { ...context, previousDecision: JSON.parse(frozen) }, store);
      expect(current.status).toBe("resolved");
      expect(current.nextAction).toBe("propose");
      expect(current.quantity.value).toBe(supplied.value);
      expect(current.quantity.grams).toBe(supplied.grams);
      expect(current.nutrition.consumed?.calories).toBe(supplied.calories);
      expect(current.reasonCodes).not.toContain("source_conflict");
      expect(current.identity.variantId).toBe(first.identity.variantId);
      expect(parseFoodResolutionDecision(current).ok).toBe(true);
      expect(store.readLocal).toHaveBeenLastCalledWith(expect.objectContaining({ normalizedName: "mortadela" }));
    }
    expect(JSON.stringify(first)).toBe(frozen);
  });

  it.each([
    ["variant.variantId", 202], ["variant.foodEntityId", 201],
    ["variant.candidateKey", "variant:202"], ["identity.brand", "Outra marca"],
    ["identity.barcode", "7899999999999"], ["identity.variant", "Outra variante"],
  ] as const)("reconcilia evidência forte %s antes da proposta inicial e continuada", async (field, value) => {
    const seed = buildFoodObservationFixture();
    const store = fakeStore(match);
    const first = await resolveFoodObservation(seed, context, store);
    const frozen = JSON.stringify(first);
    const observed = buildFoodObservationFixture({ evidence: [...seed.evidence, {
      ...seed.evidence[0], evidenceId: "independent-verified-identity", field, value,
      verified: true, origin: "catalog", sourceId: 501,
      anchor: { sourceRef: "catalog:independent", span: null, region: null },
    }] });
    for (const previousDecision of [undefined, JSON.parse(frozen)]) {
      const current = await resolveFoodObservation(observed, { ...context, previousDecision }, store);
      expect(current.nextAction).toBe("clarify");
      expect(current.reasonCodes).toContain("source_conflict");
      expect(current.unresolvedFields).toContain("identity");
      expect(current.unresolvedFields).toContain("variant");
      expect(current.identity.variantId).toBeNull();
      expect(current.quantity.value).toBe(seed.quantityHints.value);
      expect(current.quantity.grams).toBeNull();
      expect(current.nutrition.consumed).toBeNull();
      expect(current.evidence).toContainEqual(expect.objectContaining({ evidenceId: "independent-verified-identity", value }));
      expect(parseFoodResolutionDecision(current).ok).toBe(true);
    }
    expect(JSON.stringify(first)).toBe(frozen);
  });

  it("aceita identidade verificada concordante sem inventar conflito", async () => {
    const seed = buildFoodObservationFixture();
    const decision = await resolveFoodObservation(buildFoodObservationFixture({
      evidence: [...seed.evidence, { ...seed.evidence[0], evidenceId: "verified-variant",
        field: "variant.variantId", value: match.variantId, verified: true, origin: "catalog", sourceId: 501 }],
    }), context, fakeStore(match));
    expect(decision.status).toBe("resolved");
    expect(decision.nextAction).toBe("propose");
    expect(decision.reasonCodes).toEqual([]);
  });

  it.each(["missing", "expired", "not-yet-valid", "other-user", "other-resolver"] as const)(
    "reconsulta quando elegibilidade temporal é %s sem mutar histórico", async change => {
      const at = new Date("2026-10-26T10:00:00Z");
      const store = fakeStore(match);
      const original = await resolveFoodObservation(buildFoodObservationFixture(), { ...context, now: at }, store);
      const previous = JSON.parse(JSON.stringify(original));
      if (change === "missing") delete previous.knowledgeValidity;
      if (change === "expired") previous.knowledgeValidity.validUntil = at.toISOString();
      if (change === "not-yet-valid") previous.knowledgeValidity.checkedAt = "2026-10-26T10:01:00Z";
      if (change === "other-user") previous.knowledgeValidity.userId = 99;
      if (change === "other-resolver") previous.knowledgeValidity.resolverVersion = "retired";
      const frozen = JSON.stringify(previous);
      vi.mocked(store.readLocal).mockRejectedValue(new Error("unavailable"));
      const current = await resolveFoodObservation(buildFoodObservationFixture(),
        { ...context, now: at, previousDecision: previous }, store);
      expect(store.readLocal).toHaveBeenCalledTimes(2);
      expect(current.nextAction).not.toBe("propose");
      expect(current.nutrition.consumed).toBeNull();
      expect(JSON.stringify(previous)).toBe(frozen);
    });


  it.each(["defumada", "Mortadela defumada", "crua"])(
    "preserva qualificadores de variante comprovados e rejeita contradição: %s", async claim => {
      const seed = buildFoodObservationFixture();
      const input = buildFoodObservationFixture({
        identityHints: { foodName: "mortadela defumada", variant: "defumada" },
        evidence: [{ ...seed.evidence[0], value: "mortadela defumada" }, seed.evidence[1], {
          ...seed.evidence[0], evidenceId: "verified-variant-attribute", field: "identity.variant",
          value: claim, sourceId: 501, origin: "catalog", verified: true,
        }],
      });
      const store = fakeStore({ ...match, variantName: "Mortadela defumada" });
      const current = await resolveFoodObservation(input, context, store);
      if (claim === "crua") {
        expect(current.nextAction).not.toBe("propose");
        expect(current.reasonCodes).toContain("source_conflict");
      } else {
        expect(current.status).toBe("resolved");
        expect(current.nextAction).toBe("propose");
        expect(current.reasonCodes).toEqual([]);
        expect(current.identity.variant).toBe("defumada");
        const snapshot = JSON.stringify(current);
        vi.mocked(store.readLocal).mockRejectedValue(new Error("temporarily unavailable"));
        const repeated = await resolveFoodObservation(input,
          { ...context, previousDecision: JSON.parse(snapshot) }, store);
        expect(repeated.identity).toEqual(current.identity);
        expect(repeated.quantity).toEqual(current.quantity);
        expect(repeated.status).toBe("resolved");
        expect(store.readLocal).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(current)).toBe(snapshot);
      }
      expect(parseFoodResolutionDecision(current).ok).toBe(true);
    });

  it("preserva identidade elegível e quantidade respondida durante falha, e tenta novamente", async () => {
    const seed = buildFoodObservationFixture();
    const missing = buildFoodObservationFixture({ quantityHints: { value: null, unit: null, servingText: null } });
    missing.evidence = [seed.evidence[0]];
    const store = fakeStore(match);
    const first = await resolveFoodObservation(missing, context, store);
    const reply = buildFoodObservationFixture({ identityHints: { foodName: null },
      quantityHints: { value: 100, unit: "g", servingText: null } });
    reply.evidence = [{ ...seed.evidence[1], value: 100, unit: "g" }];
    vi.mocked(store.readLocal).mockRejectedValueOnce(new Error("unavailable"));
    const pending = await resolveFoodObservation(reply, { ...context, previousDecision: first }, store);
    expect(pending.status).toBe("partially_resolved");
    expect(pending.nextAction).toBe("retry");
    expect(pending.identity).toEqual(first.identity);
    expect(pending.quantity.grams).toBe(100);
    expect(pending.nutrition.consumed).toBeNull();
    expect(pending.unresolvedFields).toEqual(["nutrition"]);
    const retried = await resolveFoodObservation(reply, { ...context, previousDecision: pending }, store);
    expect(store.readLocal).toHaveBeenCalledTimes(3);
    expect(retried.status).toBe("resolved");
    expect(retried.quantity.grams).toBe(100);
    expect(retried.nutrition.consumed?.calories).toBe(270);
  });


  it("completa quantidade usando nome canônico sem contradizer alias já comprovado da mesma variante", async () => {
    const seed = buildFoodObservationFixture();
    const initial = buildFoodObservationFixture({ identityHints: { foodName: "meu lanche" },
      quantityHints: { value: null, unit: null, servingText: null } });
    initial.evidence = [{ ...seed.evidence[0], value: "meu lanche" }];
    const store = fakeStore({ ...match, matchingEvidence: "personal_alias" });
    const previous = await resolveFoodObservation(initial, context, store);
    expect(previous.reasonCodes).toContain("quantity_missing");
    const reply = buildFoodObservationFixture({ identityHints: { foodName: "Mortadela" },
      quantityHints: { value: 100, unit: "g", servingText: null } });
    reply.evidence = [{ ...seed.evidence[1], value: 100, unit: "g" }];
    const current = await resolveFoodObservation(reply, { ...context, previousDecision: previous }, store);
    expect(current.status).toBe("resolved");
    expect(current.identity.variantId).toBe(previous.identity.variantId);
    expect(current.nutrition.consumed?.calories).toBe(270);
    expect(current.reasonCodes).toEqual([]);
  });


  it("mantém evidência independente de variante em três turnos após completar só a quantidade", async () => {
    const seed = buildFoodObservationFixture();
    const entry = (name: string | null, value: number | null) => {
      const rawInput = [value, value === null ? null : "g", name].filter(item => item !== null).join(" ");
      const anchor = { ...seed.surfaceSpan, span: { start: 0, end: rawInput.length } };
      return { ...structuredClone(seed), rawInput, normalizedInput: rawInput, surfaceSpan: anchor,
        normalizationPath: seed.normalizationPath.map(item => ({ ...item, anchor })),
        identityHints: { ...seed.identityHints, foodName: name, variant: name ? "defumada" : null },
        quantityHints: { ...seed.quantityHints, value, unit: value === null ? null : "g", servingText: null },
        evidence: [
          ...(name === null ? [] : [{ ...seed.evidence[0], value: name, anchor }, {
            ...seed.evidence[0], evidenceId: "verified-variant-attribute", field: "identity.variant",
            value: "defumada", sourceId: 501, origin: "catalog" as const,
            anchor: { sourceRef: "catalog:variant-attribute", span: null, region: null },
          }]),
          ...(value === null ? [] : [{ ...seed.evidence[1], value, unit: "g", anchor }]),
        ],
      };
    };
    const store = fakeStore({ ...match, variantName: "Mortadela defumada" });
    const first = await resolveFoodObservation(entry("mortadela defumada", null), context, store);
    expect(first.reasonCodes).toContain("quantity_missing");
    const second = await resolveFoodObservation(entry(null, 100), { ...context, previousDecision: first }, store);
    expect(second.status).toBe("resolved");
    expect(second.identity.variant).toBe("defumada");
    expect(second.identity.evidenceIds).toContain("verified-variant-attribute");
    expect(second.evidence).toContainEqual(first.evidence.find(item => item.evidenceId === "verified-variant-attribute"));
    const frozen = JSON.stringify(second);
    vi.mocked(store.readLocal).mockRejectedValue(new Error("unavailable"));
    const third = await resolveFoodObservation(entry("mortadela defumada", 100),
      { ...context, previousDecision: JSON.parse(frozen) }, store);
    expect(store.readLocal).toHaveBeenCalledTimes(2);
    expect(third.status).toBe("resolved");
    expect(third.identity).toEqual(second.identity);
    expect(third.quantity).toEqual(second.quantity);
    expect(third.nutrition).toEqual(second.nutrition);
    expect(parseFoodResolutionDecision(third).ok).toBe(true);
    expect(JSON.stringify(second)).toBe(frozen);
  });

});

describe("F-1305-006: correção entre turnos não herda alegações supersedidas", () => {
  function turn(name: string, id: number, options: {
    brand?: string; barcode?: string; grams?: number;
  } = {}): FoodObservation {
    const raw = [name, options.brand].filter(Boolean).join(" ");
    const anchor = { sourceRef: `turn:${id}:text`, span: { start: 0, end: raw.length }, region: null };
    const observation = buildFoodObservationFixture({
      rawInput: raw, normalizedInput: raw, surfaceSpan: anchor, normalizationPath: [], evidence: [],
      identityHints: { foodName: name, brand: options.brand ?? null, barcode: options.barcode ?? null },
      quantityHints: { value: options.grams ?? null, unit: options.grams == null ? null : "g",
        servingText: options.grams == null ? null : `${options.grams} g` },
    });
    const text = (suffix: string, field: "identity.foodName" | "identity.brand" | "quantity.value",
      value: string | number, unit: string | null = null): FoodObservation["evidence"][number] => ({
      evidenceId: `turn:${id}:${suffix}`, field, origin: "text", value, unit,
      confidence: 1, verified: true, anchor, sourceId: null,
    });
    observation.evidence = [text("name", "identity.foodName", name)];
    if (options.brand) observation.evidence.push(text("brand", "identity.brand", options.brand));
    if (options.grams !== undefined) observation.evidence.push(text("mass", "quantity.value", options.grams, "g"));
    if (options.barcode) observation.evidence.push({
      ...text("barcode", "identity.foodName", name),
      evidenceId: `turn:${id}:barcode`, field: "identity.barcode", origin: "barcode",
      value: options.barcode,
    });
    return observation;
  }

  const presunto: GovernedFoodMatch = {
    ...match, foodId: 201, variantId: 202, profileId: 203,
    variantName: "Presunto", portions: [], nutrition: { ...match.nutrition, caloriesKcal: 180 },
  };
  const selectFood = (): FoodKnowledgeStore => ({
    ...fakeStore(match),
    readLocal: vi.fn(async (request: Parameters<FoodKnowledgeStore["readLocal"]>[0]): Promise<FoodKnowledgeLocalResult> => request.normalizedName === "mortadela" ? match :
      request.normalizedName === "presunto" ? presunto : { kind: "miss", reason: "not_found" }),
  });

  it("aceita correção por nova superfície e IDs, converge em turnos posteriores e preserva quantidade/snapshot", async () => {
    const store = selectFood();
    const original = await resolveFoodObservation(turn("Mortadela", 1, { grams: 100 }), context, store);
    const frozen = JSON.stringify(original);
    expect(original.status).toBe("resolved");
    const corrected = await resolveFoodObservation(turn("Presunto", 2),
      { ...context, previousDecision: original }, store);
    expect(corrected.status).toBe("resolved");
    expect(corrected.nextAction).toBe("propose");
    expect(corrected.identity.variantId).toBe(presunto.variantId);
    expect(corrected.quantity).toEqual(original.quantity);
    expect(corrected.nutrition.consumed?.calories).toBe(180);
    expect(corrected.nutrition.profileId).toBe(presunto.profileId);
    expect(corrected.evidence.map(item => item.evidenceId)).not.toContain("turn:1:name");
    expect(corrected.evidence.map(item => item.evidenceId)).toContain("turn:1:mass");
    expect(corrected.evidence.map(item => item.evidenceId)).toContain("turn:2:name");
    expect(parseFoodResolutionDecision(corrected).ok).toBe(true);
    expect(JSON.stringify(original)).toBe(frozen);
    const repeated = await resolveFoodObservation(turn("Presunto", 3),
      { ...context, previousDecision: corrected }, store);
    expect(repeated.status).toBe("resolved");
    expect(repeated.reasonCodes).toEqual([]);
    expect(repeated.evidence.map(item => item.evidenceId)).not.toContain("turn:1:name");
    expect(parseFoodResolutionDecision(repeated).ok).toBe(true);
  });

  it("aceita marca corrigida sem aceitar macro de outro SKU", async () => {
    const store: FoodKnowledgeStore = {
      ...fakeStore(match),
      readLocal: vi.fn(async (request: Parameters<FoodKnowledgeStore["readLocal"]>[0]): Promise<FoodKnowledgeLocalResult> => request.brand === "Marca A" || request.brand === "Marca B" ? {
        ...match, portions: [], matchedBrand: request.brand,
        foodId: request.brand === "Marca A" ? 301 : 302,
        variantId: request.brand === "Marca A" ? 311 : 312,
        profileId: request.brand === "Marca A" ? 321 : 322,
        nutrition: { ...match.nutrition, caloriesKcal: request.brand === "Marca A" ? 150 : 250 },
      } : { kind: "miss", reason: "incompatible_evidence" }),
    };
    const original = await resolveFoodObservation(turn("Mortadela", 11,
      { brand: "Marca A", grams: 100 }), context, store);
    expect(original.status).toBe("resolved");
    const corrected = await resolveFoodObservation(turn("Mortadela", 12, { brand: "Marca B" }),
      { ...context, previousDecision: original }, store);
    expect(corrected.status).toBe("resolved");
    expect(corrected.identity.brand).toBe("Marca B");
    expect(corrected.identity.variantId).toBe(312);
    expect(corrected.nutrition.profileId).toBe(322);
    expect(corrected.nutrition.consumed?.calories).toBe(250);
    expect(corrected.evidence.map(item => item.evidenceId)).not.toContain("turn:11:brand");
    expect(parseFoodResolutionDecision(corrected).ok).toBe(true);
  });

  it("não descarta evidência independente verificada quando o usuário altera a identidade", async () => {
    const input = turn("Mortadela", 21, { grams: 100 });
    input.evidence.push({ ...input.evidence[0], evidenceId: "independent:catalog",
      origin: "catalog", sourceId: 501, anchor: { sourceRef: "catalog:verified", span: null, region: null } });
    const store = selectFood();
    const original = await resolveFoodObservation(input, context, store);
    expect(original.status).toBe("resolved");
    const current = await resolveFoodObservation(turn("Presunto", 22),
      { ...context, previousDecision: original }, store);
    expect(current.status).toBe("unknown");
    expect(current.nextAction).toBe("clarify");
    expect(current.reasonCodes).toContain("source_conflict");
    expect(current.evidence.map(item => item.evidenceId)).toContain("independent:catalog");
    expect(current.nutrition.consumed).toBeNull();
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });

  it("não transforma repetição da mesma superfície nem transcrição não verificada em supersessão", async () => {
    const store = selectFood();
    const original = await resolveFoodObservation(turn("Mortadela", 31, { grams: 100 }), context, store);
    const repeatedSurface = turn("Presunto", 32);
    repeatedSurface.surfaceSpan.sourceRef = original.evidence[0].anchor.sourceRef;
    repeatedSurface.evidence[0].anchor.sourceRef = original.evidence[0].anchor.sourceRef;
    const unverified = turn("Presunto", 33);
    unverified.evidence[0] = { ...unverified.evidence[0], verified: false };
    for (const changed of [repeatedSurface, unverified]) {
      const current = await resolveFoodObservation(changed,
        { ...context, previousDecision: original }, store);
      expect(current.status).toBe("unknown");
      expect(current.reasonCodes).toContain("source_conflict");
      expect(current.evidence.map(item => item.evidenceId)).toContain("turn:31:name");
      expect(current.nutrition.consumed).toBeNull();
      expect(parseFoodResolutionDecision(current).ok).toBe(true);
    }
  });

  it("barcode validado e conflito atual de catálogo não podem ser sobrescritos por novo texto", async () => {
    const barcode = "7891234567890";
    const initial = { ...match, matchingEvidence: "barcode" as const, matchedBarcode: barcode, portions: [] };
    const store: FoodKnowledgeStore = {
      ...fakeStore(match),
      readLocal: vi.fn(async (request: Parameters<FoodKnowledgeStore["readLocal"]>[0]): Promise<FoodKnowledgeLocalResult> => request.barcode === barcode ? initial : presunto),
    };
    const original = await resolveFoodObservation(turn("Mortadela", 41, { grams: 100, barcode }), context, store);
    expect(original.status).toBe("resolved");
    const corrected = await resolveFoodObservation(turn("Presunto", 42),
      { ...context, previousDecision: original }, store);
    expect(corrected.status).toBe("unknown");
    expect(corrected.reasonCodes).toContain("source_conflict");
    expect(corrected.evidence.some(item => item.field === "identity.barcode" && item.value === barcode)).toBe(true);
    const sameTurn = turn("Presunto", 43);
    sameTurn.evidence.push({ ...sameTurn.evidence[0], evidenceId: "same-turn:independent",
      origin: "catalog", value: "Mortadela", sourceId: 502,
      anchor: { sourceRef: "catalog:current", span: null, region: null } });
    const conflicting = await resolveFoodObservation(sameTurn, context, selectFood());
    expect(conflicting.status).toBe("unknown");
    expect(conflicting.reasonCodes).toContain("source_conflict");
  });

  it("A-003: colisão de evidenceId entre catálogo e novo texto não apaga prova independente", async () => {
    const store = selectFood();
    const initial = turn("Mortadela", 61, { grams: 100 });
    const independent = { ...initial.evidence[0], evidenceId: "independent:catalog",
      origin: "catalog" as const, sourceId: 501,
      anchor: { sourceRef: "catalog:verified", span: null, region: null } };
    initial.evidence.push(independent);
    const previous = await resolveFoodObservation(initial, context, store);
    expect(previous.status).toBe("resolved");
    const snapshot = JSON.stringify(previous);

    const distinct = await resolveFoodObservation(turn("Presunto", 62),
      { ...context, previousDecision: previous }, store);
    const colliding = turn("Presunto", 62);
    colliding.evidence[0].evidenceId = independent.evidenceId;
    const originalInput = JSON.stringify(colliding);
    const result = await resolveFoodObservation(colliding,
      { ...context, previousDecision: previous }, store);
    for (const decision of [distinct, result]) {
      expect(decision.status).toBe("unknown");
      expect(decision.nextAction).toBe("clarify");
      expect(decision.reasonCodes).toContain("source_conflict");
      expect(decision.nutrition.consumed).toBeNull();
      expect(decision.evidence).toContainEqual(independent);
      expect(parseFoodResolutionDecision(decision).ok).toBe(true);
    }
    expect(result.evidence.find(item => item.evidenceId === independent.evidenceId)).toEqual(independent);
    expect(result.evidence.filter(item => item.value === "Presunto" && item.origin === "text"))
      .toEqual([expect.objectContaining({ evidenceId: expect.stringMatching(/^turn-[0-9a-f]{40}$/) })]);
    expect(new Set(result.evidence.map(item => item.evidenceId)).size).toBe(result.evidence.length);
    expect(JSON.stringify(previous)).toBe(snapshot);
    expect(JSON.stringify(colliding)).toBe(originalInput);
  });

  it("A-003: ID reutilizado não esconde classificação negativa verificada", async () => {
    const initial = turn("Mortadela", 63);
    initial.evidence.push({ ...initial.evidence[0], evidenceId: "independent:negative",
      field: "classification.isFood", value: false, origin: "catalog", sourceId: 701,
      anchor: { sourceRef: "catalog:negative", span: null, region: null } });
    const store = selectFood();
    const previous = await resolveFoodObservation(initial, context, store);
    expect(previous.nextAction).toBe("reject");
    const current = turn("Mortadela", 64, { grams: 100 });
    current.evidence.push({ ...current.evidence[0], evidenceId: "independent:negative",
      field: "classification.isFood", value: true, origin: "catalog", sourceId: 702,
      anchor: { sourceRef: "catalog:positive", span: null, region: null } });
    const result = await resolveFoodObservation(current,
      { ...context, previousDecision: previous }, store);
    expect(result.status).toBe("unknown");
    expect(result.nextAction).toBe("clarify");
    expect(result.reasonCodes).toContain("source_conflict");
    expect(result.nutrition.consumed).toBeNull();
    expect(result.evidence.filter(item => item.field === "classification.isFood")
      .map(item => item.value)).toEqual([true, false]);
    expect(parseFoodResolutionDecision(result).ok).toBe(true);
  });

  it("A-003: ID colidido em hipóteses concorrentes preserva os links e o snapshot", async () => {
    const initial = turn("Mortadela", 65, { grams: 100 });
    initial.evidence.push({ ...initial.evidence[0], evidenceId: "independent:catalog",
      origin: "catalog", sourceId: 501,
      anchor: { sourceRef: "catalog:verified", span: null, region: null } });
    const store = selectFood();
    const previous = await resolveFoodObservation(initial, context, store);
    const current = turn("Presunto", 66);
    current.evidence[0].evidenceId = "independent:catalog";
    current.alternatives = [
      { ...alternativeFor("presunto", "Presunto"), evidenceIds: ["independent:catalog"] },
      { ...alternativeFor("mortadela", "Mortadela"), evidenceIds: ["independent:catalog"] },
    ];
    const result = await resolveFoodObservation(current,
      { ...context, previousDecision: previous }, store);
    const newEvidence = result.evidence.find(item => item.origin === "text" && item.value === "Presunto");
    expect(newEvidence?.evidenceId).toMatch(/^turn-[0-9a-f]{40}$/);
    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives.every(item => item.evidenceIds.includes(newEvidence!.evidenceId))).toBe(true);
    expect(result.evidence.some(item => item.evidenceId === "independent:catalog" &&
      item.origin === "catalog" && item.value === "Mortadela")).toBe(true);
    expect(result.nextAction).toBe("clarify");
    expect(parseFoodResolutionDecision(result).ok).toBe(true);
  });

  it("A-003: a repetição do mesmo registro não duplica evidência nem inventa conflito", async () => {
    const initial = turn("Mortadela", 67, { grams: 100 });
    initial.evidence.push({ ...initial.evidence[0], evidenceId: "independent:catalog",
      origin: "catalog", sourceId: 501,
      anchor: { sourceRef: "catalog:verified", span: null, region: null } });
    const store = selectFood();
    const previous = await resolveFoodObservation(initial, context, store);
    const equivalent = turn("Mortadela", 68);
    equivalent.evidence.push(structuredClone(initial.evidence[initial.evidence.length - 1]));
    const result = await resolveFoodObservation(equivalent,
      { ...context, previousDecision: previous }, store);
    expect(result.status).toBe("resolved");
    expect(result.reasonCodes).toEqual([]);
    expect(result.evidence.filter(item => item.evidenceId === "independent:catalog")).toHaveLength(1);
    expect(result.evidence.some(item => item.evidenceId.startsWith("turn-"))).toBe(false);
    expect(parseFoodResolutionDecision(result).ok).toBe(true);
  });

  it.each([
    { next: 50, unit: "g", conflict: true },
    { next: 0.05, unit: "kg", conflict: true },
    { next: 100, unit: "g", conflict: false },
    { next: 0.1, unit: "kg", conflict: false },
    { next: 100, unit: "ml", conflict: true },
  ])("A-004: snapshot grams-only versus $next $unit respeita conflito=$conflict", async row => {
    const store = selectFood();
    const previous = await resolveFoodObservation(turn("Mortadela", 71, { grams: 100 }), context, store);
    expect(previous.status).toBe("resolved");
    const gramsOnly = structuredClone(previous);
    gramsOnly.quantity.value = null;
    gramsOnly.quantity.unit = null;
    gramsOnly.evidence = gramsOnly.evidence.map(item => item.field === "quantity.value"
      ? { ...item, field: "quantity.grams" } : item);
    expect(parseFoodResolutionDecision(gramsOnly).ok).toBe(true);
    const immutable = JSON.stringify(gramsOnly);
    const next = turn("Mortadela", 72, { grams: row.next });
    next.quantityHints.unit = row.unit;
    next.evidence.find(item => item.field === "quantity.value")!.unit = row.unit;
    const decision = await resolveFoodObservation(next,
      { ...context, previousDecision: gramsOnly }, store);
    if (row.conflict) {
      expect(decision.status).toBe("partially_resolved");
      expect(decision.nextAction).toBe("clarify");
      expect(decision.unresolvedFields).toContain("quantity");
      expect(decision.reasonCodes).toContain("source_conflict");
    } else {
      expect(decision.status).toBe("resolved");
      expect(decision.nextAction).toBe("propose");
      expect(decision.reasonCodes).toEqual([]);
      expect(decision.quantity.grams).toBe(100);
      expect(decision.nutrition.consumed?.calories).toBe(270);
    }
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
    expect(JSON.stringify(gramsOnly)).toBe(immutable);
  });

  it.each([
    { next: 50, unit: "ml", conflict: true },
    { next: 0.05, unit: "l", conflict: true },
    { next: 100, unit: "ml", conflict: false },
    { next: 0.1, unit: "l", conflict: false },
    { next: 100, unit: "g", conflict: true },
  ])("A-004: snapshot milliliters-only versus $next $unit respeita conflito=$conflict", async row => {
    const volumeMatch = { ...match, nutrition: { ...match.nutrition, basisUnit: "ml" as const } };
    const store = fakeStore(volumeMatch);
    const original = turn("Mortadela", 73, { grams: 100 });
    original.quantityHints.unit = "ml";
    original.evidence.find(item => item.field === "quantity.value")!.unit = "ml";
    const previous = await resolveFoodObservation(original, context, store);
    expect(previous.status).toBe("resolved");
    const volumeOnly = structuredClone(previous);
    volumeOnly.quantity.value = null;
    volumeOnly.quantity.unit = null;
    volumeOnly.evidence = volumeOnly.evidence.map(item => item.field === "quantity.value"
      ? { ...item, field: "quantity.milliliters" } : item);
    expect(parseFoodResolutionDecision(volumeOnly).ok).toBe(true);
    const immutable = JSON.stringify(volumeOnly);
    const next = turn("Mortadela", 74, { grams: row.next });
    next.quantityHints.unit = row.unit;
    next.evidence.find(item => item.field === "quantity.value")!.unit = row.unit;
    const decision = await resolveFoodObservation(next,
      { ...context, previousDecision: volumeOnly }, store);
    if (row.conflict) {
      expect(decision.status).toBe("partially_resolved");
      expect(decision.nextAction).toBe("clarify");
      expect(decision.reasonCodes).toContain("source_conflict");
      expect(decision.unresolvedFields).toContain("quantity");
    } else {
      expect(decision.status).toBe("resolved");
      expect(decision.nextAction).toBe("propose");
      expect(decision.quantity.milliliters).toBe(100);
      expect(decision.nutrition.consumed?.calories).toBe(270);
    }
    expect(parseFoodResolutionDecision(decision).ok).toBe(true);
    expect(JSON.stringify(volumeOnly)).toBe(immutable);
  });

  it("não herda afirmações de outra conta ao receber correção direta", async () => {
    const store = selectFood();
    const original = await resolveFoodObservation(turn("Mortadela", 51, { grams: 100 }), context, store);
    const other = await resolveFoodObservation(turn("Presunto", 52),
      { ...context, userId: 19, previousDecision: original }, store);
    expect(other.decisionId).not.toBe(original.decisionId);
    expect(other.ownerUserId).toBe(19);
    expect(other.evidence.map(item => item.evidenceId)).not.toContain("turn:51:name");
    expect(other.quantity.value).toBeNull();
    expect(parseFoodResolutionDecision(other).ok).toBe(true);
  });
});
