import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));
vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));


vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) =>
    findCatalogFoodSemanticMock(...args),
}));

describe("nutritionEngine.processMealInput text fallback", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(null);
  });

  it.each([
    {
      text: "um ovo cozido",
      quantity: 1,
      expectedFoodName: "Ovo Cozido",
      mode: "provider-unavailable" as const,
    },
    {
      text: "um ovo cozido",
      quantity: 1,
      expectedFoodName: "Ovo Cozido",
      mode: "empty-image-extraction" as const,
    },
    {
      text: "duas bananas prata",
      quantity: 2,
      expectedFoodName: "Bananas Prata",
      mode: "provider-unavailable" as const,
    },
    {
      text: "duas bananas prata",
      quantity: 2,
      expectedFoodName: "Bananas Prata",
      mode: "empty-image-extraction" as const,
    },
    {
      text: "uma banana prata",
      quantity: 1,
      expectedFoodName: "Banana Prata",
      mode: "provider-unavailable" as const,
    },
    {
      text: "uma banana prata",
      quantity: 1,
      expectedFoodName: "Banana Prata",
      mode: "empty-image-extraction" as const,
    },
  ])(
    "normaliza $text sem depender de correção lexical no modo $mode",
    async ({ text, quantity, expectedFoodName, mode }) => {
      if (mode === "provider-unavailable") {
        createTextResponseMock.mockRejectedValue(
          new Error("provider indisponível")
        );
      } else {
        createTextResponseMock.mockResolvedValue({
          id: "response-empty-numeral-fallback",
          outputText: JSON.stringify({
            mealLabel: "Lanche",
            confidence: 0.2,
            reasoning:
              "A imagem não permitiu identificar um item com segurança.",
            items: [],
          }),
          raw: {},
        });
      }

      const { processMealInput } = await import("./nutritionEngine");
      const result = await processMealInput({
        text,
        ...(mode === "empty-image-extraction"
          ? { imageUrl: "data:image/png;base64,ZmFrZQ==" }
          : {}),
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          foodName: expectedFoodName,
          quantity,
          unit: "un",
        })
      );
      expect(result.sourceText).toBe(text);
    }
  );

  it.each(["dois ovos cozido", "2 ovos"])(
    "preserva a quantidade em controles já funcionais: %s",
    async text => {
      createTextResponseMock.mockRejectedValue(
        new Error("provider indisponível")
      );

      const { processMealInput } = await import("./nutritionEngine");
      const result = await processMealInput({ text });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({ quantity: 2, unit: "un" })
      );
    }
  );

  it("usa fallback textual quando todos os itens extraídos são rejeitados", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "response-rejected-ai-item",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.9,
        reasoning: "A IA indicou alimento ausente no texto.",
        items: [
          {
            foodName: "Arroz branco",
            portionText: "100 g",
            servings: 1,
            estimatedGrams: 100,
            estimatedCalories: 130,
            estimatedMacros: { protein: 2.7, carbs: 28, fat: 0.3 },
            confidence: 0.8,
            foodClassification: {
              processingLevel: "natural_or_minimally_processed",
              isFruit: false,
              isVegetable: false,
              fiberGrams: 0,
            },
          },
        ],
      }),
      raw: {},
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "duas bananas prata" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({ quantity: 2, unit: "un" })
    );
    expect(result.items[0].foodName).toBe("Bananas Prata");
  });

  it("continua descartando objeto não alimentar com numeral no fallback textual", async () => {
    const { cleanMealItems, fallbackFromText } = await import(
      "./mealItemCleanup"
    );
    const items = fallbackFromText("um pote vazio");

    expect(items).toHaveLength(1);
    expect(cleanMealItems(items)).toEqual([]);
  });

  it.each([
    { text: "uma fatia de pão", quantity: 1, unit: "fatia", foodName: "Pão" },
    { text: "dois copos de água", quantity: 2, unit: "copo", foodName: "Água" },
  ])(
    "preserva unidade e identidade física escrita em $text",
    async ({ text, quantity, unit, foodName }) => {
      createTextResponseMock.mockRejectedValue(
        new Error("provider indisponível")
      );

      const { processMealInput } = await import("./nutritionEngine");
      const result = await processMealInput({ text });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({ foodName, quantity, unit })
      );
      expect(result.sourceText).toBe(text);
    }
  );

  it("não promove `um sal` a pão por causa do best-match do catálogo", async () => {
    createTextResponseMock.mockRejectedValue(
      new Error("provider indisponível")
    );

    const { processMealInput } = await import("./nutritionEngine");
    const ambiguous = await processMealInput({ text: "um sal" });
    const exactAlias = await processMealInput({ text: "um pão de sal" });

    expect(ambiguous.items).toHaveLength(1);
    expect(ambiguous.items[0]).toEqual(
      expect.objectContaining({
        foodName: "Um Sal",
        canonicalName: "Um Sal",
        unit: "porção",
      })
    );
    expect(ambiguous.items[0].canonicalName).not.toBe("Pão Francês");
    expect(exactAlias.items[0]).toEqual(
      expect.objectContaining({
        canonicalName: "Pão Francês",
        quantity: 1,
        unit: "un",
      })
    );
  });

  it("não infere identidade de pêra para uma cultivar sem alias catalogado", async () => {
    createTextResponseMock.mockRejectedValue(
      new Error("provider indisponível")
    );

    const { normalizeKnownFoodText } = await import("./foodTextNormalization");
    expect(normalizeKnownFoodText("uma pêra packans")).toBe("uma pêra packans");

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "uma pêra packans" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        foodName: "Uma Pêra Packans",
        canonicalName: "Uma Pêra Packans",
        unit: "porção",
      })
    );
  });

  it.each(
    [
      "uma colher de arroz",
      "duas colheres de sopa de arroz",
      "uma colher de chá de sal",
    ].flatMap(text => [
      { text, mode: "provider failure", response: "failure" as const },
      { text, mode: "empty extraction", response: "empty" as const },
      {
        text,
        mode: "all extracted items rejected",
        response: "rejected" as const,
      },
    ])
  )(
    "solicita gramas e não produz item para $text ($mode)",
    async ({ text, response }) => {
      if (response === "failure") {
        createTextResponseMock.mockRejectedValue(
          new Error("provider indisponível")
        );
      } else {
        createTextResponseMock.mockResolvedValue({
          id: "response-unresolved-spoon-quantity",
          outputText: JSON.stringify({
            mealLabel: "Almoço",
            confidence: 0.8,
            reasoning: "Resposta controlada do teste.",
            items:
              response === "empty"
                ? []
                : [
                    {
                      foodName: "Pão francês",
                      portionText: "50 g",
                      servings: 1,
                      estimatedGrams: 50,
                      estimatedCalories: 140,
                      estimatedMacros: { protein: 4.5, carbs: 28, fat: 1.5 },
                      confidence: 0.8,
                      foodClassification: {
                        processingLevel: "processed",
                        isFruit: false,
                        isVegetable: false,
                        fiberGrams: 1,
                      },
                    },
                  ],
          }),
          raw: {},
        });
      }

      const { processMealInput } = await import("./nutritionEngine");

      await expect(processMealInput({ text })).rejects.toMatchObject({
        name: "MealInferenceError",
        message: expect.stringContaining("gramas"),
        code: "food_component_quantity_required",
        context: expect.objectContaining({
          originalText: text,
          acceptedUnits: expect.arrayContaining(["g"]),
        }),
      });
      expect(createTextResponseMock).not.toHaveBeenCalled();
    }
  );

  it("também solicita gramas para colher sem conversão segura em transcrição", async () => {
    createTextResponseMock.mockRejectedValue(
      new Error("provider indisponível")
    );

    const { processMealInput } = await import("./nutritionEngine");

    await expect(
      processMealInput({ transcript: "uma colher de arroz" })
    ).rejects.toMatchObject({ code: "food_component_quantity_required" });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("detecta colher sem conversão em segmento posterior antes do provider", async () => {
    createTextResponseMock.mockRejectedValue(
      new Error("provider indisponível")
    );

    const { processMealInput } = await import("./nutritionEngine");

    await expect(
      processMealInput({ text: "duas bananas prata e uma colher de arroz" })
    ).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ foodName: "arroz" }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "um pouco", text: "um pouco de arroz" },
    { label: "um pouquinho", text: "um pouquinho de arroz" },
    { label: "um pedacinho", text: "um pedacinho de queijo" },
    { label: "uma pitada", text: "uma pitada de sal" },
    { label: "duas colheradas", text: "duas colheradas de arroz" },
    { label: "um gole", text: "um gole de suco" },
    { label: "um punhado", text: "um punhado de amendoim" },
    { label: "um pratão", text: "um pratão de arroz" },
    { label: "um prato grande", text: "um prato grande de arroz" },
  ])(
    "não reescreve a porção incerta $label como quantidade contável",
    async ({ text }) => {
      const { normalizeKnownFoodText } = await import(
        "./foodTextNormalization"
      );

      expect(normalizeKnownFoodText(text)).toBe(text);
    }
  );

  it("não converte 'um pouco de arroz' em uma unidade no fallback V1", async () => {
    createTextResponseMock.mockRejectedValue(
      new Error("provider indisponível")
    );

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "um pouco de arroz" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({ foodName: "Um Pouco de Arroz", unit: "porção" })
    );
    expect(result.sourceText).toBe("um pouco de arroz");
  });

  it.each([
    {
      label: "transcrição sem texto",
      input: { transcript: "um ovo cozido" },
      quantities: [1],
      foodNames: ["Ovo Cozido"],
      sourceText: "um ovo cozido",
    },
    {
      label: "texto mais transcrição",
      input: { text: "um ovo cozido", transcript: "duas bananas prata" },
      quantities: [1, 2],
      foodNames: ["Ovo Cozido", "Bananas Prata"],
      sourceText: "um ovo cozido\nduas bananas prata",
    },
    {
      label: "múltiplos segmentos textuais",
      input: { text: "um ovo cozido, duas bananas prata" },
      quantities: [1, 2],
      foodNames: ["Ovo Cozido", "Bananas Prata"],
      sourceText: "um ovo cozido, duas bananas prata",
    },
  ])(
    "preserva numeral e segmentação em $label",
    async ({ input, quantities, foodNames, sourceText }) => {
      createTextResponseMock.mockRejectedValue(
        new Error("provider indisponível")
      );

      const { processMealInput } = await import("./nutritionEngine");
      const result = await processMealInput(input);

      expect(result.items.map(item => item.quantity)).toEqual(quantities);
      expect(result.items.map(item => item.foodName)).toEqual(foodNames);
      expect(result.items.every(item => item.unit === "un")).toBe(true);
      expect(result.sourceText).toBe(sourceText);
    }
  );

  it("preserva um segmento resolvido e normaliza somente o restante", async () => {
    createTextResponseMock.mockRejectedValue(
      new Error("provider indisponível")
    );

    const { processMealInput } = await import("./nutritionEngine");
    const { processMealInputWithPartialFailures } = await import(
      "./partialMealProcessing"
    );
    const resolvedEgg = await processMealInput({ text: "um ovo cozido" });
    const result = await processMealInputWithPartialFailures(
      { text: "um ovo cozido, duas bananas prata" },
      [{ segmentIndex: 0, processed: resolvedEgg }]
    );

    expect(result.skippedSegments).toEqual([]);
    expect(result.processed.items.map(item => item.quantity)).toEqual([1, 2]);
    expect(result.processed.items.map(item => item.foodName)).toEqual([
      "Ovo Cozido",
      "Bananas Prata",
    ]);
    expect(result.processed.items.every(item => item.unit === "un")).toBe(true);
    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: "ausente", input: {} },
    { label: "vazio", input: { text: "" } },
    { label: "somente espaços", input: { text: " \t\n " } },
  ])("falha sem item para source text $label", async ({ input }) => {
    createTextResponseMock.mockRejectedValue(
      new Error("provider indisponível")
    );

    const { MealInferenceError, processMealInput } = await import(
      "./nutritionEngine"
    );

    await expect(processMealInput(input)).rejects.toMatchObject({
      name: MealInferenceError.name,
      code: "meal_inference_unavailable",
    });
  });

  it("atravessa o POST público do WhatsApp até o processador V1 real", async () => {
    createTextResponseMock.mockRejectedValue(
      new Error("provider indisponível")
    );

    const expressModule = await import("express");
    const express = expressModule.default;
    const { createServer } = await import("node:http");
    const { processMealInput } = await import("./nutritionEngine");
    const { registerWhatsAppPublicPostRoute } = await import(
      "./whatsappPublicRoute"
    );
    const events: string[] = [];
    let observedResult: unknown;
    const app = express();

    registerWhatsAppPublicPostRoute(app, {
      runtimeBootId: "f34-numeral-test",
      observeIngress: (_req, _res, next) => {
        events.push("ingress");
        next();
      },
      webhookRateLimit: (_req, _res, next) => {
        events.push("rate-limit");
        next();
      },
      handle: async (req, res) => {
        events.push("handle");
        const message = (req.body as any).entry[0].changes[0].value.messages[0];
        const result = await processMealInput({ text: message.text.body });
        observedResult = {
          rawText: message.text.body,
          originalText: (req as any).__originalInboundTextByMessageId.get(
            message.id
          ),
          sourceText: result.sourceText,
          items: result.items.map(({ quantity, unit }) => ({ quantity, unit })),
        };
        res.status(200).json(observedResult);
      },
    });

    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>(resolve => server.close(() => resolve()));
      throw new Error("Servidor HTTP de teste não expôs uma porta.");
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/whatsapp/webhook`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            object: "whatsapp_business_account",
            entry: [
              {
                id: "business-account-f34",
                changes: [
                  {
                    field: "messages",
                    value: {
                      messaging_product: "whatsapp",
                      metadata: {
                        display_phone_number: "5511000000000",
                        phone_number_id: "phone-number-f34",
                      },
                      messages: [
                        {
                          from: "5511999999999",
                          id: "wamid-f34-numeral",
                          timestamp: "1789556400",
                          type: "text",
                          text: { body: "  duas bananas prata  " },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          }),
        }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-runtime-commit")).toBe("unavailable");
      expect(events).toEqual(["ingress", "rate-limit", "handle"]);
      expect(body).toEqual({
        rawText: "  duas bananas prata  ",
        originalText: "duas bananas prata",
        sourceText: "duas bananas prata",
        items: [{ quantity: 2, unit: "un" }],
      });
      expect(observedResult).toEqual(body);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  it("aplica o limite bruto do webhook antes do handler", async () => {
    const expressModule = await import("express");
    const express = expressModule.default;
    const { createServer } = await import("node:http");
    const { PAYLOAD_LIMITS } = await import("./_core/rateLimit");
    const { registerWhatsAppPublicPostRoute } = await import(
      "./whatsappPublicRoute"
    );
    expect(PAYLOAD_LIMITS.webhookJson).toBe("5mb");
    const limitBytes = 5 * 1024 * 1024;
    const prefix = '{"entry":[],"padding":"';
    const suffix = '"}';
    const makeSizedBody = (size: number) =>
      `${prefix}${"x".repeat(size - Buffer.byteLength(prefix + suffix))}${suffix}`;
    const exactBody = makeSizedBody(limitBytes);
    const overLimitBody = makeSizedBody(limitBytes + 1);
    const validJson = '{"entry":[]}';
    const paddedBody = `${validJson}${" ".repeat(
      limitBytes + 1 - Buffer.byteLength(validJson)
    )}`;
    expect(Buffer.byteLength(exactBody)).toBe(limitBytes);
    expect(Buffer.byteLength(overLimitBody)).toBe(limitBytes + 1);
    expect(Buffer.byteLength(paddedBody)).toBe(limitBytes + 1);

    const events: string[] = [];
    let handlerCalls = 0;
    const app = express();
    registerWhatsAppPublicPostRoute(app, {
      runtimeBootId: "f34-limit-test",
      observeIngress: (req, _res, next) => {
        events.push(`ingress:${req.get("x-test-case")}`);
        next();
      },
      webhookRateLimit: (req, res, next) => {
        const testCase = req.get("x-test-case");
        events.push(`rate-limit:${testCase}`);
        if (testCase === "blocked-malformed") {
          res.status(429).json({ code: "rate_limited" });
          return;
        }
        next();
      },
      handle: (_req, res) => {
        const testCase = _req.get("x-test-case");
        events.push(`handle:${testCase}`);
        handlerCalls += 1;
        res.status(204).end();
      },
    });

    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>(resolve => server.close(() => resolve()));
      throw new Error("Servidor HTTP de teste não expôs uma porta.");
    }

    const postRaw = (
      testCase: string,
      body: string,
      contentType = "application/json"
    ) =>
      fetch(`http://127.0.0.1:${address.port}/api/whatsapp/webhook`, {
        method: "POST",
        headers: {
          "content-type": contentType,
          "x-test-case": testCase,
        },
        body,
      });

    try {
      const exactResponse = await postRaw("exact", exactBody);
      expect(exactResponse.status).toBe(204);

      const overLimitResponse = await postRaw("limit-plus-one", overLimitBody);
      expect(overLimitResponse.status).toBe(413);

      const paddedResponse = await postRaw("external-padding", paddedBody);
      expect(paddedResponse.status).toBe(413);

      const charsetResponse = await postRaw(
        "unsupported-charset",
        '{"entry":[]}',
        "application/json; charset=iso-8859-1"
      );
      expect(charsetResponse.status).toBe(415);

      const blockedMalformedResponse = await postRaw("blocked-malformed", "{");
      expect(blockedMalformedResponse.status).toBe(429);
      expect(await blockedMalformedResponse.json()).toEqual({
        code: "rate_limited",
      });

      const malformedResponse = await postRaw("malformed", "{");
      expect(malformedResponse.status).toBe(400);

      expect(handlerCalls).toBe(1);
      expect(events).toEqual([
        "ingress:exact",
        "rate-limit:exact",
        "handle:exact",
        "ingress:limit-plus-one",
        "rate-limit:limit-plus-one",
        "ingress:external-padding",
        "rate-limit:external-padding",
        "ingress:unsupported-charset",
        "rate-limit:unsupported-charset",
        "ingress:blocked-malformed",
        "rate-limit:blocked-malformed",
        "ingress:malformed",
        "rate-limit:malformed",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  it("distingue corpos HTTP ausente, vazio, somente espaços e envelope form-urlencoded", async () => {
    const expressModule = await import("express");
    const express = expressModule.default;
    const { createServer } = await import("node:http");
    const { registerWhatsAppPublicPostRoute } = await import(
      "./whatsappPublicRoute"
    );
    const receivedBodies: unknown[] = [];
    const events: string[] = [];
    const app = express();
    registerWhatsAppPublicPostRoute(app, {
      runtimeBootId: "f34-raw-shapes-test",
      observeIngress: (_req, _res, next) => {
        events.push("ingress");
        next();
      },
      webhookRateLimit: (_req, _res, next) => {
        events.push("rate-limit");
        next();
      },
      handle: (req, res) => {
        events.push("handle");
        receivedBodies.push(req.body);
        res.status(204).end();
      },
    });

    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>(resolve => server.close(() => resolve()));
      throw new Error("Servidor HTTP de teste não expôs uma porta.");
    }
    const url = `http://127.0.0.1:${address.port}/api/whatsapp/webhook`;

    try {
      const missingResponse = await fetch(url, { method: "POST" });
      expect(missingResponse.status).toBe(204);

      const emptyResponse = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      });
      expect(emptyResponse.status).toBe(204);

      const whitespaceResponse = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: " \t\n ",
      });
      expect(whitespaceResponse.status).toBe(400);

      const formResponse = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          "entry[0][changes][0][value][messages][0][id]": "wamid-form-f34",
          "entry[0][changes][0][value][messages][0][text][body]": "banana",
        }),
      });
      expect(formResponse.status).toBe(204);
      expect(receivedBodies[2]).toMatchObject({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { id: "wamid-form-f34", text: { body: "banana" } },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(receivedBodies).toHaveLength(3);
      expect(events).toEqual([
        "ingress",
        "rate-limit",
        "handle",
        "ingress",
        "rate-limit",
        "handle",
        "ingress",
        "rate-limit",
        "ingress",
        "rate-limit",
        "handle",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  it("usa o texto informado quando a imagem retorna sem itens", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "response-test",
      outputText: JSON.stringify({
        mealLabel: "Bebida",
        confidence: 0.2,
        reasoning: "A imagem não permitiu identificar um item com segurança.",
        items: [],
      }),
      raw: {},
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "200ml guaraná antártica",
      imageUrl: "data:image/png;base64,ZmFrZQ==",
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "Guaraná Antártica",
        quantity: 200,
        unit: "ml",
        portionText: "200 ml",
        estimatedGrams: 200,
        source: "heuristic",
      }),
    ]);
    expect(result.reasoning).toContain(
      "heurística a partir do texto informado"
    );
  });

  it("F34 — cruza campos diretos de contexto pelos quatro modos de entrada", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const modes = [
      { id: "text", fields: { text: "banana" }, sourceText: "banana" },
      {
        id: "audio_transcript",
        fields: {
          transcript: "banana",
          audioUrl: "https://media.example/f34-audio.ogg",
        },
        sourceText: "banana",
      },
      {
        id: "image",
        fields: {
          imageUrl: "data:image/jpeg;base64,ZmFrZQ==",
          nutritionLabelIdentityContext: {
            originalFoodName: "banana fresca",
            originalCanonicalName: "banana",
            originalBrand: "Marca Fruta",
            originalProductVariant: "Prata",
          },
        },
        sourceText: "",
      },
      {
        id: "multimodal",
        fields: {
          text: "banana",
          transcript: "banana narrada",
          audioUrl: "https://media.example/f34-multimodal.ogg",
          imageUrl: "data:image/jpeg;base64,ZmFrZQ==",
          nutritionLabelIdentityContext: {
            originalFoodName: "banana fresca",
            originalCanonicalName: "banana",
            originalBrand: "Marca Fruta",
            originalProductVariant: "Prata",
          },
        },
        sourceText: "banana\nbanana narrada",
      },
    ] as const;
    const context = {
      habits: [
        {
          foodName: "aveia",
          occurrenceCount: 7,
          typicalTimeLabel: "Café da manhã",
          notes: "preferência F34",
        },
      ],
      occurredAt: "2026-11-07T21:00:00.000Z",
      timeZone: "America/Sao_Paulo",
      semanticEvidenceOrigins: {
        identity: "memory" as const,
        brand: "memory" as const,
        variant: "memory" as const,
        quantity: "memory" as const,
        estimatedGrams: "memory" as const,
      },
      suggestedMealLabel: null,
      intentHint: {
        intent: "add_foods_to_meal",
        confidence: 0.9,
        mealLabel: "Almoço",
        date: "2026-11-07",
        reasoning: "hint de teste F34",
      },
      skipCommercialNutritionSearch: true,
    };
    const extraction = {
      mealLabel: "Café da manhã",
      confidence: 0.9,
      reasoning: "Alimento reconhecido no controle F34.",
      items: [
        {
          foodName: "banana",
          brand: null,
          quantity: 1,
          unit: "un",
          portionText: "1 unidade",
          servings: 1,
          estimatedGrams: 120,
          estimatedCalories: 105,
          estimatedMacros: { protein: 1.3, carbs: 27, fat: 0.4 },
          confidence: 0.9,
          foodClassification: {
            processingLevel: "natural_or_minimally_processed",
            isFruit: true,
            isVegetable: false,
            fiberGrams: 3.1,
            isPlainWater: false,
          },
        },
      ],
    };

    for (const mode of modes) {
      createTextResponseMock.mockResolvedValue({
        id: `f34-${mode.id}`,
        outputText: JSON.stringify(extraction),
        raw: {},
      });
      const result = await processMealInput({ ...context, ...mode.fields });
      const { buildMealSemanticContract } = await import(
        "./mealSemanticContract"
      );
      const fieldOriginContract = buildMealSemanticContract({
        processingInput: { ...context, ...mode.fields },
        sourceText: result.sourceText,
        items: [
          {
            ...result.items[0],
            brand: "Marca Fruta",
            productVariant: "Prata",
            resolution: {
              ...result.items[0].resolution,
              productVariant: "Prata",
            },
          },
        ],
      });

      expect(result.semanticContract.inputType).toBe(mode.id);
      expect(result.sourceText).toBe(mode.sourceText);
      expect(result.detectedMealLabel).toBe("Pré-treino");
      expect(fieldOriginContract.items[0].evidence).toEqual(
        expect.objectContaining({
          identity: expect.objectContaining({ origin: "memory" }),
          brand: expect.objectContaining({ origin: "memory" }),
          variant: expect.objectContaining({ origin: "memory" }),
          quantity: expect.objectContaining({ origin: "memory" }),
          estimatedGrams: expect.objectContaining({ origin: "memory" }),
        })
      );

      const request = createTextResponseMock.mock.calls.at(-1)?.[0] as {
        input: Array<{
          content: Array<{
            type: string;
            text?: string;
            image_url?: string;
          }>;
        }>;
      };
      const content = request.input[0].content;
      const prompt = content.find(part => part.type === "input_text")?.text;
      expect(prompt).toContain("Rótulo sugerido pelo horário: Pré-treino");
      expect(prompt).toContain(
        "aveia | frequência: 7 | horário típico: Café da manhã | observações: preferência F34"
      );
      expect(prompt).toContain(
        "Intenção identificada pelo classificador: add_foods_to_meal (confiança: 90%)"
      );
      expect(prompt).toContain("Tipo de refeição já resolvido: Almoço");
      expect(prompt).toContain("Data já resolvida: 2026-11-07");
      expect(prompt).toContain(
        "Raciocínio do classificador: hint de teste F34"
      );
      if ("nutritionLabelIdentityContext" in mode.fields) {
        expect(prompt).toContain(
          "Continuação autorizada de uma solicitação de foto de rótulo nutricional já persistida."
        );
        expect(prompt).toContain(
          "Identidade comercial original do item pendente: banana fresca banana Marca Fruta Prata."
        );
      }
      if ("imageUrl" in mode.fields) {
        expect(content).toContainEqual(
          expect.objectContaining({
            type: "input_image",
            image_url: mode.fields.imageUrl,
          })
        );
      }

      createTextResponseMock.mockResolvedValue({
        id: `f34-${mode.id}-suggested-label`,
        outputText: JSON.stringify(extraction),
        raw: {},
      });
      const suggested = await processMealInput({
        ...context,
        ...mode.fields,
        suggestedMealLabel: "Ceia",
      });
      expect(suggested.detectedMealLabel).toBe("Ceia");
      const suggestedRequest = createTextResponseMock.mock.calls.at(
        -1
      )?.[0] as {
        input: Array<{ content: Array<{ type: string; text?: string }> }>;
      };
      expect(
        suggestedRequest.input[0].content.find(
          part => part.type === "input_text"
        )?.text
      ).toContain("Rótulo sugerido pelo horário: Ceia");
    }

    const { buildMealSemanticContract } = await import(
      "./mealSemanticContract"
    );
    const audioUrlOnly = buildMealSemanticContract({
      processingInput: { audioUrl: "https://media.example/f34-audio-only.ogg" },
      sourceText: "",
      items: [],
    });
    expect(audioUrlOnly.inputType).toBe("audio_transcript");
  });

  it("F34 — audioUrl sem transcrição não vira fonte textual e falha fechada", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "f34-audio-url-without-transcript",
      outputText: JSON.stringify({
        mealLabel: "Refeição",
        confidence: 0.1,
        reasoning: "Não há transcrição textual disponível.",
        items: [],
      }),
      raw: {},
    });
    const { processMealInput, MealInferenceError } = await import(
      "./nutritionEngine"
    );

    const result = processMealInput({
      audioUrl: "https://media.example/f34-audio-only.ogg",
    });
    await expect(result).rejects.toBeInstanceOf(MealInferenceError);
    await expect(result).rejects.toMatchObject({
      code: "meal_inference_unavailable",
    });
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
    const request = createTextResponseMock.mock.calls[0]?.[0] as {
      input: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    const content = request.input[0].content;
    expect(content.find(part => part.type === "input_text")?.text).toContain(
      "Texto disponível: não informado"
    );
    expect(content.some(part => part.type === "input_image")).toBe(false);
  });

  it("F34 — imagem sem texto e sem itens falha fechada sem fallback inventado", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "f34-image-empty",
      outputText: JSON.stringify({
        mealLabel: "Refeição",
        confidence: 0.1,
        reasoning: "Nenhum alimento foi identificado com segurança.",
        items: [],
      }),
      raw: {},
    });
    const { MealInferenceError, processMealInput } = await import(
      "./nutritionEngine"
    );

    await expect(
      processMealInput({ imageUrl: "data:image/jpeg;base64,ZmFrZQ==" })
    ).rejects.toMatchObject({
      name: MealInferenceError.name,
      code: "meal_inference_unavailable",
    });
    expect(createTextResponseMock).toHaveBeenCalled();
  });

  it("F34 — colher sem conversão segura também é bloqueada em multimodal", async () => {
    const { processMealInput } = await import("./nutritionEngine");

    await expect(
      processMealInput({
        text: "uma colher de arroz",
        imageUrl: "data:image/jpeg;base64,ZmFrZQ==",
      })
    ).rejects.toMatchObject({ code: "food_component_quantity_required" });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("F34 — skipCommercialNutritionSearch bloqueia a busca em cada modo aceito", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const modes = [
      { id: "text", fields: { text: "20 g queijo MarcaF34 Natural" } },
      {
        id: "audio_transcript",
        fields: {
          transcript: "20 g queijo MarcaF34 Natural",
          audioUrl: "https://media.example/f34-audio.ogg",
        },
      },
      {
        id: "image",
        fields: { imageUrl: "data:image/jpeg;base64,ZmFrZQ==" },
      },
      {
        id: "multimodal",
        fields: {
          text: "20 g queijo MarcaF34 Natural",
          imageUrl: "data:image/jpeg;base64,ZmFrZQ==",
        },
      },
    ] as const;
    const extraction = {
      mealLabel: "Lanche",
      confidence: 0.9,
      reasoning: "Queijo MarcaF34 Natural explicitamente identificado.",
      items: [
        {
          foodName: "queijo",
          brand: "MarcaF34",
          quantity: 20,
          unit: "g",
          portionText: "20 g",
          servings: 1,
          estimatedGrams: 20,
          estimatedCalories: 44,
          estimatedMacros: { protein: 3.6, carbs: 1.2, fat: 2.8 },
          confidence: 0.9,
          foodClassification: {
            processingLevel: "processed",
            isFruit: false,
            isVegetable: false,
            fiberGrams: 0,
            isPlainWater: false,
          },
        },
      ],
    };

    for (const mode of modes) {
      findCatalogFoodSemanticMock.mockClear();
      createTextResponseMock.mockResolvedValue({
        id: `f34-skip-${mode.id}`,
        outputText: JSON.stringify(extraction),
        raw: {},
      });
      await processMealInput({
        ...mode.fields,
        skipCommercialNutritionSearch: true,
      }).catch(() => undefined);
      expect(createTextResponseMock).toHaveBeenCalled();
      expect(findCatalogFoodSemanticMock).not.toHaveBeenCalled();
    }

    findCatalogFoodSemanticMock.mockClear();
    createTextResponseMock.mockResolvedValue({
      id: "f34-commercial-search-control",
      outputText: JSON.stringify(extraction),
      raw: {},
    });
    await processMealInput({
      text: "20 g queijo MarcaF34 Natural",
      skipCommercialNutritionSearch: false,
    }).catch(() => undefined);
    expect(findCatalogFoodSemanticMock).toHaveBeenCalled();
  });

  it("F34 — restringe a travessia hierárquica do envelope no POST público", async () => {
    const expressModule = await import("express");
    const express = expressModule.default;
    const { createServer } = await import("node:http");
    const { registerWhatsAppPublicPostRoute } = await import(
      "./whatsappPublicRoute"
    );
    const { extractIndexedWhatsAppWebhookMessages } = await import(
      "./modules/whatsapp/webhookUtils"
    );
    const observed: Record<string, unknown> = {};
    const app = express();
    registerWhatsAppPublicPostRoute(app, {
      runtimeBootId: "f34-hierarchy-test",
      observeIngress: (_req, _res, next) => next(),
      webhookRateLimit: (_req, _res, next) => next(),
      handle: (req, res) => {
        const key = req.get("x-f34-shape") ?? "missing-key";
        observed[key] = extractIndexedWhatsAppWebhookMessages(req.body);
        res.status(204).end();
      },
    });

    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>(resolve => server.close(() => resolve()));
      throw new Error("Servidor HTTP de teste não expôs uma porta.");
    }
    const url = `http://127.0.0.1:${address.port}/api/whatsapp/webhook`;
    const canonicalMessage = {
      id: "wamid-canonical",
      text: { body: "banana" },
    };
    const cases: Array<{ id: string; body: unknown }> = [
      {
        id: "canonical-direct",
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: "phone-canonical" },
                    messages: [canonicalMessage],
                  },
                },
              ],
            },
          ],
        },
      },
      {
        id: "without-object-declaration",
        body: {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: "phone-no-object" },
                    messages: [
                      { id: "wamid-no-object", text: { body: "arroz" } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      {
        id: "outside-canonical-scope",
        body: {
          messages: [canonicalMessage],
          entry: [
            {
              messages: [canonicalMessage],
              changes: [{ messages: [canonicalMessage] }],
            },
          ],
        },
      },
      {
        id: "unknown-wrapper",
        body: {
          entry: [
            {
              payload: {
                changes: [{ value: { messages: [canonicalMessage] } }],
              },
            },
          ],
        },
      },
      {
        id: "scalar-containers",
        body: {
          entry: [
            { changes: { value: { messages: [canonicalMessage] } } },
            {
              changes: [
                { value: { messages: '{\\"id\\":\\"not-a-message-array\\"}' } },
              ],
            },
          ],
        },
      },
      {
        id: "scalar-entry-container",
        body: {
          entry: "not-an-entry-array",
          changes: [{ value: { messages: [canonicalMessage] } }],
        },
      },
      {
        id: "inactive-embedded-content",
        body: {
          entry: [],
          debug: JSON.stringify({
            entry: [{ changes: [{ value: { messages: [canonicalMessage] } }] }],
          }),
          memo: 'escaped payload text: \\"messages\\":[{\\"id\\":\\"inert\\"}]',
        },
      },
      {
        id: "cross-scope-metadata",
        body: {
          metadata: { phone_number_id: "phone-root-decoy" },
          entry: [
            {
              metadata: { phone_number_id: "phone-entry-decoy" },
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: "phone-change-a" },
                    messages: [{ id: "wamid-a" }],
                  },
                },
                {
                  value: {
                    metadata: { phone_number_id: "phone-change-b" },
                    messages: [{ id: "wamid-b" }],
                  },
                },
              ],
            },
          ],
        },
      },
      {
        id: "duplicate-and-reordered-sections",
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: "phone-a" },
                    messages: [{ id: "duplicate" }, { id: "duplicate" }],
                  },
                },
                {
                  value: {
                    metadata: { phone_number_id: "phone-b" },
                    messages: [{ id: "later-change" }],
                  },
                },
              ],
            },
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: "phone-c" },
                    messages: [{ id: "later-entry" }],
                  },
                },
              ],
            },
          ],
        },
      },
    ];

    try {
      for (const testCase of cases) {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-f34-shape": testCase.id,
          },
          body: JSON.stringify(testCase.body),
        });
        expect(response.status, testCase.id).toBe(204);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }

    expect(observed["canonical-direct"]).toEqual([
      expect.objectContaining({
        key: "0:0:0",
        message: expect.objectContaining({
          id: "wamid-canonical",
          channelPhoneNumberId: "phone-canonical",
        }),
      }),
    ]);
    expect(observed["without-object-declaration"]).toEqual([
      expect.objectContaining({
        key: "0:0:0",
        message: {
          id: "wamid-no-object",
          text: { body: "arroz" },
          entryIndex: 0,
          changeIndex: 0,
          messageIndex: 0,
          channelPhoneNumberId: "phone-no-object",
          channelDisplayPhoneNumber: undefined,
        },
      }),
    ]);
    expect(observed["outside-canonical-scope"]).toEqual([]);
    expect(observed["unknown-wrapper"]).toEqual([]);
    expect(observed["scalar-containers"]).toEqual([]);
    expect(observed["scalar-entry-container"]).toEqual([]);
    expect(observed["inactive-embedded-content"]).toEqual([]);
    expect(observed["cross-scope-metadata"]).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          id: "wamid-a",
          channelPhoneNumberId: "phone-change-a",
        }),
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          id: "wamid-b",
          channelPhoneNumberId: "phone-change-b",
        }),
      }),
    ]);
    expect(observed["duplicate-and-reordered-sections"]).toEqual([
      expect.objectContaining({
        key: "0:0:0",
        message: expect.objectContaining({ id: "duplicate" }),
      }),
      expect.objectContaining({
        key: "0:0:1",
        message: expect.objectContaining({ id: "duplicate" }),
      }),
      expect.objectContaining({
        key: "0:1:0",
        message: expect.objectContaining({ id: "later-change" }),
      }),
      expect.objectContaining({
        key: "1:0:0",
        message: expect.objectContaining({ id: "later-entry" }),
      }),
    ]);
  });
});
