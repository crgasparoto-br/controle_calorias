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
  portions: [{ label: "fatia", unit: "fatia", quantity: 1, grams: 20, status: "verified" }],
};

function fakeStore(local: FoodKnowledgeLocalResult): FoodKnowledgeStore {
  return {
    readLocal: vi.fn().mockResolvedValue(local),
    readPendingEvidence: vi.fn().mockResolvedValue(null),
    stagePendingEvidence: vi.fn().mockResolvedValue(false),
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
});
