import { describe, expect, it } from "vitest";
import { FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION } from "./contracts";
import { buildFoodObservationFixture } from "./fixtures";
import {
  parseFoodMaterialObservationBatch,
  parseFoodObservation,
  type FoodMaterialObservation,
} from "./schemas";

type Evidence = FoodMaterialObservation["evidence"][number];
type Observation = FoodMaterialObservation;

function position(text: string, surface: string, from = 0) {
  const start = text.indexOf(surface, from);
  if (start < 0) throw new Error("Invalid synthetic span");
  return { start, end: start + surface.length };
}

function observation(
  text: string,
  id: string,
  surface: string,
  name: string | null,
  from = 0
): Observation {
  const base = buildFoodObservationFixture();
  return {
    ...base,
    schemaVersion: FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION,
    modality: "text",
    observationId: id,
    rawInput: text,
    normalizedInput: null,
    surfaceSpan: {
      sourceRef: "synthetic:turn",
      span: position(text, surface, from),
      region: null,
    },
    identityHints: { ...base.identityHints, foodName: name },
    quantityHints: {
      value: null,
      unit: null,
      servingText: null,
      visiblePackageQuantity: null,
      visiblePackageUnit: null,
    },
    evidence: [],
    materialClaims: [],
    normalizationPath: [],
    alternatives: [],
    unresolvedReason: name ? null : "unknown_surface",
    interpreterVersion: null,
  };
}

function addEvidence(
  row: Observation,
  field: string,
  value: string | number,
  surface: string,
  unit: string | null = null,
  from = row.surfaceSpan.span!.start,
  ingredientEvidenceId?: string
) {
  const id = row.observationId + "-" + row.evidence.length;
  const evidence: Evidence = {
    evidenceId: id,
    field,
    value,
    unit,
    confidence: null,
    sourceId: null,
    origin: row.modality === "audio_transcript" ? "transcription" : "text",
    verified: false,
    ...(ingredientEvidenceId === undefined ? {} : { ingredientEvidenceId }),
    anchor: {
      ...row.surfaceSpan,
      span: position(row.rawInput!, surface, from),
    },
  };
  row.evidence.push(evidence);
  return id;
}

function ingredient(
  row: Observation,
  units: number,
  literal: string,
  unit = "colher de chá"
) {
  const ingredientEvidenceId = addEvidence(
    row,
    "material.ingredient",
    "açúcar",
    "açúcar"
  );
  row.materialClaims.push({
    kind: "ingredient",
    claimId: row.observationId + "-ingredient",
    binding: { status: "bound", ownerObservationId: row.observationId },
    ingredient: {
      name: "açúcar",
      evidenceId: ingredientEvidenceId,
    },
    amount: {
      value: units,
      unit,
      evidenceId: addEvidence(
        row,
        "material.amount",
        units,
        literal,
        unit,
        undefined,
        ingredientEvidenceId
      ),
    },
  });
}

function siblings() {
  const coffee = "café com uma colher de chá de açúcar";
  const pudding = "um pudim com duas colheres de chá de açúcar";
  const extra = "mais 1 g de açúcar";
  const surface = "☕ " + [coffee, pudding, extra].join(" e ");
  const a = observation(surface, "coffee", coffee, "café");
  const b = observation(surface, "pudding", pudding, "pudim");
  b.quantityHints.value = 1;
  b.quantityHints.unit = "un";
  addEvidence(b, "quantity.value", 1, "um pudim", "un");
  const c = observation(surface, "extra", extra, null);
  ingredient(a, 1, "uma colher de chá");
  ingredient(b, 2, "duas colheres de chá");
  const ingredientEvidenceId = addEvidence(
    c,
    "material.ingredient",
    "açúcar",
    "açúcar"
  );
  c.materialClaims.push({
    kind: "increment",
    claimId: "extra-sugar",
    binding: {
      status: "unresolved",
      reason: "owner_ambiguous",
      candidateObservationIds: ["coffee", "pudding"],
    },
    ingredient: {
      name: "açúcar",
      evidenceId: ingredientEvidenceId,
    },
    operatorEvidenceId: addEvidence(c, "material.increment", "mais", "mais"),
    target: null,
    unresolvedAmount: {
      value: 1,
      unit: "g",
      evidenceId: addEvidence(
        c,
        "material.amount",
        1,
        "1 g",
        "g",
        undefined,
        ingredientEvidenceId
      ),
    },
  });
  return [a, b, c];
}

function increases() {
  const surface = "2 ovos e mais 2 ovos e mais 2 ovos";
  const initial = observation(surface, "initial", "2 ovos", "ovos");
  initial.quantityHints.value = 2;
  initial.quantityHints.unit = "un";
  addEvidence(initial, "quantity.value", 2, "2 ovos", "un");
  const increases = [surface.indexOf("mais"), surface.lastIndexOf("mais")].map(
    (from, index) => {
      const item = observation(
        surface,
        "next-" + index,
        "mais 2 ovos",
        "ovos",
        from
      );
      item.quantityHints.value = 2;
      item.quantityHints.unit = "un";
      item.materialClaims.push({
        kind: "increment",
        claimId: "increment-" + index,
        binding: { status: "bound", ownerObservationId: item.observationId },
        ingredient: null,
        operatorEvidenceId: addEvidence(
          item,
          "material.increment",
          "mais",
          "mais"
        ),
        target: {
          kind: "food_quantity",
          observationId: item.observationId,
          evidenceId: addEvidence(item, "quantity.value", 2, "2 ovos", "un"),
        },
        unresolvedAmount: null,
      });
      return item;
    }
  );
  return [initial, ...increases];
}

describe("FoodObservation: revisão material 3 opt-in", () => {
  it("separa quantidade do alimento, quantidades dos ingredientes e acréscimo sem dono", () => {
    const input = siblings();
    const snapshot = structuredClone(input);
    const result = parseFoodMaterialObservationBatch(input);
    expect(result).toStrictEqual({ ok: true, value: snapshot });
    expect(input).toStrictEqual(snapshot);
    expect(
      parseFoodMaterialObservationBatch([input[2], input[1], input[0]]).ok
    ).toBe(true);
  });

  it("preserva transcrição e negação local sem declarar quantidade zero", () => {
    const raw = "café sem açúcar";
    const item = observation(raw, "speech-1", raw, "café");
    item.modality = "audio_transcript";
    item.materialClaims.push({
      kind: "negation",
      claimId: "neg-1",
      binding: { status: "bound", ownerObservationId: "speech-1" },
      ingredient: {
        name: "açúcar",
        evidenceId: addEvidence(
          item,
          "material.ingredient",
          "açúcar",
          "açúcar"
        ),
      },
      operatorEvidenceId: addEvidence(item, "material.negation", "sem", "sem"),
    });
    expect(parseFoodMaterialObservationBatch([item])).toStrictEqual({
      ok: true,
      value: [item],
    });
    item.evidence[1].origin = "text";
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(false);
  });

  it("aceita medidas repetidas quando cada acréscimo aponta sua ocorrência", () => {
    const input = increases();
    expect(parseFoodMaterialObservationBatch(input).ok).toBe(true);
    const first = input[1].materialClaims[0];
    const second = input[2].materialClaims[0];
    if (first.kind !== "increment" || second.kind !== "increment")
      throw new Error("Invalid fixture");
    second.target = first.target;
    expect(parseFoodMaterialObservationBatch(input).ok).toBe(false);
  });

  it("liga incremento de ingrediente à medida do mesmo dono", () => {
    const raw = "café com mais 1 g de açúcar";
    const item = observation(raw, "coffee", raw, "café");
    const binding = {
      status: "bound",
      ownerObservationId: item.observationId,
    } as const;
    const ingredient = {
      name: "açúcar",
      evidenceId: addEvidence(item, "material.ingredient", "açúcar", "açúcar"),
    };
    item.materialClaims.push(
      {
        kind: "ingredient",
        claimId: "sweetener",
        binding,
        ingredient,
        amount: {
          value: 1,
          unit: "g",
          evidenceId: addEvidence(
            item,
            "material.amount",
            1,
            "1 g",
            "g",
            undefined,
            ingredient.evidenceId
          ),
        },
      },
      {
        kind: "increment",
        claimId: "sweetener-increment",
        binding,
        ingredient,
        operatorEvidenceId: addEvidence(
          item,
          "material.increment",
          "mais",
          "mais"
        ),
        target: { kind: "ingredient_quantity", claimId: "sweetener" },
        unresolvedAmount: null,
      }
    );
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);
    item.materialClaims.reverse();
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);
  });

  it("rejeita cruzar duas quantidades iguais do mesmo ingrediente no mesmo alimento", () => {
    const first = "mais 1 g de açúcar";
    const second = "e 1 g de açúcar";
    const raw = "café com " + first + " " + second;
    const item = observation(raw, "coffee", raw, "café");
    const binding = {
      status: "bound",
      ownerObservationId: item.observationId,
    } as const;
    const measures = [first, second].map((clause, index) => {
      const from = raw.indexOf(clause);
      const ingredientEvidenceId = addEvidence(
        item,
        "material.ingredient",
        "açúcar",
        "açúcar",
        null,
        from
      );
      return {
        kind: "ingredient" as const,
        claimId: "sugar-" + index,
        binding,
        ingredient: {
          name: "açúcar",
          evidenceId: ingredientEvidenceId,
        },
        amount: {
          value: 1,
          unit: "g",
          evidenceId: addEvidence(
            item,
            "material.amount",
            1,
            "1 g",
            "g",
            from,
            ingredientEvidenceId
          ),
        },
      };
    });
    const increase = {
      kind: "increment" as const,
      claimId: "sugar-plus",
      binding,
      ingredient: measures[0].ingredient,
      operatorEvidenceId: addEvidence(
        item,
        "material.increment",
        "mais",
        "mais"
      ),
      target: {
        kind: "ingredient_quantity" as const,
        claimId: measures[0].claimId,
      },
      unresolvedAmount: null,
    };
    item.materialClaims.push(measures[1], increase, measures[0]);
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);

    const originalAmounts = [measures[0].amount, measures[1].amount] as const;
    [measures[0].amount, measures[1].amount] = [
      originalAmounts[1],
      originalAmounts[0],
    ];
    const swapped = structuredClone(item);
    expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
      ok: false,
      code: "invalid-contract",
    });
    expect(item).toStrictEqual(swapped);
    [measures[0].amount, measures[1].amount] = originalAmounts;
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);

    const originalAmountIds = [
      measures[0].amount.evidenceId,
      measures[1].amount.evidenceId,
    ] as const;
    [measures[0].amount.evidenceId, measures[1].amount.evidenceId] = [
      originalAmountIds[1],
      originalAmountIds[0],
    ];
    const crossed = parseFoodMaterialObservationBatch([item]);
    expect(crossed).toMatchObject({
      ok: false,
      code: "invalid-contract",
      issues: [
        expect.objectContaining({
          path: "0.materialClaims.0.amount.evidenceId",
        }),
        expect.objectContaining({
          path: "0.materialClaims.2.amount.evidenceId",
        }),
      ],
    });
    [measures[0].amount.evidenceId, measures[1].amount.evidenceId] =
      originalAmountIds;
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);

    // The later occurrence is equal in name and amount, and also succeeds the
    // operator; it is not the occurrence named by the operator's ingredient.
    increase.target.claimId = measures[1].claimId;
    const snapshot = structuredClone(item);
    expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
      ok: false,
      code: "invalid-contract",
    });
    expect(item).toStrictEqual(snapshot);
    increase.target.claimId = measures[0].claimId;
    const firstAmount = item.evidence.find(
      e => e.evidenceId === measures[0].amount.evidenceId
    )!;
    const secondAmount = item.evidence.find(
      e => e.evidenceId === measures[1].amount.evidenceId
    )!;
    const firstSpan = firstAmount.anchor.span!;
    secondAmount.anchor.span = {
      start: firstSpan.start,
      end: firstSpan.start + 1,
    };
    expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
      ok: false,
      code: "invalid-contract",
      issues: [
        expect.objectContaining({
          message: "Ocorrências de medida material não podem se sobrepor.",
        }),
      ],
    });
  });

  it("separa duas medidas do mesmo item e rejeita reusar o span do ingrediente como medida do todo", () => {
    const raw = "100 ml de café com 1 g de açúcar";
    const item = observation(raw, "coffee", raw, "café");
    item.quantityHints.value = 100;
    item.quantityHints.unit = "ml";
    addEvidence(item, "quantity.value", 100, "100 ml", "ml");
    const ingredientEvidenceId = addEvidence(
      item,
      "material.ingredient",
      "açúcar",
      "açúcar"
    );
    item.materialClaims.push({
      kind: "ingredient",
      claimId: "sugar",
      binding: { status: "bound", ownerObservationId: item.observationId },
      ingredient: {
        name: "açúcar",
        evidenceId: ingredientEvidenceId,
      },
      amount: {
        value: 1,
        unit: "g",
        evidenceId: addEvidence(
          item,
          "material.amount",
          1,
          "1 g",
          "g",
          undefined,
          ingredientEvidenceId
        ),
      },
    });
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);

    item.quantityHints.value = 1;
    item.quantityHints.unit = "g";
    item.evidence[0] = {
      ...item.evidence[0],
      value: 1,
      unit: "g",
      anchor: { ...item.evidence[0].anchor, span: position(raw, "1 g") },
    };
    expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
      ok: false,
      code: "invalid-contract",
    });
    const materialStart = position(raw, "1 g").start;
    item.evidence[0].anchor.span = {
      start: materialStart,
      end: materialStart + 1,
    };
    expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
      ok: false,
      code: "invalid-contract",
      issues: [
        expect.objectContaining({
          message:
            "Medida material não pode sobrepor a quantidade do alimento.",
        }),
      ],
    });

    // A source span ending exactly where the material quantity starts is distinct.
    item.evidence[0] = {
      ...item.evidence[0],
      value: 100,
      unit: "ml",
      anchor: {
        ...item.evidence[0].anchor,
        span: { start: 0, end: materialStart },
      },
    };
    item.quantityHints.value = 100;
    item.quantityHints.unit = "ml";
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);

    // Independent sources may reuse offsets; this is not attribution across
    // sources. Candidate/claim links must still resolve in the same source.
    const other = observation(raw, "coffee-other-source", raw, "café");
    other.surfaceSpan.sourceRef = "synthetic:independent-source";
    other.quantityHints.value = 1;
    other.quantityHints.unit = "g";
    addEvidence(other, "quantity.value", 1, "1 g", "g");
    expect(parseFoodMaterialObservationBatch([other, item]).ok).toBe(true);
  });

  it("exige âncora local da quantidade do item, mesmo sem vínculos materiais", () => {
    const simple = observation("1 g de café", "coffee", "1 g de café", "café");
    simple.quantityHints.value = 1;
    simple.quantityHints.unit = "g";
    const sweetCoffee = "café com 1 g de açúcar";
    const unrelated = observation(
      sweetCoffee,
      "sweet-coffee",
      sweetCoffee,
      "café"
    );
    unrelated.surfaceSpan.sourceRef = "synthetic:independent";
    ingredient(unrelated, 1, "1 g", "g");
    unrelated.quantityHints.value = 1;
    unrelated.quantityHints.unit = "g";
    for (const item of [simple, unrelated]) {
      expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
        ok: false,
        code: "invalid-contract",
        issues: [expect.objectContaining({ path: "0.quantityHints" })],
      });
    }
    addEvidence(simple, "quantity.value", 1, "1 g", "g");
    expect(parseFoodMaterialObservationBatch([simple]).ok).toBe(true);
    simple.evidence[0].anchor.sourceRef = "synthetic:other";
    expect(parseFoodMaterialObservationBatch([simple]).ok).toBe(false);
    simple.evidence[0].anchor.sourceRef = simple.surfaceSpan.sourceRef;
    simple.evidence[0].unit = "ml";
    expect(parseFoodMaterialObservationBatch([simple]).ok).toBe(false);
  });

  it("impede que um incremento pendente empreste medida anterior ou de outro ingrediente", () => {
    const raw = "1 g de açúcar e mais 1 g de cacau";
    const item = observation(raw, "extra", raw, null);
    const ingredientId = addEvidence(
      item,
      "material.ingredient",
      "cacau",
      "cacau"
    );
    const operatorEvidenceId = addEvidence(
      item,
      "material.increment",
      "mais",
      "mais"
    );
    const amountId = addEvidence(
      item,
      "material.amount",
      1,
      "1 g",
      "g",
      raw.indexOf("mais"),
      ingredientId
    );
    item.materialClaims.push({
      kind: "increment",
      claimId: "cocoa-extra",
      binding: {
        status: "unresolved",
        reason: "owner_unknown",
        candidateObservationIds: [],
      },
      ingredient: { name: "cacau", evidenceId: ingredientId },
      operatorEvidenceId,
      target: null,
      unresolvedAmount: { value: 1, unit: "g", evidenceId: amountId },
    });
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);

    const evidence = item.evidence.at(-1)!;
    const laterAmount = evidence.anchor.span;
    evidence.anchor.span = position(raw, "1 g");
    expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
      ok: false,
      code: "invalid-contract",
    });

    evidence.anchor.span = laterAmount;
    delete evidence.ingredientEvidenceId;
    expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
      ok: false,
      code: "invalid-contract",
    });

    evidence.ingredientEvidenceId = "different-ingredient-occurrence";
    expect(parseFoodMaterialObservationBatch([item])).toMatchObject({
      ok: false,
      code: "invalid-contract",
      issues: [
        expect.objectContaining({
          message: expect.stringContaining("sua ocorrência de ingrediente"),
        }),
      ],
    });
    evidence.ingredientEvidenceId = ingredientId;
    expect(parseFoodMaterialObservationBatch([item]).ok).toBe(true);
  });

  it("limita revisão 3 de todo o lote a texto/transcrição, inclusive sem claims", () => {
    const input = observation("café", "coffee", "café", "café");
    expect(parseFoodMaterialObservationBatch([input]).ok).toBe(true);
    expect(
      parseFoodMaterialObservationBatch([
        { ...input, modality: "audio_transcript" },
      ]).ok
    ).toBe(true);
    for (const modality of ["image", "multimodal"]) {
      expect(
        parseFoodMaterialObservationBatch([{ ...input, modality }])
      ).toMatchObject({ ok: false, code: "invalid-contract" });
      const v2 = buildFoodObservationFixture({ modality });
      expect(parseFoodObservation(v2).ok).toBe(true);
    }
  });

  it("não atribui candidato de outra fonte mesmo quando o texto e os offsets coincidem", () => {
    const input = siblings();
    input[0].surfaceSpan.sourceRef = "synthetic:independent-source";
    for (const evidence of input[0].evidence)
      evidence.anchor.sourceRef = input[0].surfaceSpan.sourceRef;
    expect(parseFoodMaterialObservationBatch(input)).toMatchObject({
      ok: false,
      code: "invalid-contract",
      issues: [
        expect.objectContaining({
          message: "Candidato não identifica alimento na mesma fonte do lote.",
        }),
      ],
    });
  });

  it("conserva acréscimo sem medida ou dono como pendência", () => {
    const raw = "mais açúcar";
    const item = observation(raw, "extra", raw, null);
    item.materialClaims.push({
      kind: "increment",
      claimId: "unsized-sweetener",
      binding: {
        status: "unresolved",
        reason: "owner_unknown",
        candidateObservationIds: [],
      },
      ingredient: {
        name: "açúcar",
        evidenceId: addEvidence(
          item,
          "material.ingredient",
          "açúcar",
          "açúcar"
        ),
      },
      operatorEvidenceId: addEvidence(
        item,
        "material.increment",
        "mais",
        "mais"
      ),
      target: null,
      unresolvedAmount: null,
    });
    expect(parseFoodMaterialObservationBatch([item])).toStrictEqual({
      ok: true,
      value: [item],
    });
  });

  it.each([
    [
      "dono trocado",
      (rows: Observation[]) => {
        rows[0].materialClaims[0].binding = {
          status: "bound",
          ownerObservationId: "pudding",
        };
      },
    ],
    [
      "candidato ausente",
      (rows: Observation[]) => {
        rows[2].materialClaims[0].binding = {
          status: "unresolved",
          reason: "owner_ambiguous",
          candidateObservationIds: ["coffee", "missing"],
        };
      },
    ],
    [
      "dono inventado na pendência",
      (rows: Observation[]) => {
        rows[2].identityHints.foodName = "pudim";
      },
    ],
    [
      "quantidade modificada",
      (rows: Observation[]) => {
        const c = rows[0].materialClaims[0];
        if (c.kind === "ingredient" && c.amount) c.amount.value = 2;
      },
    ],
    [
      "fonte divergente",
      (rows: Observation[]) => {
        rows[0].evidence[1].anchor.sourceRef = "synthetic:wrong";
      },
    ],
    [
      "span cobre trecho de outro item",
      (rows: Observation[]) => {
        rows[0].evidence[1].anchor.span = rows[1].evidence[1].anchor.span;
      },
    ],
    [
      "IDs de ocorrência reaproveitados",
      (rows: Observation[]) => {
        rows[1].materialClaims[0].claimId = rows[0].materialClaims[0].claimId;
      },
    ],
    [
      "evidência material ficou órfã",
      (rows: Observation[]) => {
        rows[0].materialClaims = [];
      },
    ],
    [
      "texto original não corresponde à evidência",
      (rows: Observation[]) => {
        const c = rows[0].materialClaims[0];
        if (c.kind === "ingredient") c.ingredient.name = "sal";
        rows[0].evidence[0].value = "sal";
      },
    ],
    [
      "quantidade de ingrediente disfarçada de medida do item",
      (rows: Observation[]) => {
        rows[0].evidence[1].field = "quantity.value";
      },
    ],
  ] as const)("rejeita %s sem mutação", (_label, mutate) => {
    const input = siblings();
    mutate(input);
    const snapshot = structuredClone(input);
    expect(parseFoodMaterialObservationBatch(input)).toMatchObject({
      ok: false,
      code: "invalid-contract",
    });
    expect(input).toStrictEqual(snapshot);
  });

  it("não amplia o parser V2 nem converte lote misto ou versão futura", () => {
    const v2 = buildFoodObservationFixture();
    const v3 = siblings()[0];
    expect(parseFoodObservation(v2).ok).toBe(true);
    expect(parseFoodObservation(v3)).toMatchObject({
      ok: false,
      code: "unsupported-schema-version",
    });
    expect(parseFoodObservation({ ...v2, materialClaims: [] }).ok).toBe(false);
    expect(parseFoodMaterialObservationBatch([v3, v2])).toMatchObject({
      ok: false,
      code: "unsupported-schema-version",
    });
    expect(
      parseFoodMaterialObservationBatch([{ ...v3, schemaVersion: 4 }])
    ).toMatchObject({ ok: false, code: "unsupported-schema-version" });
    const { materialClaims: _omitted, ...incomplete } = v3;
    expect(parseFoodMaterialObservationBatch([incomplete]).ok).toBe(false);
  });
});
