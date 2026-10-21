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
    });
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: false });
    expect(f.stage).toHaveBeenCalledTimes(1);
    expect(external).toHaveBeenCalledTimes(1);
    f.stage.mockResolvedValueOnce(true);
    expect(await readThroughGovernedKnowledge(base, f.store, external))
      .toMatchObject({ kind: "provisional", persisted: true });
  });

  it("nao grava evidencias externas sem titular, mesmo com resultado de rede", async () => {
    const f = fixture();
    const external = vi.fn().mockResolvedValue({
      sourceId: 7, sourceReference: "https://example.org/food", nutrition,
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
      ? { sourceId: 7, sourceReference: "https://example.org/food", nutrition }
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
});
