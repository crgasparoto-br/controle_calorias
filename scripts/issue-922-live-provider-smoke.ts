import { extractWithAi } from "../server/mealAiExtraction";
import { interpretWhatsappMessageWithDiagnostics } from "../server/modules/whatsapp/intentInterpreter";
import type { WhatsappIntentContext } from "../server/modules/whatsapp/intentContext";

import {
  SYNTHETIC_BANANA_IMAGE,
  VISION_EXPECTED_FOOD,
  VISION_SMOKE_PROMPT,
} from "./issue-922-smoke-fixtures";

if (VISION_SMOKE_PROMPT.toLocaleLowerCase("pt-BR").includes(VISION_EXPECTED_FOOD)) {
  throw new Error("MEAL_VISION smoke prompt must not reveal the expected food");
}

function requireProviderConfiguration() {
  const provider = process.env.SMOKE_PROVIDER?.trim();
  const model = process.env.SMOKE_MODEL?.trim();
  if (!provider || !model) {
    throw new Error("SMOKE_PROVIDER and SMOKE_MODEL are required");
  }
  return { provider, model };
}

async function run() {
  const { provider, model } = requireProviderConfiguration();

  const textResult = await extractWithAi({
    text: "Teste sintético: registrar 100 g de banana.",
  });
  if (!textResult) {
    throw new Error("MEAL_TEXT live smoke returned no functional result");
  }
  const recognizedTextFoods =
    textResult.items.map((item) => item.foodName.trim().toLocaleLowerCase("pt-BR"));
  const bananaTextItem = textResult.items.find((item) =>
    item.foodName.trim().toLocaleLowerCase("pt-BR").includes(VISION_EXPECTED_FOOD),
  );
  if (!bananaTextItem || !bananaTextItem.foodClassification) {
    throw new Error("MEAL_TEXT live smoke did not identify banana with embedded NOVA classification");
  }

  const visionResult = await extractWithAi({
    text: VISION_SMOKE_PROMPT,
    imageUrl: SYNTHETIC_BANANA_IMAGE,
  });
  if (!visionResult) {
    throw new Error("MEAL_VISION live smoke returned no functional result");
  }
  const recognizedVisionFoods =
    visionResult.items.map((item) => item.foodName.trim().toLocaleLowerCase("pt-BR"));
  if (!recognizedVisionFoods.some((foodName) => foodName.includes(VISION_EXPECTED_FOOD))) {
    throw new Error("MEAL_VISION live smoke did not identify the food visible only in the image");
  }

  const context: WhatsappIntentContext = {
    version: "whatsapp-intent-context/v2",
    nowIso: "2026-07-28T15:10:00.000Z",
    timezone: "America/Sao_Paulo",
    mealAliases: {},
    currentDomainSnapshot: {
      latestMeal: null,
      mealsToday: [],
      recentFoodNames: [],
    },
    contextualMemories: [],
    pendingClarification: null,
    recentTurns: [{
      direction: "outbound",
      text: "Você quer consultar a lista de refeições registradas de hoje?",
      occurredAtIso: "2026-07-28T15:09:30.000Z",
    }],
    conversationSummary: null,
    conversationActive: true,
    truncated: false,
    contextRead: {
      mode: "legacy",
      flow: "text",
      source: "legacy",
      persistentEligible: false,
      equivalent: null,
      legacyCount: 1,
      persistentCount: 0,
    },
  };
  const intentResult = await interpretWhatsappMessageWithDiagnostics(
    "sim, quero consultar",
    context,
  );
  if (
    intentResult.source !== "llm" ||
    intentResult.validationStatus !== "valid" ||
    intentResult.intent.intent !== "list_meal_records"
  ) {
    throw new Error("WHATSAPP_INTENT live smoke did not resolve the contextual list_meal_records intent");
  }

  console.log(
    JSON.stringify({
      provider,
      model,
      mealTextItems: textResult.items.length,
      mealTextFoods: recognizedTextFoods,
      mealTextProcessingLevel: bananaTextItem.foodClassification.processingLevel,
      mealVisionItems: visionResult.items.length,
      mealVisionFoods: recognizedVisionFoods,
      intentSource: intentResult.source,
      intentValidation: intentResult.validationStatus,
      intentName: intentResult.intent.intent,
    }),
  );
}

await run();
