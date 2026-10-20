import { describe, expect, it } from "vitest";
import {
  V1_FIELDS_NOT_SUPPLIED,
  V1_SEMANTIC_CONTRACT_IS_POST_RESOLUTION,
  isV1MealSemanticContract,
  projectDecisionV2ToV1,
  readHistoricalV1MealSnapshot,
  toV1EvidenceOrigin,
  v1SemanticContractToFoodObservations,
} from "./adapters";
import { parseFoodResolutionDecision } from "./schemas";
import {
  buildFoodResolutionDecisionFixture,
  buildV1HistoricalSnapshotFixture,
  buildV1MealSemanticContractFixture,
} from "./fixtures";

function project(overrides: unknown = {}) {
  const result = parseFoodResolutionDecision(
    buildFoodResolutionDecisionFixture(overrides)
  );
  if (!result.ok) {
    throw new Error(
      `fixture inválida: ${result.issues.map(issue => issue.message).join(" | ")}`
    );
  }
  return projectDecisionV2ToV1(result.value);
}

function blockerCodes(projection: ReturnType<typeof projectDecisionV2ToV1>) {
  return projection.blockers.map(blocker => blocker.code);
}

describe("projeção V2 → DTO V1", () => {
  it("bloqueia decisão resolvida quando o DTO V1 não fornece campos obrigatórios", () => {
    const projection = project();

    expect(projection.faithful).toBe(false);
    expect(blockerCodes(projection)).toContain("v1-required-fields-not-supplied");
    expect(projection.item).toBeNull();
    expect(projection.resolution).toBeNull();
    expect(projection.missingV1Fields).toStrictEqual([
      ...V1_FIELDS_NOT_SUPPLIED,
    ]);
  });

  it("nunca confunde foodEntityId com foodCatalogId", () => {
    const projection = project();

    expect(projection.item).toBeNull();
    expect(Object.keys(projection).join(" ")).not.toContain("foodCatalogId");
  });

  it("preserva origem distinta para texto e transcrição equivalentes", () => {
    const fromText = project();
    const fromTranscription = project({
      evidence: [
        {
          evidenceId: "ev-ident",
          origin: "transcription",
          value: "Mortadela",
        },
      ],
    });

    expect(fromText.evidenceOrigins.identity).toBe("text");
    expect(fromTranscription.evidenceOrigins.identity).toBe("transcription");
    expect(fromText.evidenceOrigins.identity).not.toBe(
      fromTranscription.evidenceOrigins.identity
    );
  });

  it("não colapsa origem ausente no vocabulário V1 e bloqueia a projeção", () => {
    const projection = project({
      identity: { barcode: "7891000315507", evidenceIds: ["ev-barcode"] },
      evidence: [
        {
          evidenceId: "ev-barcode",
          field: "identity.barcode",
          origin: "barcode",
          value: "7891000315507",
          unit: null,
          verified: true,
        },
      ],
    });

    expect(blockerCodes(projection)).toContain(
      "evidence-origin-not-representable"
    );
    expect(projection.faithful).toBe(false);
    expect(toV1EvidenceOrigin("barcode")).toBeNull();
    expect(Object.values(projection.evidenceOrigins)).not.toContain(
      "unavailable"
    );
  });

  it("preserva provisoriedade sem converter em verified", () => {
    const projection = project({
      nutrition: { verified: false, provisional: true },
    });

    expect(projection.resolution).toBeNull();
    expect(projection.item).toBeNull();
    expect(projection.faithful).toBe(false);
    expect(blockerCodes(projection)).toContain("v1-required-fields-not-supplied");
  });

  it("não projeta base ml em gramas e explica o bloqueio", () => {
    const projection = project({
      quantity: {
        value: 240,
        unit: "ml",
        grams: null,
        milliliters: 240,
        evidenceIds: [],
      },
      nutrition: { basis: { unit: "ml" } },
      identity: { evidenceIds: [] },
    });

    expect(blockerCodes(projection)).toContain(
      "physical-basis-not-representable"
    );
    expect(projection.item).toBeNull();
    expect(projection.faithful).toBe(false);
  });

  it("nunca projeta nutrição ausente como zeros", () => {
    const resolved = project();
    expect(blockerCodes(resolved)).not.toContain("nutrition-absent-not-zero");

    const unresolved = project({
      status: "partially_resolved",
      nextAction: "clarify",
      reasonCodes: ["provider_unavailable"],
      unresolvedFields: ["nutrition"],
      nutrition: {
        verified: false,
        provisional: false,
        basis: null,
        consumed: null,
        evidenceIds: [],
      },
    });

    expect(blockerCodes(unresolved)).toContain("nutrition-absent-not-zero");
    expect(blockerCodes(unresolved)).toContain("decision-not-resolved");
    expect(unresolved.item).toBeNull();
  });

  it("bloqueia decisão não resolvida sem inventar item", () => {
    const projection = project({
      status: "partially_resolved",
      nextAction: "clarify",
      reasonCodes: ["quantity_conversion_unproven"],
      unresolvedFields: ["quantity"],
    });

    expect(blockerCodes(projection)).toContain("decision-not-resolved");
    expect(projection.item).toBeNull();
    expect(projection.resolution).toBeNull();
  });

  it("expõe classificação provisória sem inventar fiberGrams do DTO V1", () => {
    const projection = project({
      classification: {
        version: "cls-1",
        processingLevel: "ultra_processed",
        isFruit: false,
        isVegetable: false,
        isUltraProcessed: true,
        confidence: 0.7,
        provisional: true,
        evidenceIds: [],
      },
    });

    expect(blockerCodes(projection)).toContain(
      "classification-not-representable"
    );
    expect(projection.classification).toBeNull();
    expect(projection.classificationProvisional).toMatchObject({
      processingLevel: "ultra_processed",
      isUltraProcessed: true,
    });
  });

  it("não muta a decisão validada", () => {
    const decision = buildFoodResolutionDecisionFixture();
    const snapshot = structuredClone(decision);

    projectDecisionV2ToV1(decision);

    expect(decision).toStrictEqual(snapshot);
  });
});

describe("invariante do MealSemanticContract V1", () => {
  it("nunca converte contrato V1 pós-resolução em observação", () => {
    const contract = buildV1MealSemanticContractFixture();

    const result = v1SemanticContractToFoodObservations(contract);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(V1_SEMANTIC_CONTRACT_IS_POST_RESOLUTION);
    expect(result.detail).toContain("não pode ser convertido");
  });

  it("identifica contrato V1 pela versão declarada", () => {
    expect(isV1MealSemanticContract(buildV1MealSemanticContractFixture())).toBe(
      true
    );
    expect(isV1MealSemanticContract({ version: 2 })).toBe(false);
    expect(isV1MealSemanticContract(null)).toBe(false);
  });
});

describe("snapshot histórico V1", () => {
  it("lê pela versão conhecida sem reinferência e sem recálculo de macros", () => {
    const snapshot = buildV1HistoricalSnapshotFixture();
    const totals = structuredClone(snapshot.totals);

    const result = readHistoricalV1MealSnapshot(snapshot);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("esperado leitura válida");
    expect(result.contractVersion).toBe(1);
    expect(result.reinferenceApplied).toBe(false);
    expect(result.macrosRecalculated).toBe(false);
    // Mesma referência: prova de que nada foi clonado, normalizado ou reescrito.
    expect(result.snapshot).toBe(snapshot);
    expect(snapshot.totals).toStrictEqual(totals);
  });

  it("aceita histórico sem contrato semântico registrado", () => {
    const result = readHistoricalV1MealSnapshot(
      buildV1HistoricalSnapshotFixture({ semanticContract: null })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("esperado leitura válida");
    expect(result.contractVersion).toBe("absent");
  });

  it("recusa versão desconhecida sem migração implícita", () => {
    const result = readHistoricalV1MealSnapshot(
      buildV1HistoricalSnapshotFixture({ semanticContract: { version: 2 } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperado recusa");
    expect(result.reason).toBe("unsupported-schema-version");
  });

  it("recusa snapshot ilegível", () => {
    for (const invalid of [null, "texto", { items: "não é lista" }]) {
      const result = readHistoricalV1MealSnapshot(invalid);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("esperado recusa");
      expect(result.reason).toBe("invalid-snapshot");
    }
  });

  it("recusa snapshot V1 com item ou totais malformados", () => {
    const result = readHistoricalV1MealSnapshot({
      ...buildV1HistoricalSnapshotFixture(),
      items: [null],
      totals: "bad",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperada recusa");
    expect(result.reason).toBe("invalid-snapshot");
  });
});
