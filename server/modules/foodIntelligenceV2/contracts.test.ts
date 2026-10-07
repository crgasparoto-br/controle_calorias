import { describe, expect, it } from "vitest";
import {
  FOOD_DECISION_NEXT_ACTIONS,
  FOOD_DECISION_STATUSES,
  FOOD_STATUS_ALLOWED_ACTIONS,
} from "./contracts";
import {
  parseFoodObservation,
  parseFoodOperationEnvelope,
  parseFoodResolutionDecision,
} from "./schemas";
import {
  buildFoodAnchorFixture,
  buildFoodObservationFixture,
  buildFoodOperationEnvelopeFixture,
  buildFoodResolutionDecisionFixture,
  buildFoodAlternativeFixture,
} from "./fixtures";

function expectInvalid(result: { ok: boolean; code?: string }) {
  expect(result.ok).toBe(false);
  expect(result.code).toBe("invalid-contract");
}

describe("FoodObservation v2", () => {
  it("aceita observação válida e preserva a entrada sem mutação", () => {
    const input = buildFoodObservationFixture();
    const snapshot = structuredClone(input);

    const result = parseFoodObservation(input);

    expect(result.ok).toBe(true);
    expect(input).toStrictEqual(snapshot);
  });

  it("rejeita versão desconhecida antes de qualquer mutação", () => {
    for (const schemaVersion of [1, 3]) {
      const input = buildFoodObservationFixture({ schemaVersion });
      const snapshot = structuredClone(input);

      const result = parseFoodObservation(input);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("esperado rejeição");
      expect(result.code).toBe("unsupported-schema-version");
      expect(input).toStrictEqual(snapshot);
    }
  });

  it("rejeita campo arbitrário de provider sem mutar a entrada", () => {
    const input = buildFoodObservationFixture({
      providerPayload: { raw: "payload arbitrário" },
    });
    const snapshot = structuredClone(input);

    const result = parseFoodObservation(input);

    expectInvalid(result);
    expect(input).toStrictEqual(snapshot);
  });

  it("rejeita números não finitos e confiança fora de 0..1", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          quantityHints: { value: Number.POSITIVE_INFINITY, unit: "fatia" },
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          evidence: [{ evidenceId: "ev-ident", confidence: 1.4 }],
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          evidence: [{ evidenceId: "ev-ident", confidence: -0.1 }],
        })
      )
    );
  });

  it("rejeita IDs de banco não positivos ou não inteiros", () => {
    for (const sourceId of [0, -3, 1.5]) {
      expectInvalid(
        parseFoodObservation(
          buildFoodObservationFixture({
            evidence: [{ evidenceId: "ev-ident", sourceId }],
          })
        )
      );
    }
  });

  it("rejeita coleções vazias obrigatórias, ids vazios e duplicados", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({ observationId: "   " })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          evidence: [{ evidenceId: "ev-ident" }, { evidenceId: "ev-ident" }],
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          alternatives: [
            {
              hypothesisId: "h1",
              evidenceIds: ["ev-inexistente"],
            },
          ],
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          lexiconRevision: "",
        })
      )
    );
  });

  it("valida âncoras: span [start,end) e região normalizada 0..1", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          surfaceSpan: { span: { start: 10, end: 10 } },
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          surfaceSpan: {
            span: null,
            region: { x: 0.5, y: 0.5, width: 0.8, height: 0.2 },
          },
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          surfaceSpan: {
            span: null,
            region: { x: 0, y: 0, width: 0, height: 1 },
          },
        })
      )
    );

    const mediaAnchor = parseFoodObservation(
      buildFoodObservationFixture({
        modality: "image",
        surfaceSpan: {
          span: null,
          region: { x: 0.1, y: 0.1, width: 0.4, height: 0.3 },
        },
      })
    );
    expect(mediaAnchor.ok).toBe(true);
  });

  it("rejeita região em observação textual (registro de superfície desconhecida)", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          surfaceSpan: { region: { x: 0.1, y: 0.1, width: 0.4, height: 0.3 } },
        })
      )
    );
  });

  it("aplica as regras de locale de §4.2 sem fallback silencioso", () => {
    // Locale ausente usa pt-BR com status=defaulted.
    expect(
      parseFoodObservation(
        buildFoodObservationFixture({
          locale: { requested: null, effective: "pt-BR", status: "defaulted" },
        })
      ).ok
    ).toBe(true);

    // Explícito suportado exige requested.
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          locale: { requested: null, effective: "pt-BR", status: "explicit" },
        })
      )
    );

    // defaulted não aceita locale explícito.
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          locale: {
            requested: "pt-BR",
            effective: "pt-BR",
            status: "defaulted",
          },
        })
      )
    );

    // Locale explícito fora do recorte não pode cair silenciosamente em pt-BR.
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          locale: {
            requested: "en-US",
            effective: "pt-BR",
            status: "explicit",
          },
        })
      )
    );

    // Locale não suportado usa effective=null e razão unsupported_locale.
    const unsupportedOk = parseFoodObservation(
      buildFoodObservationFixture({
        locale: { requested: "en-US", effective: null, status: "unsupported" },
        unresolvedReason: "unsupported_locale",
      })
    );
    expect(unsupportedOk.ok).toBe(true);

    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          locale: {
            requested: "en-US",
            effective: "pt-BR",
            status: "unsupported",
          },
          unresolvedReason: "unsupported_locale",
        })
      )
    );

    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          locale: {
            requested: "en-US",
            effective: null,
            status: "unsupported",
          },
          unresolvedReason: null,
        })
      )
    );
  });

  it("exige unidade explícita quando há valor observado e preserva termos incertos", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          quantityHints: { value: 2, unit: null },
        })
      )
    );

    // Termo incerto permanece rastreável como texto, sem virar quantidade exata.
    const vague = parseFoodObservation(
      buildFoodObservationFixture({
        quantityHints: {
          value: null,
          unit: null,
          servingText: "um punhado",
        },
      })
    );
    expect(vague.ok).toBe(true);
  });

  it("não aceita verified por confiança autodeclarada da IA", () => {
    for (const origin of [
      "ai_estimate",
      "heuristic",
      "provisional_estimate",
      "unavailable",
    ]) {
      expectInvalid(
        parseFoodObservation(
          buildFoodObservationFixture({
            evidence: [{ evidenceId: "ev-ident", origin, verified: true }],
          })
        )
      );
    }
  });

  it("não transforma ausência em zero nem aceita confiança em evidência indisponível", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          evidence: [
            { evidenceId: "ev-ident", origin: "unavailable", value: 0 },
          ],
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          evidence: [
            { evidenceId: "ev-ident", origin: "unavailable", confidence: 0.5 },
          ],
        })
      )
    );

    const unavailable = parseFoodObservation(
      buildFoodObservationFixture({
        evidence: [
          {
            evidenceId: "ev-ident",
            origin: "unavailable",
            value: null,
            confidence: null,
            verified: false,
          },
        ],
      })
    );
    expect(unavailable.ok).toBe(true);
  });

  it("rejeita caminhos de evidência fora do vocabulário governado", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          evidence: [
            { evidenceId: "ev-ident", field: "identity.saborEspecial" },
          ],
        })
      )
    );
  });

  it("acopla estagiário/origem da trilha de normalização e versão do interpretador", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          normalizationPath: [{ stage: "S1", origin: "interpreter" }],
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          normalizationPath: [{ stage: "S3", origin: "interpreter" }],
          interpreterVersion: null,
        })
      )
    );
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          interpreterVersion: "gpt-x",
        })
      )
    );

    const withInterpreter = parseFoodObservation(
      buildFoodObservationFixture({
        normalizationPath: [{ stage: "S3", origin: "interpreter" }],
        interpreterVersion: "gpt-x",
      })
    );
    expect(withInterpreter.ok).toBe(true);
  });

  it("rejeita qualificador duplicado e preserva qualificador sem papel semântico", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          identityHints: {
            qualifiers: [{ value: "light" }, { value: "LIGHT" }],
          },
        })
      )
    );

    const unclassified = parseFoodObservation(
      buildFoodObservationFixture({
        identityHints: {
          qualifiers: [
            {
              value: "light",
              attributeCode: null,
              role: null,
              confidence: null,
            },
          ],
        },
      })
    );
    expect(unclassified.ok).toBe(true);
  });
});

describe("FoodResolutionDecision v2", () => {
  it("aceita decisão válida e preserva a entrada sem mutação", () => {
    const input = buildFoodResolutionDecisionFixture();
    const snapshot = structuredClone(input);

    const result = parseFoodResolutionDecision(input);

    expect(result.ok).toBe(true);
    expect(input).toStrictEqual(snapshot);
  });

  it("rejeita versão desconhecida antes de qualquer mutação", () => {
    const input = buildFoodResolutionDecisionFixture({ schemaVersion: 3 });
    const snapshot = structuredClone(input);

    const result = parseFoodResolutionDecision(input);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperado rejeição");
    expect(result.code).toBe("unsupported-schema-version");
    expect(input).toStrictEqual(snapshot);
  });

  it("rejeita campo arbitrário de provider sem mutar a entrada", () => {
    const input = buildFoodResolutionDecisionFixture({
      nutrition: { providerPayload: { label: "arbitrário" } },
    });
    const snapshot = structuredClone(input);

    const result = parseFoodResolutionDecision(input);

    expectInvalid(result);
    expect(input).toStrictEqual(snapshot);
  });

  it("valida a matriz completa de status × nextAction (§5)", () => {
    for (const status of FOOD_DECISION_STATUSES) {
      for (const nextAction of FOOD_DECISION_NEXT_ACTIONS) {
        const allowed =
          FOOD_STATUS_ALLOWED_ACTIONS[status].includes(nextAction);
        const overrides =
          status === "resolved"
            ? { status, nextAction }
            : {
                status,
                nextAction,
                reasonCodes: ["unknown_surface"],
                ...(status === "unknown"
                  ? {
                      identity: {
                        canonicalName: null,
                        foodEntityId: null,
                        candidateKey: null,
                      },
                    }
                  : {}),
                ...(status === "ambiguous"
                  ? {
                      alternatives: [
                        buildFoodAlternativeFixture({
                          candidateKey: "a",
                          name: "A",
                        }),
                        buildFoodAlternativeFixture({
                          candidateKey: "b",
                          name: "B",
                        }),
                      ],
                    }
                  : {}),
              };
        const result = parseFoodResolutionDecision(
          buildFoodResolutionDecisionFixture(overrides)
        );
        expect(
          result.ok,
          `status=${status} nextAction=${nextAction} deveria ser ${
            allowed ? "aceito" : "rejeitado"
          }`
        ).toBe(allowed);
      }
    }
  });

  it("aplica a precedência de status (resolved, unknown, ambiguous)", () => {
    // resolved exige unresolvedFields vazio, identidade, quantidade e nutrição.
    for (const overrides of [
      { unresolvedFields: ["quantity"] },
      { identity: { canonicalName: null } },
      { quantity: { value: null, unit: null, grams: null, milliliters: null } },
      {
        nutrition: {
          verified: false,
          provisional: false,
          basis: null,
          consumed: null,
          evidenceIds: [],
        },
      },
    ]) {
      expectInvalid(
        parseFoodResolutionDecision(
          buildFoodResolutionDecisionFixture(overrides)
        )
      );
    }

    // unknown significa nenhuma identidade sustentada.
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          status: "unknown",
          nextAction: "clarify",
          reasonCodes: ["unknown_surface"],
        })
      )
    );

    // ambiguous exige alternativas materialmente concorrentes.
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          status: "ambiguous",
          nextAction: "clarify",
          reasonCodes: ["source_conflict"],
        })
      )
    );

    // Resultado não resolvido exige motivo.
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          status: "partially_resolved",
          nextAction: "clarify",
          reasonCodes: [],
        })
      )
    );
  });

  it("mantém flags nutricionais exclusivos e nunca usa zeros como ausência", () => {
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          nutrition: { verified: true, provisional: true },
        })
      )
    );
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          nutrition: {
            verified: false,
            provisional: false,
            basis: null,
            consumed: {
              calories: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              fiber: null,
              sugar: null,
              sodiumMg: null,
            },
            evidenceIds: [],
          },
        })
      )
    );
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          nutrition: { basis: null, evidenceIds: [] },
        })
      )
    );
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          nutrition: { verified: false, provisional: false },
        })
      )
    );
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          nutrition: { evidenceIds: [] },
        })
      )
    );
  });

  it("rejeita bases físicas ambíguas e valor sem unidade", () => {
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          quantity: { grams: 250, milliliters: 240 },
        })
      )
    );
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({ quantity: { unit: null } })
      )
    );
  });

  it("recusa ml virando gramas sem relação comprovada e aceita o caso irmão com prova", () => {
    const withoutDensity = buildFoodResolutionDecisionFixture({
      quantity: {
        value: 240,
        unit: "ml",
        grams: 240,
        milliliters: null,
        evidenceIds: ["ev-density"],
      },
      identity: { evidenceIds: [] },
      nutrition: { basis: { unit: "ml" } },
      evidence: [
        {
          evidenceId: "ev-density",
          field: "quantity.value",
          value: 240,
        },
      ],
    });
    const rejected = parseFoodResolutionDecision(withoutDensity);
    expectInvalid(rejected);
    if (!rejected.ok) {
      expect(
        rejected.issues.some(issue => issue.message.includes("densidade"))
      ).toBe(true);
    }

    const withDensity = buildFoodResolutionDecisionFixture({
      quantity: {
        value: 240,
        unit: "ml",
        grams: 240,
        milliliters: null,
        evidenceIds: ["ev-density"],
      },
      identity: { evidenceIds: [] },
      nutrition: { basis: { unit: "ml" } },
      evidence: [
        {
          evidenceId: "ev-density",
          field: "quantity.grams",
          origin: "catalog",
          value: 240,
          unit: "g",
          verified: true,
        },
      ],
    });
    expect(parseFoodResolutionDecision(withDensity).ok).toBe(true);
  });

  it("exige evidência barcode para barcode exato (precedência não vira fuzzy match)", () => {
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          identity: { barcode: "7891000315507" },
        })
      )
    );

    const withEvidence = parseFoodResolutionDecision(
      buildFoodResolutionDecisionFixture({
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
      })
    );
    // O barcode exige evidência resolvível dentro do envelope da decisão.
    expect(withEvidence.ok).toBe(true);
  });

  it("exige família para variantId em identidade e alternativas", () => {
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          identity: { variantId: 9, variant: "defumada", foodEntityId: null },
        })
      )
    );
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          identity: { variantId: 9, variant: "defumada" },
          status: "ambiguous",
          nextAction: "clarify",
          reasonCodes: ["source_conflict"],
          alternatives: [
            buildFoodAlternativeFixture({
              candidateKey: "a",
              name: "A",
              variantId: 9,
              foodEntityId: null,
            }),
            buildFoodAlternativeFixture({ candidateKey: "b", name: "B" }),
          ],
        })
      )
    );
  });

  it("exige que referências de evidência resolvam no envelope da decisão", () => {
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          quantity: { evidenceIds: ["ev-inexistente"] },
        })
      )
    );
    expectInvalid(
      parseFoodResolutionDecision(
        buildFoodResolutionDecisionFixture({
          nutrition: { evidenceIds: ["ev-nutrition", "ev-nutrition"] },
        })
      )
    );
  });

  it("rejeita evidência existente quando pertence a outro proprietário", () => {
    for (const overrides of [
      { identity: { evidenceIds: ["ev-grams"] } },
      { quantity: { evidenceIds: ["ev-nutrition"] } },
      { nutrition: { evidenceIds: ["ev-ident"] } },
      {
        classification: {
          version: "cls-1",
          processingLevel: null,
          isFruit: null,
          isVegetable: null,
          isUltraProcessed: null,
          confidence: null,
          provisional: true,
          evidenceIds: ["ev-ident"],
        },
      },
      {
        status: "ambiguous",
        nextAction: "clarify",
        reasonCodes: ["source_conflict"],
        alternatives: [
          buildFoodAlternativeFixture({
            candidateKey: "a",
            name: "A",
            evidenceIds: ["ev-grams"],
          }),
          buildFoodAlternativeFixture({
            candidateKey: "b",
            name: "B",
          }),
        ],
      },
    ]) {
      expectInvalid(
        parseFoodResolutionDecision(buildFoodResolutionDecisionFixture(overrides))
      );
    }
  });

  it("exige grounding verificável para classificação não provisória", () => {
    const semEvidencia = parseFoodResolutionDecision(
      buildFoodResolutionDecisionFixture({
        classification: {
          version: "cls-1",
          processingLevel: "processed",
          isFruit: false,
          isVegetable: false,
          isUltraProcessed: false,
          confidence: 0.9,
          provisional: false,
          evidenceIds: [],
        },
      })
    );
    expectInvalid(semEvidencia);

    const comEvidencia = parseFoodResolutionDecision(
      buildFoodResolutionDecisionFixture({
        classification: {
          version: "cls-1",
          processingLevel: "processed",
          isFruit: false,
          isVegetable: false,
          isUltraProcessed: false,
          confidence: 0.9,
          provisional: false,
          evidenceIds: ["ev-classification"],
        },
        evidence: [
          {},
          {},
          {},
          {
            evidenceId: "ev-classification",
            field: "classification.processingLevel",
            origin: "catalog",
            value: "processed",
            unit: null,
            confidence: 0.9,
            verified: true,
            anchor: buildFoodAnchorFixture(),
            sourceId: 12,
          },
        ],
      })
    );
    expect(comEvidencia.ok).toBe(true);
  });

  it("mantém contrato de serialização estável (round-trip JSON)", () => {
    const decision = buildFoodResolutionDecisionFixture();
    const observation = buildFoodObservationFixture();

    const decisionRoundTrip = parseFoodResolutionDecision(
      JSON.parse(JSON.stringify(decision))
    );
    const observationRoundTrip = parseFoodObservation(
      JSON.parse(JSON.stringify(observation))
    );

    expect(decisionRoundTrip).toStrictEqual({
      ok: true,
      value: decision,
    });
    expect(observationRoundTrip).toStrictEqual({
      ok: true,
      value: observation,
    });
  });
});

describe("envelope interno da operação", () => {
  it("aceita envelope válido com MealOperation separado", () => {
    const result = parseFoodOperationEnvelope(
      buildFoodOperationEnvelopeFixture()
    );
    expect(result.ok).toBe(true);
  });

  it("rejeita versão desconhecida do envelope sem mutar a entrada", () => {
    const input = buildFoodOperationEnvelopeFixture({ schemaVersion: 3 });
    const snapshot = structuredClone(input);

    const result = parseFoodOperationEnvelope(input);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperado rejeição");
    expect(result.code).toBe("unsupported-schema-version");
    expect(input).toStrictEqual(snapshot);
  });

  it("exige previousMessage, preferences e recentHistory explicitamente", () => {
    const sources = [
      "previousMessage",
      "preferences",
      "recentHistory",
    ] as const;

    for (const source of sources) {
      const envelope = structuredClone(buildFoodOperationEnvelopeFixture());
      const contextSources = envelope.contextSources as Partial<
        typeof envelope.contextSources
      >;
      delete contextSources[source];

      expect(parseFoodOperationEnvelope(envelope).ok).toBe(false);
    }
  });

  it("exige sourceRef quando o contexto está disponível", () => {
    expect(
      parseFoodOperationEnvelope(
        buildFoodOperationEnvelopeFixture({
          contextSources: {
            previousMessage: {
              status: "available",
              reason: null,
              sourceRef: null,
            },
          },
        })
      ).ok
    ).toBe(false);
  });

  it("exige motivo estruturado quando o contexto não está disponível", () => {
    expect(
      parseFoodOperationEnvelope(
        buildFoodOperationEnvelopeFixture({
          contextSources: {
            recentHistory: { status: "unavailable", reason: null },
          },
        })
      ).ok
    ).toBe(false);

    expect(
      parseFoodOperationEnvelope(
        buildFoodOperationEnvelopeFixture({
          contextSources: {
            recentHistory: {
              status: "expired",
              reason: "janela_expirada",
              sourceRef: "turn:-3",
            },
          },
        })
      ).ok
    ).toBe(true);
  });

  it("exige versões fixadas e data explícita na operação", () => {
    expect(
      parseFoodOperationEnvelope(
        buildFoodOperationEnvelopeFixture({ revisions: { resolver: "" } })
      ).ok
    ).toBe(false);

    expect(
      parseFoodOperationEnvelope(
        buildFoodOperationEnvelopeFixture({
          mealOperation: { date: "amanhã" },
        })
      ).ok
    ).toBe(false);

    expect(
      parseFoodOperationEnvelope(
        buildFoodOperationEnvelopeFixture({ mealOperation: null })
      ).ok
    ).toBe(true);
  });
});

describe("âncora", () => {
  it("exige sourceRef não vazio", () => {
    expectInvalid(
      parseFoodObservation(
        buildFoodObservationFixture({
          surfaceSpan: buildFoodAnchorFixture({ sourceRef: "   " }),
        })
      )
    );
  });
});
