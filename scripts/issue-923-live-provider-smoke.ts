import { executeResolvedCapability } from "../server/_core/ai/capabilityExecutor";
import { resolveCapabilityConfig } from "../server/_core/ai/configResolver";
import { createDomainTextResponse } from "../server/_core/ai/domainTextResponse";
import { findPackagedSnackByWebSearch } from "../server/catalogSemanticSearch";

function requireVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function configureCapabilities() {
  const provider = requireVariable("SMOKE_PROVIDER");
  const model = requireVariable("SMOKE_MODEL");

  process.env.AI_QUESTION_PROVIDER = provider;
  process.env.AI_QUESTION_MODEL = model;
  process.env.AI_QUESTION_MAX_ATTEMPTS = "1";
  process.env.AI_QUESTION_FALLBACK_ENABLED = "false";
  process.env.AI_QUESTION_WEB_SEARCH_MODE = "auto";

  process.env.AI_NUTRITION_SEARCH_PROVIDER = provider;
  process.env.AI_NUTRITION_SEARCH_MODEL = model;
  process.env.AI_NUTRITION_SEARCH_MAX_ATTEMPTS = "1";
  process.env.AI_NUTRITION_SEARCH_FALLBACK_ENABLED = "false";

  process.env.AI_EMBEDDING_PROVIDER = "openai";
  process.env.AI_EMBEDDING_MODEL = process.env.SMOKE_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  process.env.AI_EMBEDDING_MAX_ATTEMPTS = "1";
  process.env.AI_EMBEDDING_FALLBACK_ENABLED = "false";

  return { provider, model };
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
  const { provider, model } = configureCapabilities();

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

  const nutrition = await findPackagedSnackByWebSearch("KitKat 41,5g", "chocolate");
  if (!nutrition || !nutrition.aliases.some(alias => alias.startsWith("fonte: https://"))) {
    throw new Error("NUTRITION_SEARCH smoke did not return a verified sourced product");
  }

  const embeddingDimensions = await runEmbedding();

  console.log(JSON.stringify({
    provider,
    model,
    questionWithoutSearchExecuted: internalQuestionSearch?.executed === true,
    questionWithSearchExecuted: researchedQuestionSearch.executed,
    questionSourceCount: researchedQuestionSearch.sources.length,
    nutritionMatched: true,
    embeddingDimensions,
  }));
}

await run();
