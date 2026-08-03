import { execFileSync } from "node:child_process";
import { executeResolvedCapability } from "../server/_core/ai/capabilityExecutor";
import { resolveCapabilityConfig } from "../server/_core/ai/configResolver";
import { createDomainTextResponse } from "../server/_core/ai/domainTextResponse";

const nutritionSmokeJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    found: { type: "boolean" },
    matchedProductName: { type: "string" },
    brandName: { type: "string" },
    servingLabel: { type: "string" },
    gramsPerServing: { type: "number", minimum: 0, maximum: 1000 },
    calories: { type: "number", minimum: 0, maximum: 5000 },
    protein: { type: "number", minimum: 0, maximum: 500 },
    carbs: { type: "number", minimum: 0, maximum: 500 },
    fat: { type: "number", minimum: 0, maximum: 500 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    sourceUrl: { type: "string" },
    evidence: { type: "string" },
  },
  required: [
    "found",
    "matchedProductName",
    "brandName",
    "servingLabel",
    "gramsPerServing",
    "calories",
    "protein",
    "carbs",
    "fat",
    "confidence",
    "sourceUrl",
    "evidence",
  ],
} as const;

type NutritionSmokePayload = {
  found: boolean;
  matchedProductName: string;
  brandName: string;
  servingLabel: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  sourceUrl: string;
  evidence: string;
};

function requireVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function configureCapabilities() {
  const provider = requireVariable("SMOKE_PROVIDER");
  const sharedModel = process.env.SMOKE_MODEL?.trim();
  const questionModel = process.env.SMOKE_QUESTION_MODEL?.trim() || sharedModel;
  const nutritionModel = process.env.SMOKE_NUTRITION_MODEL?.trim() || sharedModel;
  if (!questionModel) throw new Error("SMOKE_QUESTION_MODEL or SMOKE_MODEL is required");
  if (!nutritionModel) throw new Error("SMOKE_NUTRITION_MODEL or SMOKE_MODEL is required");

  process.env.AI_QUESTION_PROVIDER = provider;
  process.env.AI_QUESTION_MODEL = questionModel;
  process.env.AI_QUESTION_MAX_ATTEMPTS = "1";
  process.env.AI_QUESTION_FALLBACK_ENABLED = "false";
  process.env.AI_QUESTION_WEB_SEARCH_MODE = "auto";

  process.env.AI_NUTRITION_SEARCH_PROVIDER = provider;
  process.env.AI_NUTRITION_SEARCH_MODEL = nutritionModel;
  process.env.AI_NUTRITION_SEARCH_MAX_ATTEMPTS = "1";
  process.env.AI_NUTRITION_SEARCH_FALLBACK_ENABLED = "false";

  process.env.AI_EMBEDDING_PROVIDER = "openai";
  process.env.AI_EMBEDDING_MODEL = process.env.SMOKE_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  process.env.AI_EMBEDDING_MAX_ATTEMPTS = "1";
  process.env.AI_EMBEDDING_FALLBACK_ENABLED = "false";

  return { provider, questionModel, nutritionModel };
}

function resolveHeadSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function parseNutritionSmokePayload(outputText: string): NutritionSmokePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error("NUTRITION_SEARCH smoke returned invalid JSON", { cause: error });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("NUTRITION_SEARCH smoke returned a non-object payload");
  }

  const payload = parsed as Partial<NutritionSmokePayload>;
  const stringFields: Array<keyof NutritionSmokePayload> = [
    "matchedProductName",
    "brandName",
    "servingLabel",
    "sourceUrl",
    "evidence",
  ];
  const numberFields: Array<keyof NutritionSmokePayload> = [
    "gramsPerServing",
    "calories",
    "protein",
    "carbs",
    "fat",
    "confidence",
  ];

  if (typeof payload.found !== "boolean") {
    throw new Error("NUTRITION_SEARCH smoke omitted the found flag");
  }
  if (stringFields.some(field => typeof payload[field] !== "string")) {
    throw new Error("NUTRITION_SEARCH smoke returned an invalid string field");
  }
  if (numberFields.some(field => typeof payload[field] !== "number" || !Number.isFinite(payload[field] as number))) {
    throw new Error("NUTRITION_SEARCH smoke returned an invalid numeric field");
  }

  if (payload.found) {
    if (
      !payload.matchedProductName?.trim()
      || !payload.sourceUrl?.trim()
      || !payload.evidence?.trim()
      || (payload.gramsPerServing as number) <= 0
      || (payload.calories as number) <= 0
      || (payload.protein as number) < 0
      || (payload.carbs as number) < 0
      || (payload.fat as number) < 0
      || (payload.confidence as number) < 0
      || (payload.confidence as number) > 1
    ) {
      throw new Error("NUTRITION_SEARCH smoke returned an incomplete matched payload");
    }
  }

  return payload as NutritionSmokePayload;
}

async function runQuestion(prompt: string) {
  const policy = resolveCapabilityConfig("QUESTION");
  if (!policy.primary || (policy.state !== "ready" && policy.state !== "degraded")) {
    throw new Error(`QUESTION smoke is not executable (state=${policy.state})`);
  }
  const result = await executeResolvedCapability(policy, attempt =>
    createDomainTextResponse(
      attempt.provider,
      {
        model: attempt.model,
        instructions: "Responda de forma curta e siga literalmente a solicitação do usuário.",
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        tools: [{ type: "web_search" }],
      },
      { signal: attempt.signal },
    ),
  );
  if (!result.value.outputText.trim()) throw new Error("QUESTION smoke returned empty output");
  return result.value.webSearch;
}

async function runNutrition(nutritionQuery: string) {
  const policy = resolveCapabilityConfig("NUTRITION_SEARCH");
  if (!policy.primary || (policy.state !== "ready" && policy.state !== "degraded")) {
    throw new Error(`NUTRITION_SEARCH smoke is not executable (state=${policy.state})`);
  }

  const result = await executeResolvedCapability(policy, attempt =>
    createDomainTextResponse(
      attempt.provider,
      {
        model: attempt.model,
        instructions: [
          "Você pesquisa informações nutricionais de produtos alimentícios embalados no Brasil.",
          "Use busca na internet para encontrar o produto mais específico possível por nome, marca, variação e embalagem.",
          "Prefira página oficial da marca, varejo com tabela nutricional ou banco nutricional reconhecido.",
          "Não use média genérica quando houver dúvida sobre o SKU, sabor, peso ou marca; nesse caso retorne found=false.",
          "Retorne apenas JSON válido no schema solicitado.",
        ].join("\n"),
        input: [{
          role: "user",
          content: [{
            type: "input_text",
            text: [
              `Alimento reconhecido: ${nutritionQuery}`,
              "Categoria provável: chocolate/bombom/wafer embalado",
              "Busque calorias, proteínas, carboidratos e gorduras da porção mais específica do produto.",
              "Se o produto for normalmente vendido por unidade, use 1 unidade como porção quando a fonte informar peso/valores por unidade.",
              "Se a fonte trouxer valores por 100 g e peso da unidade, converta para a unidade. Se não houver peso confiável, retorne found=false.",
              "Preencha sourceUrl com a melhor fonte usada e evidence com uma frase curta explicando a evidência.",
            ].join("\n"),
          }],
        }],
        tools: [{ type: "web_search" }],
        format: {
          type: "json_schema",
          name: "packaged_food_nutrition_live_smoke",
          schema: nutritionSmokeJsonSchema,
          strict: true,
        },
      },
      { signal: attempt.signal },
    ),
  );

  const payload = parseNutritionSmokePayload(result.value.outputText);
  const webSearch = result.value.webSearch;
  const hasVerifiedSearch = webSearch?.executed === true && webSearch.sources.length > 0;

  if (payload.found && hasVerifiedSearch) {
    return {
      matched: true,
      outcome: "matched-provider-payload" as const,
      sourceCount: webSearch.sources.length,
      attempts: 1,
    };
  }

  return {
    matched: false,
    outcome: payload.found ? "safe-unverified-match" as const : "safe-no-match" as const,
    sourceCount: webSearch?.sources.length ?? 0,
    attempts: 1,
  };
}

async function runEmbedding() {
  const policy = resolveCapabilityConfig("EMBEDDING");
  if (!policy.primary || (policy.state !== "ready" && policy.state !== "degraded")) {
    throw new Error(`EMBEDDING smoke is not executable (state=${policy.state})`);
  }
  const result = await executeResolvedCapability(policy, async attempt => {
    const response = await attempt.provider.createEmbeddings(
      { model: attempt.model, input: ["banana madura"] },
      { signal: attempt.signal },
    );
    return response.embeddings;
  });
  const vector = result.value[0];
  if (!Array.isArray(vector) || !vector.length || vector.some(value => !Number.isFinite(value))) {
    throw new Error("EMBEDDING smoke returned an invalid vector");
  }
  return vector.length;
}

async function run() {
  const headSha = resolveHeadSha();
  const { provider, questionModel, nutritionModel } = configureCapabilities();

  const internalQuestionSearch = await runQuestion(
    "Sem pesquisar na internet, responda apenas com o resultado numérico de 2 + 2.",
  );
  if (internalQuestionSearch?.executed) {
    throw new Error("QUESTION auto smoke unexpectedly executed web search for an internal-only question");
  }

  const researchedQuestionSearch = await runQuestion(
    "Pesquise na web a documentação oficial da OpenAI sobre a ferramenta web_search da Responses API e responda com uma frase curta baseada na fonte.",
  );
  if (!researchedQuestionSearch?.executed || !researchedQuestionSearch.sources.length) {
    throw new Error("QUESTION web-search smoke did not return executed search with sources");
  }

  const nutritionQuery = process.env.SMOKE_NUTRITION_QUERY?.trim() || "KitKat ao leite 41,5g";
  const nutritionResult = await runNutrition(nutritionQuery);
  const embeddingDimensions = await runEmbedding();

  console.log(JSON.stringify({
    headSha,
    provider,
    questionModel,
    nutritionModel,
    nutritionQuery,
    nutritionAttempts: nutritionResult.attempts,
    nutritionOutcome: nutritionResult.outcome,
    nutritionSourceCount: nutritionResult.sourceCount,
    questionWithoutSearchExecuted: internalQuestionSearch?.executed === true,
    questionWithSearchExecuted: researchedQuestionSearch.executed,
    questionSourceCount: researchedQuestionSearch.sources.length,
    nutritionMatched: nutritionResult.matched,
    embeddingDimensions,
  }));
}

await run();
