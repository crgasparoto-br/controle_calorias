import { describe, expect, it, vi } from "vitest";
import { c1bCases } from "./corpus/semanticConservation1341.test.fixture";
import { foldLabelledFoodName } from "./corpus/semanticConservation1341.evidence.fixture";
import {
  comprehendFoodLanguage,
  comprehendFoodMaterialLanguage,
  type LinguisticLexiconStore,
  type LinguisticRequest,
} from "./linguisticComprehension";
import {
  parseFoodMaterialObservationBatch,
  parseFoodObservation,
  type FoodMaterialObservation,
} from "./schemas";

const lexicon: LinguisticLexiconStore = { load: async () => [] };

function request(
  rawText: string,
  modality: LinguisticRequest["modality"] = "text"
): LinguisticRequest {
  return {
    rawText,
    sourceRef: "synthetic:material:" + modality,
    modality,
    ownerUserId: null,
    lexiconRevision: "synthetic-empty",
    now: new Date("2026-11-24T00:00:00.000Z"),
  };
}

async function observe(input: LinguisticRequest) {
  const result = await comprehendFoodMaterialLanguage(input, lexicon);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("Expected a supported explicit binding");
  const observations: FoodMaterialObservation[] = result.observations;
  expect(parseFoodMaterialObservationBatch(observations).ok).toBe(true);
  return observations;
}

const acceptedCalibration = [
  "sugar-gram-other-food",
  "sugar-gram-reversed",
] as const;
const frozenIngredientCases = c1bCases.filter(entry =>
  entry.split === "holdout" && entry.facts.length > 0 &&
  entry.facts.every(fact => fact.kind === "ingredient-quantity"));

describe("produtor interno C1/S1 de vínculos materiais", () => {
  it.each([
    ...acceptedCalibration.map(id => [id, "calibration"] as const),
    ...frozenIngredientCases.map(entry => [entry.id, "holdout"] as const),
  ])(
    "preserva as ocorrências independentes da referência congelada %s",
    async (id, split) => {
      const expected = c1bCases.find(entry => entry.id === id);
      if (!expected || expected.split !== split) {
        throw new Error("Frozen reference not found: " + id);
      }
      const input = request(expected.text, expected.modality);
      const observations = await observe(input);
      const facts = expected.facts.filter(
        fact => fact.kind === "ingredient-quantity"
      );
      expect(observations).toHaveLength(facts.length);
      const actual = observations.flatMap(owner =>
        owner.materialClaims.map(claim => ({ owner, claim }))
      );
      expect(actual).toHaveLength(facts.length);

      for (const fact of facts) {
        const match = actual.find(
          row => fact.owner !== null &&
            row.owner.identityHints.foodName === foldLabelledFoodName(fact.owner)
        );
        expect(
          match,
          "Missing independently labelled owner: " + fact.owner
        ).toBeDefined();
        if (
          !match ||
          match.claim.kind !== "ingredient" ||
          !match.claim.amount ||
          !fact.ingredient
        ) {
          throw new Error(
            "Expected an explicit quantity with an exact ingredient occurrence"
          );
        }
        const { owner, claim } = match;
        expect(claim.binding).toEqual({
          status: "bound",
          ownerObservationId: owner.observationId,
        });
        // This frozen slice labels a single-word ingredient at the end of
        // each annotated surface. Its transcript spelling is source evidence,
        // not the normalized spelling of the reference ingredient.
        const literal = fact.surface.match(/\S+$/u)?.[0];
        if (!literal) throw new Error("Missing literal ingredient occurrence");
        expect(foldLabelledFoodName(literal)).toBe(foldLabelledFoodName(fact.ingredient));
        expect(claim.ingredient.name).toBe(literal);
        expect(claim.amount).toMatchObject({
          value: fact.quantity,
          unit: fact.unit,
        });
        const ingredient = owner.evidence.find(
          ev => ev.evidenceId === claim.ingredient.evidenceId
        );
        const measure = owner.evidence.find(
          ev => ev.evidenceId === claim.amount!.evidenceId
        );
        expect(measure).toMatchObject({
          field: "material.amount",
          ingredientEvidenceId: claim.ingredient.evidenceId,
          value: fact.quantity,
          unit: fact.unit,
          anchor: { sourceRef: input.sourceRef },
        });
        expect(ingredient).toMatchObject({
          field: "material.ingredient",
          value: literal,
          anchor: { sourceRef: input.sourceRef },
        });
        const scopeStart = fact.scopeStart ?? input.rawText.indexOf(fact.scope);
        const mentionStart =
          fact.surfaceStart ?? input.rawText.indexOf(fact.surface, scopeStart);
        const ingredientStart = input.rawText.indexOf(
          literal,
          mentionStart
        );
        expect(ingredient?.anchor.span).toEqual({
          start: ingredientStart,
          end: ingredientStart + literal.length,
        });
        expect(measure?.anchor.span?.start).toBe(mentionStart);
        expect(measure!.anchor.span!.end).toBeLessThanOrEqual(ingredientStart);
        expect(ingredientStart + literal.length).toBeLessThanOrEqual(
          scopeStart + fact.scope.length
        );
      }
    }
  );

  it("separa a porção do dono da medida do ingrediente na fonte da transcrição", async () => {
    const raw = "um chá com 10 ml de leite";
    const input = request(raw, "audio_transcript");
    const [item] = await observe(input);
    expect(item.identityHints.foodName).toBe("cha");
    expect(item.quantityHints).toMatchObject({ value: 1, unit: "un" });
    expect(item.materialClaims).toHaveLength(1);
    expect(item.materialClaims[0]).toMatchObject({
      kind: "ingredient",
      binding: { status: "bound", ownerObservationId: item.observationId },
      ingredient: { name: "leite" },
      amount: { value: 10, unit: "ml" },
    });
    const evidence = item.evidence.find(ev => ev.field === "material.amount");
    expect(evidence).toMatchObject({
      origin: "transcription",
      unit: "ml",
      anchor: { sourceRef: input.sourceRef },
    });
    expect(evidence).not.toHaveProperty("grams");
    expect(item.schemaVersion).toBe(3);
  });

  it("não aprova uma continuação sem dono nem escala a interpretação", async () => {
    const input = request("chá com 10 ml de leite e mais leite");
    const shouldInterpretResidual = vi.fn(() => true);
    const result = await comprehendFoodMaterialLanguage(
      {
        ...input,
        shouldInterpretResidual,
      },
      lexicon
    );
    expect(result).toMatchObject({ ok: false, reason: "unproven-material" });
    if (result.ok || result.reason !== "unproven-material") throw new Error("Expected unproven continuation");
    expect(result.affected).toHaveLength(1);
    const span = result.affected[0].surfaceSpan.span!;
    expect(input.rawText.slice(span.start, span.end)).toBe("mais leite");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].materialClaims[0]).toMatchObject({
      amount: { value: 10, unit: "ml" },
    });
    expect(shouldInterpretResidual).not.toHaveBeenCalled();
  });

  it("mantém a entrada tradicional na revisão 2 sem vínculos materiais", async () => {
    const input = request("um chá com 10 ml de leite");
    const observations = await comprehendFoodLanguage(input, lexicon);
    expect(observations.length).toBeGreaterThan(0);
    for (const value of observations) {
      expect(value.schemaVersion).toBe(2);
      expect(value).not.toHaveProperty("materialClaims");
      expect(parseFoodObservation(value).ok).toBe(true);
    }
  });

  it("mantém duas medidas iguais vinculadas apenas às respectivas ocorrências", async () => {
    const observed = await observe(request("chá com 2 g de açúcar; café com 2 g de açúcar"));
    expect(observed.map(row => row.identityHints.foodName)).toEqual(["cha", "cafe"]);
    const amounts = observed.map(row => row.evidence.find(e => e.field === "material.amount"));
    expect(amounts.map(e => e?.value)).toEqual([2, 2]);
    expect(new Set(amounts.map(e => e?.anchor.span?.start)).size).toBe(2);
    expect(new Set(amounts.map(e => e?.evidenceId)).size).toBe(2);
  });

  it("não inventa unidade ou reclassifica um irmão ambíguo como comida separada", async () => {
    const implicit = await comprehendFoodMaterialLanguage(request("chá com 2 limões"), lexicon);
    expect(implicit).toMatchObject({ ok: false, reason: "unproven-material", observations: [] });
    const sibling = await comprehendFoodMaterialLanguage(
      request("chá com 2 g de açúcar e leite; 1 banana"), lexicon
    );
    expect(sibling).toMatchObject({ ok: false, reason: "unproven-material" });
    if (sibling.ok || sibling.reason !== "unproven-material") throw new Error("Expected ambiguous sibling");
    expect(sibling.affected).toHaveLength(1);
    expect(sibling.observations.map(row => row.identityHints.foodName)).toEqual(["cha", "banana"]);
  });

  it.each(c1bCases.filter(row => row.split === "holdout" && row.facts.some(fact => fact.kind === "unbound")))(
    "preserva os irmãos e o span da pendência na referência $id",
    async expected => {
      const result = await comprehendFoodMaterialLanguage(request(expected.text, expected.modality), lexicon);
      if (result.ok || result.reason !== "unproven-material") throw new Error("Expected frozen case to abstain");
      const scopes = result.affected.map(item => {
        const span = item.surfaceSpan.span!;
        return expected.text.slice(span.start, span.end);
      });
      expect(scopes).toEqual(expected.facts.filter(fact => fact.kind === "unbound").map(fact => fact.scope));
      const bindings = result.observations.flatMap(item => item.materialClaims.map(claim =>
        claim.kind === "ingredient" && claim.amount
          ? { owner: item.identityHints.foodName, value: claim.amount.value, unit: claim.amount.unit } : null));
      expect(bindings).toEqual(expected.facts.filter(fact => fact.kind === "ingredient-quantity").map(fact => ({
        owner: foldLabelledFoodName(fact.owner!), value: fact.quantity, unit: fact.unit,
      })));
    }
  );
});
