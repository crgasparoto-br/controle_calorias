import { extractWithAi } from "../server/mealAiExtraction";
import { interpretWhatsappMessageWithDiagnostics } from "../server/modules/whatsapp/intentInterpreter";
import type { WhatsappIntentContext } from "../server/modules/whatsapp/intentContext";

const SYNTHETIC_BANANA_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAAFdElEQVR42u3dzyvsXRzA8TNoRLcoJXsL2ZhrxWbMUFP+CxtL+RfkP7BVFnbWIsXCj4W9slBWtvaPW0Tfu/j2THrU414zmHPO67W63K9i5rzncw5jVIqiCECc+twEIGBAwICAQcCAgAEBAwIGAQMCBgQMAgYEDAgYEDAIGBAwIGBAwCBgQMCAgEHAgIABAQMCBgEDAgYEDAgYBAwIGBAwCBgQMCBgQMAgYEDAgIBBwICAAQEDAgYBAwIGBAwIGAQM9IIBN8HXq1Qqb99ZFIVbBgFHkO4/V40/rFrkvLOirIlvT/fP/fh5IXIEHF+6IkfA33PQ/bJ0RS5g4hu5Xxm51SJg6UZftTUjYOnKGAE76MpYwG4FI1fGApaujK0lAUtXxgjYQVfGApaukStjAUtXxghYujJGwA66MhawkYuMBSxdGSNg6cpYwNJFxgLu8XqlK+OUeFE7ekL5wFruj2RsAhu/prGA1YuMBaxeZOwMjLOxjPObwMavaSxg9SJjW2iwqTaBjV9M48QDVq+MBaxeZOwMDM7GJrDxi2mceMDqJauMbaFJf1OdcMN9xi/JZ9x+xUIBqxcNC1i9IGDIfAincL7PZ/yW31btymrOM+MfPy9S+7FL7F9PLPV2pb1u3Vk5vzRnYg37MVKOi6b8ZPL8azLlXjqZhuP+Snp//EbxXIIMS05mDg+o1yppf5Je9d4EVm/0j/GZDOQ0hrAzsMXxzkBOteQ0DsNRfgG9PH6TfAJ9wlvr2OdwfAH3eL1pv0RRkgM56nvNFto6yH1rHfVeOrKAe3b8Jl/v/5Tsu9a20BHX64UR0xjIkT4ERxNwz9brpYmTKTnGe9MZWL221hEfhuMIuAd/EUy975Yc40COruHIzsC9sBocepPfWkf06BzTFvr14/p3LQWDN8OttQmcyDRWb0o7qTTu6+h/nfDLloJ6c8s4ins8kZfU+dSl4ND7qfedhnMP+FMzNngzH8U9vgAqfm9GvTKOdxmk9kSOLn6nWr3fcsf5HnXWE7grD+oOvUZxLI/mleSX6d8uCIO3R+41DQv4rzNWr1FsAse6JtQr4+jOU5UMl+zbNeHQa0cd6WN6JdtV287Y4DWK492RVTJfu2n/+XajOMlts4AxiuMevG3+PjCRKYqiKIpu/aXVqOs1gTGKI65XwMg4skOvgEkz4w83HPWPIQRM1qPY30aCKEdxGs/eETA5juJknr0jYLLLOKXn3gmYjHbU6T3pXcDkMoqTfNK7gMkl4ySXuqdSkoVUB5WAQcCAgAEBf53h4eFms9loNGZnZw8ODsp37uzsDA4O3t/fl28ODQ0tLi62P2R0dLT97w9fCQLugmq1en5+fnFxsbu7u7a2Vr7z4OBgfX396OiofHNwcPD5+fn8/Pzth3/4ShBwN83MzAwMDIQQfv369fDwsLq6enh42P7fzc3NjY2N/3xIh1eCgLvm9PR0a2srhHB8fLy8vDw1NXV3d/f09FT+79LSUgjh7Ozs9Yd0eCWE8O8LlPAxQ0NDjUZjfn6+v7+/1WoVRbGyslKr1ebm5iYmJk5OToqiGBkZKYri7OysXq+33+zwSigNeAjr/AwcQri+vq7X6y8vL7e3t1dXV+XYPDw8bLVa5ZXNZrO/v//09LR8sytXgi10d4yNjU1OTl5eXtZqtfI99Xr95OTk9TWvz7fdupLMmcAdeXp6ajabfX19IYTt7e29vb3yEBtCGB4eHh8fv7m5aV+8sLBQrVYfHx9DCPv7+51cOT097cYn+GUGsIUGBAwIGAQMCBgQMCBgEDAgYEDAIGBAwICAAQGDgAEBAwIGBAwCBgQMCBgEDAgYEDAgYBAwIGBAwICAQcCAgAEBg4ABAQOf7je48cPpozOFDQAAAABJRU5ErkJggg==";

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
    text: "A imagem sintética contém uma banana identificada também pela palavra BANANA.",
    imageUrl: SYNTHETIC_BANANA_IMAGE,
  });
  if (!visionResult || visionResult.items.length < 1) {
    throw new Error("MEAL_VISION live smoke failed");
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
      intentSource: intentResult.source,
      intentValidation: intentResult.validationStatus,
    }),
  );
}

await run();
