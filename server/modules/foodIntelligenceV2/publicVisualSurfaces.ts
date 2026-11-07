/** #1308 D1: the vision model extracts visual SURFACES, never food decisions. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AiProviderTextRequest } from "../../_core/aiProvider";
import { decodeStrictBase64, parseBase64DataUrl } from "../../_core/imageBase64";
import { executeResolvedCapability } from "../../_core/ai/capabilityExecutor";
import { resolveCapabilityConfig } from "../../_core/ai/configResolver";
import { createDomainTextResponse } from "../../_core/ai/domainTextResponse";
import { parseJsonOutput } from "../../_core/ai/policyExecutor";
import type { ProcessMealDraftInput } from "../meals/schemas";
import { isValidFoodSha256HexDigest } from "./contracts";

export type FoodD1VisualKind = "plate_image" | "packaging";
const foodD1VisualKindSchema = z.union([
  z.literal("plate_image").transform(kind => ({
    kind,
    imageRegionRole: "caption" as const,
  })),
  z.literal("packaging").transform(kind => ({
    kind,
    imageRegionRole: "front_identity" as const,
  })),
]);
export type FoodD1VisualSelection = z.output<typeof foodD1VisualKindSchema>;
const foodD1VisualMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function parseFoodD1VisualKind(
  value: unknown
): FoodD1VisualSelection | null {
  const parsed = foodD1VisualKindSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isValidD1VisualContentDigest(value: unknown): value is string {
  return isValidFoodSha256HexDigest(value);
}

export type FoodD1VisualInput = {
  image: NonNullable<ProcessMealDraftInput["image"]>;
  kind: FoodD1VisualKind;
};
export type FoodD1VisualSurfaces = {
  surfaces: string[];
  contentDigest: string;
};

const MAX_D1_IMAGE_BYTES = 8 * 1024 * 1024;
const visualResultSchema = z.strictObject({
  surfaces: z.array(z.string().trim().min(1).max(240)).max(30),
});
const visualResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    surfaces: {
      type: "array", minItems: 0, maxItems: 30,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
  },
  required: ["surfaces"],
} as const;

function matchesMimeMagic(bytes: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") {
    return bytes.length > 3 && bytes[0] === 0xff &&
      bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return bytes.length > 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === "image/webp") {
    return bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

/** Validate raw byte provenance and MIME BEFORE any network/provider call. */
export function prepareD1VisualMedia(image: FoodD1VisualInput["image"]) {
  const parsedMime = foodD1VisualMimeSchema.safeParse(image.mimeType?.toLowerCase());
  if (!parsedMime.success) {
    throw new Error("food-d1-visual-unsupported-mime");
  }
  const mime = parsedMime.data;
  if (image.base64.length > Math.ceil(MAX_D1_IMAGE_BYTES * 4 / 3) + 100) {
    throw new Error("food-d1-visual-media-too-large");
  }
  let encoded = image.base64;
  if (encoded.startsWith("data:")) {
    const parsed = parseBase64DataUrl(encoded);
    if (!parsed || parsed.mimeType.toLowerCase() !== mime) {
      throw new Error("food-d1-visual-media-mime-mismatch");
    }
    encoded = parsed.base64;
  }
  let decoded: ReturnType<typeof decodeStrictBase64>;
  try { decoded = decodeStrictBase64(encoded, MAX_D1_IMAGE_BYTES); }
  catch { throw new Error("food-d1-visual-invalid-base64"); }
  if (!matchesMimeMagic(decoded.buffer, mime!)) {
    throw new Error("food-d1-visual-media-mime-mismatch");
  }
  return {
    url: `data:${mime};base64,${decoded.compact}`,
    contentDigest: createHash("sha256").update(decoded.buffer).digest("hex"),
  };
}

/** Decode only transport media URLs containing a supported image payload. */
export function parseD1VisualMediaDataUrl(dataUrl: string) {
  const parsed = parseBase64DataUrl(dataUrl);
  if (!parsed || !foodD1VisualMimeSchema.safeParse(parsed.mimeType).success) {
    throw new Error("food-d1-whatsapp-visual-normalized-media-required");
  }
  const prepared = prepareD1VisualMedia({ base64: parsed.base64, mimeType: parsed.mimeType });
  return {
    base64: prepared.url.split(",", 2)[1],
    mimeType: parsed.mimeType,
    contentDigest: prepared.contentDigest,
  };
}

/** A scene with no observable food is a valid model answer, not a meal. */
export function parseD1VisualSurfaces(raw: unknown): string[] {
  const parsed = visualResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error("food-d1-visual-invalid-provider-evidence");
  if (parsed.data.surfaces.length === 0) throw new Error("food-d1-visual-no-observable-food");
  return parsed.data.surfaces;
}

/**
 * The only output of MEAL_VISION is a set of observations for the governed
 * linguistic comprehension layer. No food entity, brand policy, calories or
 * nutrition profile can enter here as an authoritative decision.
 */
export async function extractD1VisualSurfaces(
  input: FoodD1VisualInput,
): Promise<FoodD1VisualSurfaces> {
  if (input.kind !== "plate_image" && input.kind !== "packaging") {
    throw new Error("food-d1-visual-unsupported-kind");
  }
  const prepared = prepareD1VisualMedia(input.image);
  const config = resolveCapabilityConfig("MEAL_VISION");
  if ((config.state !== "ready" && config.state !== "degraded") || !config.primary) {
    throw new Error("food-d1-visual-capability-unavailable");
  }
  const prompt = input.kind === "plate_image"
    ? "Liste os alimentos e bebidas literalmente visíveis no prato, um item por superfície. Descreva apenas o que é observável; quantidade só quando realmente mensurável. Não estime gramatura, calorias ou composição nutricional. Não inclua objetos, ingredientes inferidos ou comida ausente."
    : "Transcreva as identidades de produtos alimentares literalmente legíveis na frente das embalagens, uma superfície por produto distinto. Não inclua lista de ingredientes, tabela nutricional ou afirmação de valor verificado. Não infira marca, versão, quantidade ou item ilegível.";
  const content: Array<
    { type: "input_text"; text: string } |
    { type: "input_image"; image_url: string; detail: "high" }
  > = [
    { type: "input_text", text: prompt },
    { type: "input_image", image_url: prepared.url, detail: "high" },
  ];
  const aiInput: AiProviderTextRequest["input"] = [{
    role: "user", content,
  }];
  const response = await executeResolvedCapability(config, async context => {
    const result = await createDomainTextResponse(context.provider, {
      model: context.model,
      instructions: "Extraia somente superfícies visuais de alimentos em português. Não resolva identidade canônica, quantidade estimada ou nutrição. Retorne exclusivamente o JSON do schema solicitado. Se não houver evidência observável, não invente alimentos.",
      input: aiInput,
      format: {
        type: "json_schema",
        name: "food_d1_visual_surfaces",
        schema: visualResultJsonSchema,
        strict: true,
      },
    }, { signal: context.signal });
    return parseD1VisualSurfaces(parseJsonOutput(result));
  }, {
    observability: { origin: "web", flow: "meal_vision_extraction" },
  });
  return { surfaces: response.value, contentDigest: prepared.contentDigest };
}
