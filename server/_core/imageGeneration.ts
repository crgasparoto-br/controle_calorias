import { storagePut } from "server/storage";
import { getAiProvider } from "./aiProvider";
import { ENV } from "./env";
import { isOpenAiConfigured } from "./openaiClient";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageSkipReason =
  | "no_prompt"
  | "not_configured"
  | "provider_failed";

export type GenerateImageResponse = {
  url?: string;
  mimeType?: string;
  skippedReason?: GenerateImageSkipReason;
};

function sanitizePrompt(prompt: string) {
  return prompt.trim().slice(0, 4000);
}

function buildPrompt(options: GenerateImageOptions) {
  const prompt = sanitizePrompt(options.prompt);
  if (!prompt) {
    return "";
  }

  if (!options.originalImages?.length) {
    return prompt;
  }

  return [
    prompt,
    "Use a imagem original como base visual principal.",
    "Preserve a foto da refeição sempre que possível e adicione apenas legendas/realces úteis.",
    "Se houver ambiguidades, priorize uma anotação genérica e segura da refeição.",
  ].join("\n\n");
}

/**
 * Auxiliary image generation must never block meal registration or confirmation.
 * When OpenAI image generation is unavailable or fails, this helper returns a
 * skipped result and lets the caller continue the product flow normally.
 */
export async function generateImage(
  options: GenerateImageOptions,
): Promise<GenerateImageResponse> {
  const prompt = buildPrompt(options);
  if (!prompt) {
    return { skippedReason: "no_prompt" };
  }

  if (!isOpenAiConfigured()) {
    return { skippedReason: "not_configured" };
  }

  try {
    const generated = await getAiProvider().createImageGeneration({
      prompt,
      model: ENV.openaiImageModel,
      size: "1024x1024",
      quality: "low",
      outputFormat: "png",
      originalImages: options.originalImages?.filter(image => image.b64Json).map(image => ({
        b64Json: image.b64Json as string,
        mimeType: image.mimeType,
      })),
    });

    const imageBuffer = Buffer.from(generated.b64Json, "base64");
    const storageKey = `generated/meal-support/${Date.now()}.png`;
    const upload = await storagePut(storageKey, imageBuffer, generated.mimeType);

    return {
      url: upload.url,
      mimeType: generated.mimeType,
    };
  } catch {
    return { skippedReason: "provider_failed" };
  }
}
