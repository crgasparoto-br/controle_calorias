import { extractWithAi } from "../server/mealAiExtraction";
import { interpretWhatsappMessageWithDiagnostics } from "../server/modules/whatsapp/intentInterpreter";
import type { WhatsappIntentContext } from "../server/modules/whatsapp/intentContext";

const SYNTHETIC_BANANA_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAAFbUlEQVR42u3dPXLTehTGYZExBR0FG0iVjh3QULAUFpWlpKBhB3RUbICCjoLCFJrRZJJYkWR9nHP+z1PdYbgz90b6+ZVsx35zPp87IKcbPwIQMCBgQMAgYEDAgIABAYOAAQEDAgYBAwIGBAwIGAQMCBgQMCBgEDAgYEDAIGBAwICAAQGDgAEBAwIGBAwCBgQMCBgEDAgYEDAgYBAwIGBAwCBgQMCAgAEBg4ABAQMCBgQMAgYiOPkR7OzTx/fjf+H7jz9+Sgg4aLoP93dXFi57Bm/O57OfQpB0r/Hl689l/6LyBcyR6W5dvsIFLN3EhsKVLOBWuq2RrpIFbHJf8O72c9d1f399UzICTpNu3+1GDnk4ULKApRvUrEcEJQu4YLoZu1WygOt3O55ujW6VLGCTu9P96s4PGctKFrOAg6Y7vZ/4zzzPfSwwywLOmm6lbpUsYOlW6FbJAk7f7aV0a0+ukgVcc3Ib7/b6mJUs4APS1a2SBVw53Za73b9kGQv4lXRNbuRbZRkL+OV0dZuoZBk3HfCnj+8XpKvbaCV/+fpTw+0GbHILlGyKmwv48fyOn0m6DRWzjAU86eJZt2FLHj80LV9RNxHwk3qfnzfSTVGyKX6u6Q92123Mw3Gp5He3ny8dsv4Bun+JoamM6y/wi/NL6kF+9Yq6nYyLB6zeNhtu58ZYwJhiAauXwFNcOOOyAatXxi1cUdcMWL0abmSKBYyMBaxewjTc1BV1tYDVK+OmpljAtD7FqTMuFbB6Zbyg4dRX1HUCVi8NXlEXCVi9rDXFuTIWMDJOnPFNjXqdskysdMrnBzzc3z3c36U4r9IvcP9Tvv3w9tfvf7lG+PH3bi7muqPxKa4Q8O2Ht/0/Z2l4xdNirZUo/EBwZcPBM84d8DC/w5/EbzjmKxZTvr5cxgEPXOKAn9cbv+HgrzeOfzljyYan19vfpkU7fKdi9fZ/2F/zhDoLUzyxOfznlRzkvtW5n00dXNYFfnzre0mcKU76Rp+qgzw0PGt+h5Mq1KE8Ja13yl/rp/jYky/1W22rDnKlKc63wCMXz9F2uNinQNS+Q54yvwFHOOUCT6/3qB0u+eEPte+QLXCUW9/Dd7iRDzRtYZCfz2+0Ec4U8OJ692y4we/pqTrIl+oN1fAp11ly5YX3ptfSzX49T/+/3OYdsgXeaX633mFfOV1skMfnN84InxKdE6tYfYd9Ra1BtsAzMl5rh1c5twxvyUGeMr9BRrj+68AbXU4b3mXXUPFLnl6vgI/PeFnDhrfwIM8K+PCGq/064Q4Nq7dwxrnq7Wp8Jtb1GU9s2GVz+Yxn3f1GOBlKfazsNRm/2rDhLZ9xoueuBqcy58HjVy9WeYrL8O584LI8U+2XGTJlbHh3O3DHTvHE+Y32+8Blv+B7VsYvXj8b3qOO2v4NT3zfVcDz4VT4VLhmjQ1vs1OcYnibCHhxxuqNc8j2+QWy8RMjbL1NBDwrY5fNAQ/ZsVMcud7i98AT742HG2DDG/l4bZTxyPzGvOkV8NOM++NkeOMfr41+DzT4Z24I+PWMpdvmFGevV8C0m3GBert2nsSijO2e3Epx02uBMcXRP+15uhvnAXmn+PuPP6t8zXLSei0wLU7xk/nNW6+AaS7jJ99U1iV/DcKTWNS5ou7mPLmVangtMC1O8TC/NertPIlFySkef3KrTL0WmIameEi60hvv3ANT/654yLjee2YtMK2sccl3vAsYEvMkFggYEDAgYBAwIGBAwICAQcCAgAEBg4ABAQMCBgQMAgYEDAgYEDAIGBAwIGAQMCBgQMCAgEHAgIABAQMCBgEDAgYEDAIGBAwIGBAwCBgQMCBgEDAgYEDAgIBBwICAga38B0K0rbmlpAsUAAAAAElFTkSuQmCC";

const VISION_SMOKE_PROMPT =
  "Identifique e extraia somente os alimentos visíveis na imagem sintética. Não use suposições fora da imagem.";
const VISION_EXPECTED_FOOD = "banana";

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
  if (!textResult || textResult.items.length < 1) {
    throw new Error("MEAL_TEXT live smoke failed");
  }

  const visionResult = await extractWithAi({
    text: VISION_SMOKE_PROMPT,
    imageUrl: SYNTHETIC_BANANA_IMAGE,
  });
  const recognizedVisionFoods =
    visionResult?.items.map((item) => item.foodName.trim().toLocaleLowerCase("pt-BR")) ?? [];
  if (!recognizedVisionFoods.some((foodName) => foodName.includes(VISION_EXPECTED_FOOD))) {
    throw new Error("MEAL_VISION live smoke did not identify the food visible only in the image");
  }

  const context: WhatsappIntentContext = {
    version: "whatsapp-intent-context/v1",
    nowIso: "2026-07-28T15:10:00.000Z",
    timezone: "America/Sao_Paulo",
    mealAliases: {},
    latestMeal: null,
    mealsToday: [],
    recentFoodNames: [],
    contextualMemories: [],
    pendingClarification: null,
  };
  const intentResult = await interpretWhatsappMessageWithDiagnostics(
    "registro",
    context,
  );
  if (
    intentResult.source !== "llm" ||
    intentResult.validationStatus !== "valid"
  ) {
    throw new Error("WHATSAPP_INTENT live smoke failed");
  }

  console.log(
    JSON.stringify({
      provider,
      model,
      mealTextItems: textResult.items.length,
      mealVisionItems: visionResult.items.length,
      mealVisionFoods: recognizedVisionFoods,
      intentSource: intentResult.source,
      intentValidation: intentResult.validationStatus,
    }),
  );
}

await run();
