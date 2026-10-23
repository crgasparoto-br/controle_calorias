import { describe, expect, it, vi } from "vitest";
import {
  readThroughGovernedKnowledge, type FoodKnowledgeRequest,
  type FoodKnowledgeStore, type GovernedFoodMatch,
} from "./knowledgeRead";

const base: FoodKnowledgeRequest = {
  normalizedName: "pao integral", brand: null, barcode: null, userId: 41,
  policyVersion: "governance-v1", resolverVersion: "resolver-v2",
};
const nutrition = {
  caloriesKcal: 100, proteinG: 4, carbG: 16, fatG: 2,
  basisQuantity: 50, basisUnit: "g" as const,
};
const match: GovernedFoodMatch = {
  kind: "match", matchingEvidence: "exact_variant", foodId: 101,
  variantId: 202, profileId: 303, variantName: "Pao integral",
  sourceId: 7, sourceVersion: "1", sourceReference: "https://example.org/food",
  nutrition, governanceStatus: "verified", portions: [],
};

function fixture() {
  const local = vi.fn(async () => ({ kind: "miss", reason: "not_found" } as const));
  const pending = vi.fn(async (_request: FoodKnowledgeRequest) => null as any);
  const stage = vi.fn(async () => false);
  const store: FoodKnowledgeStore = {
    readLocal: local, readPendingEvidence: pending, stagePendingEvidence: stage,
  };
  return { local, pending, stage, store };
}

describe("B2 — porta governada e cache-through", () => {
  it("usa resultado exato governado antes de cache ou rede", async () => {
    const f = fixture();
    f.local.mockResolvedValueOnce(match as never);
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge(base, f.store, external)).toEqual(match);
    expect(f.pending).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
  });

  it("resolve hit pessoal sem chamar provider e nunca promove", async () => {
    const f = fixture();
    f.pending.mockResolvedValueOnce({
      sourceId: 7, sourceReference: "https://example.org/food", nutrition,
      identity: { name: "pao integral" },
    });
    const external = vi.fn();
    const result = await readThroughGovernedKnowledge(base, f.store, external);
    expect(result).toMatchObject({ kind: "provisional", persisted: true, origin: "external" });
    expect(external).not.toHaveBeenCalled();
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("persistencia de miss externo so e provisional e depende de gate", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/food", nutrition,
      identity: { name: "pao integral" },
    });
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: false });
    expect(f.stage).toHaveBeenCalledTimes(1);
    expect(external).toHaveBeenCalledTimes(1);
    f.stage.mockResolvedValueOnce(true);
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: true });
  });

  it("AUD-1302-019: refuses generic external macros without an asserted matching food name", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/other-food", nutrition: {
        ...nutrition, caloriesKcal: 800, fatG: 88,
      },
    });
    expect(await readThroughGovernedKnowledge(base, f.store, external)).toEqual({
      kind: "unavailable", reason: "external_evidence_invalid",
    });
    expect(f.stage).not.toHaveBeenCalled();
    // A previously persisted unbound cache entry is rejected at read-through.
    f.pending.mockResolvedValueOnce({
      sourceId: 7, sourceReference: "https://example.org/other-food", nutrition,
    });
    expect(await readThroughGovernedKnowledge(base, f.store, external)).toEqual({
      kind: "unavailable", reason: "external_evidence_invalid",
    });
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("AUD-1302-019: branded and generic name-compatible evidence stays provisional", async () => {
    const f = fixture();
    f.stage.mockResolvedValue(true);
    const result = await readThroughGovernedKnowledge(base, f.store, vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/pao-integral", nutrition,
      identity: { name: "Pão integral" },
    }));
    expect(result).toMatchObject({ kind: "provisional", persisted: true });
  });

  it("AUD-1302-029: name-only food never borrows macros from a specific brand or barcode", async () => {
    const branded = {
      sourceId: 7, sourceReference: "https://example.org/products/panco-pao",
      nutrition, identity: { name: "pao integral", brand: "Panco" },
    };
    const f = fixture();
    const external = vi.fn().mockResolvedValue(branded);
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    expect(f.stage).not.toHaveBeenCalled();
    // Cache candidates use the identical eligibility predicate; an invalid
    // cache hit cannot prevent a new lookup or return commercial macros.
    f.pending.mockResolvedValueOnce(branded);
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    expect(external).toHaveBeenCalledTimes(2);
    expect(f.stage).not.toHaveBeenCalled();
    external.mockResolvedValueOnce({
      ...branded, identity: { name: "pao integral", barcode: "07890000000001" },
    });
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
  });

  it("AUD-1302-029: explicit brand and matching barcode keep compatible sources provisional", async () => {
    const f = fixture();
    f.stage.mockResolvedValue(true);
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/products/panco-pao",
      nutrition, identity: { name: "pao integral", brand: "Panco" },
    });
    expect(await readThroughGovernedKnowledge({ ...base, brand: "Panco" }, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: true });
    external.mockResolvedValueOnce({
      sourceId: 7, sourceReference: "https://example.org/products/panco-pao",
      nutrition, identity: { name: "pao integral", brand: "Panco", barcode: "07890000000001" },
    });
    // A known brand + compatible name remains usable as provisional even if
    // the source additionally supplies a barcode the user did not type.
    expect(await readThroughGovernedKnowledge({ ...base, brand: "Panco" }, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: true });
    external.mockResolvedValueOnce({
      sourceId: 7, sourceReference: "https://example.org/products/panco-pao",
      nutrition, identity: { name: "pao integral", brand: "Panco", barcode: "07890000000001" },
    });
    expect(await readThroughGovernedKnowledge({ ...base, barcode: "07890000000001" }, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: true });
    expect(f.stage).toHaveBeenCalledTimes(3);
  });

  it("nao grava evidencias externas sem titular, mesmo com resultado de rede", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/food", nutrition,
      identity: { name: "pao integral" },
    });
    expect(await readThroughGovernedKnowledge({ ...base, userId: null }, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: false });
    expect(f.pending).not.toHaveBeenCalled();
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("mantem conflito governado explicito e nao consulta cache ou rede", async () => {
    const f = fixture();
    f.local.mockResolvedValueOnce({
      kind: "conflict", reason: "material_nutrition_conflict",
    } as never);
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "conflict", reason: "material_nutrition_conflict" });
    expect(f.pending).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
  });

  it("nao aceita macros inventados, fontes sem URL exata ou identificadores invalidos", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "fonte qualquer",
      nutrition: { ...nutrition, caloriesKcal: -1 },
    });
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    expect(f.stage).not.toHaveBeenCalled();
    expect(await readThroughGovernedKnowledge({ ...base, resolverVersion: "" }, f.store, external))
      .toEqual({ kind: "miss", reason: "invalid_request" });
  });

  it("separa os pedidos por usuario e versao no contrato", async () => {
    const f = fixture();
    f.pending.mockImplementation(async request => request.userId === 41 &&
      request.policyVersion === "governance-v1"
      ? { sourceId: 7, sourceReference: "https://example.org/food", nutrition,
          identity: { name: "pao integral" } }
      : null);
    expect((await readThroughGovernedKnowledge(base, f.store)).kind).toBe("provisional");
    expect((await readThroughGovernedKnowledge({ ...base, userId: 42 }, f.store)).kind).toBe("miss");
    expect((await readThroughGovernedKnowledge({ ...base, policyVersion: "governance-v2" }, f.store)).kind).toBe("miss");
  });

  it("detecta conflito entre evidencias pessoais em cache e nao faz override pela rede", async () => {
    const f = fixture();
    f.pending.mockResolvedValueOnce({ kind: "conflict" });
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "conflict", reason: "material_nutrition_conflict" });
    expect(external).not.toHaveBeenCalled();
  });

  it("trata indisponibilidade do armazenamento como falha visivel, sem fallback oculto", async () => {
    const f = fixture();
    f.local.mockRejectedValueOnce(new Error("db offline"));
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "unavailable", reason: "governed_store_unavailable" });
    expect(external).not.toHaveBeenCalled();
  });

  it("provider indisponivel nao inventa valor nutricional", async () => {
    const f = fixture();
    const external = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "unavailable", reason: "provider_unavailable" });
  });

  it("falha na escrita preserva provisional nao persistido", async () => {
    const f = fixture();
    f.stage.mockRejectedValueOnce(new Error("read only"));
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/food", nutrition,
      identity: { name: "pao integral" },
    });
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: false });
  });
  it("nao repete request externo quando nao existe rede configurada", async () => {
    const f = fixture();
    expect(await readThroughGovernedKnowledge(base, f.store))
      .toEqual({ kind: "miss", reason: "not_found" });
  });

  it("nao converte indisponibilidade em alimento generico", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue(null);
    expect(await readThroughGovernedKnowledge({ ...base, brand: "Marca", barcode: "789" }, f.store, external))
      .toEqual({ kind: "unavailable", reason: "provider_unavailable" });
  });
  it("rejects a mismatched branded external claim instead of substituting generic macros", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/products/other",
      nutrition, identity: { brand: "Wickbold" },
    });
    expect(await readThroughGovernedKnowledge({ ...base, brand: "Panco" }, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("rejects barcode mismatches and identity-free external guesses", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/products/sku-b",
      nutrition, identity: { barcode: "789222" },
    });
    const branded = { ...base, barcode: "789111" };
    expect(await readThroughGovernedKnowledge(branded, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    external.mockResolvedValueOnce({
      sourceId: 7, sourceReference: "https://example.org/products/sku-a", nutrition,
    });
    expect(await readThroughGovernedKnowledge(branded, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("keeps an identity-compatible branded barcode lookup explicitly provisional", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/products/sku-a",
      nutrition, identity: { name: "pao integral", brand: "Panco", barcode: "789111" },
    });
    f.stage.mockResolvedValueOnce(true);
    const result = await readThroughGovernedKnowledge({
      ...base, brand: "Panco", barcode: "789111",
    }, f.store, external);
    expect(result).toMatchObject({ kind: "provisional", origin: "external", persisted: true });
    expect(result.kind).not.toBe("match");
  });

  it("does not replay a cached commercial assertion for a different explicit brand", async () => {
    const f = fixture();
    f.pending.mockResolvedValueOnce({
      sourceId: 7, sourceReference: "https://example.org/products/sku-a",
      nutrition, identity: { brand: "Outra Marca" },
    });
    const external = vi.fn().mockResolvedValue(null);
    expect(await readThroughGovernedKnowledge({ ...base, brand: "Panco" }, f.store, external))
      .toEqual({ kind: "unavailable", reason: "provider_unavailable" });
    expect(external).toHaveBeenCalledTimes(1);
  });


  it("rejects same-brand different-food external claims without barcode, including cache", async () => {
    const f = fixture();
    const input = { ...base, brand: "Panco" };
    const candidate = {
      sourceId: 7, sourceReference: "https://example.org/products/biscuit",
      nutrition, identity: { name: "biscoito recheado", brand: "Panco" },
    };
    const external = vi.fn().mockResolvedValue(candidate);
    expect(await readThroughGovernedKnowledge(input, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    expect(f.stage).not.toHaveBeenCalled();
    f.pending.mockResolvedValueOnce(candidate);
    expect(await readThroughGovernedKnowledge(input, f.store, vi.fn().mockResolvedValue(null)))
      .toEqual({ kind: "unavailable", reason: "provider_unavailable" });
  });

  it("requires a matching product name with explicit brand even when barcode is absent", async () => {
    const f = fixture();
    const input = { ...base, brand: "Panco" };
    const external = vi.fn().mockResolvedValueOnce({
      sourceId: 7, sourceReference: "https://example.org/products/sku-a",
      nutrition, identity: { brand: "Panco" },
    }).mockResolvedValueOnce({
      sourceId: 7, sourceReference: "https://example.org/products/sku-a",
      nutrition, identity: { name: "pao integral", brand: "Panco" },
    });
    expect(await readThroughGovernedKnowledge(input, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    expect(await readThroughGovernedKnowledge(input, f.store, external))
      .toMatchObject({ kind: "provisional", origin: "external" });
  });

  it("rejects an explicitly contradictory name even for a generic candidate", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/products/other",
      nutrition, identity: { name: "biscoito recheado" },
    });
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
  });

  it("rejects an external barcode claim for a different explicit food name", async () => {
    const f = fixture();
    const candidate = {
      sourceId: 7, sourceReference: "https://example.org/products/sku-a", nutrition,
      identity: { name: "leite integral", brand: "Panco", barcode: "789111" },
    };
    const external = vi.fn().mockResolvedValue(candidate);
    const input = { ...base, brand: "Panco", barcode: "789111" };
    expect(await readThroughGovernedKnowledge(input, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
    expect(f.stage).not.toHaveBeenCalled();
    // Cache hits are subject to the same exact input assertion.
    f.pending.mockResolvedValueOnce(candidate);
    expect(await readThroughGovernedKnowledge(input, f.store, vi.fn().mockResolvedValue(null)))
      .toEqual({ kind: "unavailable", reason: "provider_unavailable" });
  });

  it("requires an external name assertion when name and barcode were both supplied", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/products/sku-a", nutrition,
      identity: { barcode: "789111" },
    });
    expect(await readThroughGovernedKnowledge({ ...base, barcode: "789111" }, f.store, external))
      .toEqual({ kind: "unavailable", reason: "external_evidence_invalid" });
  });

});
