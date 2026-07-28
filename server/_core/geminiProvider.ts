import {
  GoogleGenAI,
  type Content,
  type ContentListUnion,
  type GenerateContentConfig,
  type Part,
} from "@google/genai";
import { AiNonRetryableError, AiOperationalError } from "./ai/policyExecutor";
import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderEmbeddingRequest,
  AiProviderEmbeddingResponse,
  AiProviderImageGenerationRequest,
  AiProviderImageGenerationResponse,
  AiProviderRequestOptions,
  AiProviderTextRequest,
  AiProviderTextResponse,
} from "./aiProvider";

/**
 * Gemini adapter built on `@google/genai` using `models.generateContent`.
 *
 * Structured output uses `responseJsonSchema` so the JSON Schema used by the
 * existing meal consumer is preserved instead of being lossy-converted to the
 * smaller OpenAPI-style `Schema` type. Unsupported constructs, input parts and
 * tools are rejected locally before any network call.
 */
function incompatibleOperation(message: string): AiNonRetryableError {
  return new AiNonRetryableError(message, undefined, "incompatible_operation");
}

function invalidPayload(message: string): AiOperationalError {
  return new AiOperationalError(message, undefined, "invalid_payload");
}

function buildInlineImagePart(imageUrl: string, path: string): Part {
  const commaIndex = imageUrl.indexOf(",");
  if (commaIndex < 0) {
    throw invalidPayload(`GeminiProvider: ${path} contains a malformed data URL.`);
  }

  const header = imageUrl.slice(0, commaIndex);
  const data = imageUrl.slice(commaIndex + 1);
  const headerMatch = /^data:([^;,]+);base64$/i.exec(header);
  if (!headerMatch || !data.trim()) {
    throw invalidPayload(
      `GeminiProvider: ${path} must contain a non-empty base64 data URL with an explicit MIME type.`,
    );
  }

  return { inlineData: { mimeType: headerMatch[1], data } };
}

function buildGeminiParts(contentItems: AiProviderTextRequest["input"]): Part[] {
  if (typeof contentItems === "string") {
    if (!contentItems.trim()) {
      throw invalidPayload("GeminiProvider: direct text input must not be empty.");
    }
    return [{ text: contentItems }];
  }

  if (!Array.isArray(contentItems) || contentItems.length === 0) {
    throw invalidPayload("GeminiProvider: request input must contain at least one message.");
  }

  const parts: Part[] = [];
  for (const [messageIndex, message] of contentItems.entries()) {
    const messagePath = `input[${messageIndex}]`;
    if (typeof message !== "object" || message === null || !("content" in message)) {
      throw invalidPayload(`GeminiProvider: ${messagePath} must declare content.`);
    }

    const content = (message as unknown as Record<string, unknown>).content;
    const items = Array.isArray(content) ? content : [content];
    if (items.length === 0) {
      throw invalidPayload(`GeminiProvider: ${messagePath}.content must not be empty.`);
    }

    for (const [itemIndex, item] of items.entries()) {
      const itemPath = `${messagePath}.content[${itemIndex}]`;
      if (typeof item === "string") {
        if (!item.trim()) {
          throw invalidPayload(`GeminiProvider: ${itemPath} must not be empty.`);
        }
        parts.push({ text: item });
        continue;
      }

      if (typeof item !== "object" || item === null) {
        throw invalidPayload(`GeminiProvider: ${itemPath} is not a valid content part.`);
      }

      const part = item as Record<string, unknown>;
      if (part.type === "input_text") {
        if (typeof part.text !== "string" || !part.text.trim()) {
          throw invalidPayload(`GeminiProvider: ${itemPath}.text must be a non-empty string.`);
        }
        parts.push({ text: part.text });
        continue;
      }

      if (part.type === "input_image") {
        if (typeof part.image_url !== "string" || !part.image_url.trim()) {
          throw invalidPayload(`GeminiProvider: ${itemPath}.image_url must be a non-empty string.`);
        }

        const imageUrl = part.image_url;
        if (imageUrl.startsWith("data:")) {
          parts.push(buildInlineImagePart(imageUrl, `${itemPath}.image_url`));
        } else {
          parts.push({
            fileData: {
              mimeType: "image/jpeg",
              fileUri: imageUrl,
            },
          });
        }
        continue;
      }

      throw incompatibleOperation(
        `GeminiProvider: ${itemPath} uses unsupported content part type ${String(part.type)}.`,
      );
    }
  }

  return parts;
}

function buildSystemInstruction(instructions: string | undefined): Content | undefined {
  if (!instructions) return undefined;
  return { role: "user", parts: [{ text: instructions }] };
}

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
]);

const SUPPORTED_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

type JsonSchemaRecord = Record<string, unknown>;

function schemaError(path: string, message: string): never {
  throw incompatibleOperation(`GeminiProvider: JSON Schema at ${path} ${message}`);
}

function asSchemaRecord(value: unknown, path: string): JsonSchemaRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    schemaError(path, "must be an object.");
  }
  return value as JsonSchemaRecord;
}

function assertString(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "string" || !value.trim()) {
    schemaError(path, `requires a non-empty string for "${keyword}".`);
  }
}

function assertStringArray(value: unknown, path: string, keyword: string): void {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
    schemaError(path, `requires an array of non-empty strings for "${keyword}".`);
  }
}

function assertNonNegativeInteger(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    schemaError(path, `requires a non-negative integer for "${keyword}".`);
  }
}

function assertFiniteNumber(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    schemaError(path, `requires a finite number for "${keyword}".`);
  }
}

function assertSchemaType(value: unknown, path: string): void {
  const values = Array.isArray(value) ? value : [value];
  if (
    values.length === 0 ||
    values.some(item => typeof item !== "string" || !SUPPORTED_SCHEMA_TYPES.has(item)) ||
    new Set(values).size !== values.length
  ) {
    schemaError(path, "declares an unsupported or duplicated type.");
  }
}

function assertSchemaMapShape(value: unknown, path: string, keyword: string): void {
  const map = asSchemaRecord(value, path);
  for (const [name, schema] of Object.entries(map)) {
    assertSchemaShape(schema, `${path}.${keyword}.${name}`);
  }
}

function assertSchemaArrayShape(value: unknown, path: string, keyword: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    schemaError(path, `requires a non-empty schema array for "${keyword}".`);
  }
  value.forEach((schema, index) => assertSchemaShape(schema, `${path}.${keyword}[${index}]`));
}

function assertSchemaShape(value: unknown, path = "$"²È="25˜€ôôô€ˆŒˆ¤É•ÑÕÉ¸É½½Ðì(€¥˜€ …É•˜¹ÍÑ…ÉÑÍ]¥Ñ  ˆŒ¼ˆ¤¤ì(€€€Í¡•µ…ÉÉ½È¡Á…Ñ °ÕÍ•Ì•áÑ•É¹…°½ÈÕ¹ÍÕÁÁ½ÉÑ•É•™•É•¹”€ˆ‘íÉ•™ôˆ¹€¤ì(€ô((€±•ÐÕÉÉ•¹ÐèÕ¹­¹½Ý¸€ôÉ½½Ðì(€™½È€¡½¹ÍÐÉ…ÝM•µ•¹Ð½˜É•˜¹Í±¥” È¤¹ÍÁ±¥Ð ˆ¼ˆ¤¤ì(€€€½¹ÍÐÍ•µ•¹Ð€ô‘•½‘•A½¥¹Ñ•ÉM•µ•¹Ð¡É…ÝM•µ•¹Ð°Á…Ñ ¤ì(€€€¥˜€¡ÑåÁ•½˜ÕÉÉ•¹Ð€„ôô€‰½‰©•ÐˆñðÕÉÉ•¹Ð€ôôô¹Õ±°ñðÉÉ…ä¹¥ÍÉÉ…ä¡ÕÉÉ•¹Ð¤ñð€„¡Í•µ•¹Ð¥¸ÕÉÉ•¹Ð¤¤ì(€€€€€Í¡•µ…ÉÉ½È¡Á…Ñ °É•™•É•¹•Ìµ¥ÍÍ¥¹œÑ…É•Ð€ˆ‘íÉ•™ôˆ¹€¤ì(€€€ô(€€€ÕÉÉ•¹Ð€ô€¡ÕÉÉ•¹Ð…Ì)Í½¹M¡•µ…I•½É¥mÍ•µ•¹Ñtì(€ô((€É•ÑÕÉ¸…ÍM¡•µ…I•½É¡ÕÉÉ•¹Ð°€‘íÁ…Ñ¡ô€´ø€‘íÉ•™õ€¤ì)ô()™Õ¹Ñ¥½¸Ù¥Í¥Ñ¡¥±‘M¡•µ…Ì (€Í¡•µ„è)Í½¹M¡•µ…I•½É°(€Á…Ñ èÍÑÉ¥¹œ°(€Ù¥Í¥Ñ½Èè€¡¡¥±è)Í½¹M¡•µ…I•½É°¡¥±‘A…Ñ èÍÑÉ¥¹œ°½ÁÑ¥½¹…±‘”è‰½½±•…¸¤€ôøÙ½¥°(¤èÙ½¥ì(€½¹ÍÐÉ•ÅÕ¥É•€ô¹•ÜM•Ð (€€€ÉÉ…ä¹¥ÍÉÉ…ä¡Í¡•µ„¹É•ÅÕ¥É•¤(€€€€€€üÍ¡•µ„¹É•ÅÕ¥É•¹™¥±Ñ•È ¡¥Ñ•´¤è¥Ñ•´¥ÌÍÑÉ¥¹œ€ôøÑåÁ•½˜¥Ñ•´€ôôô€‰ÍÑÉ¥¹œˆ¤(€€€€€€èmt°(€€¤ì((€¥˜€¡ÑåÁ•½˜Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì€ôôô€‰½‰©•Ðˆ€˜˜Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì€„ôô¹Õ±°€˜˜€…ÉÉ…ä¹¥ÍÉÉ…ä¡Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì¤¤ì(€€€™½È€¡½¹ÍÐm¹…µ”°¡¥±‘t½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì…Ì)Í½¹M¡•µ…I•½É¤¤ì(€€€€€Ù¥Í¥Ñ½È¡…ÍM¡•µ…I•½É¡¡¥±°€‘íÁ…Ñ¡ô¹ÁÉ½Á•ÉÑ¥•Ì¸‘í¹…µ•õ€¤°€‘íÁ…Ñ¡ô¹ÁÉ½Á•ÉÑ¥•Ì¸‘í¹…µ•õ€°€…É•ÅÕ¥É•¹¡…Ì¡¹…µ”¤¤ì(€€€ô(€ô(€¥˜€¡Í¡•µ„¹¥Ñ•µÌ€„ôôÕ¹‘•™¥¹•¤ì(€€€Ù¥Í¥Ñ½È¡…ÍM¡•µ…I•½É¡Í¡•µ„¹¥Ñ•µÌ°€‘íÁ…Ñ¡ô¹¥Ñ•µÍ€¤°€‘íÁ…Ñ¡ô¹¥Ñ•µÍ€°™…±Í”¤ì(€ô(€¥˜€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Í¡•µ„¹ÁÉ•™¥á%Ñ•µÌ¤¤ì(€€€Í¡•µ„¹ÁÉ•™¥á%Ñ•µÌ¹™½É…  ¡¡¥±°¥¹‘•à¤€ôø(€€€€€Ù¥Í¥Ñ½È¡…ÍM¡•µ…I•½É¡¡¥±°€‘íÁ…Ñ¡ô¹ÁÉ•™¥á%Ñ•µÍl‘í¥¹‘•áõu€¤°€‘íÁ…Ñ¡ô¹ÁÉ•™¥á%Ñ•µÍl‘í¥¹‘•áõu€°™…±Í”¤¤ì(€ô(€¥˜€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Í¡•µ„¹…¹å=˜¤¤ì(€€€Í¡•µ„¹…¹å=˜¹™½É…  ¡¡¥±°¥¹‘•à¤€ôø(€€€€€Ù¥Í¥Ñ½È¡…ÍM¡•µ…I•½É¡¡¥±°€‘íÁ…Ñ¡ô¹…¹å=™l‘í¥¹‘•áõu€¤°€‘íÁ…Ñ¡ô¹…¹å=™l‘í¥¹‘•áõu€°™…±Í”¤¤ì(€ô(€¥˜€¡ÑåÁ•½˜Í¡•µ„¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€ôôô€‰½‰©•Ðˆ€˜˜Í¡•µ„¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€„ôô¹Õ±°¤ì(€€€Ù¥Í¥Ñ½È (€€€€€…ÍM¡•µ…I•½É¡Í¡•µ„¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°€‘íÁ…Ñ¡ô¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Í€¤°(€€€€€€‘íÁ…Ñ¡ô¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Í€°(€€€€€™…±Í”°(€€€€¤ì(€ô)ô()™Õ¹Ñ¥½¸…ÍÍ•ÉÑ±±I•™•É•¹•ÍI•Í½±Ù”¡Í¡•µ„è)Í½¹M¡•µ…I•½É°É½½Ðè)Í½¹M¡•µ…I•½É°Á…Ñ €ô€ˆˆ¤èÙ½¥ì(€½¹ÍÐ¹½Éµ…±¥é•‘A…Ñ €ôÁ…Ñ ¹ÑÉ¥´ ¤ì(€¥˜€¡ÑåÁ•½˜Í¡•µ„¸‘É•˜€ôôô€‰ÍÑÉ¥¹œˆ¤ì(€€€É•Í½±Ù•1½…±M¡•µ…I•˜¡É½½Ð°Í¡•µ„¸‘É•˜°¹½Éµ…±¥é•‘A…Ñ ¤ì(€ô((€¥˜€¡ÑåÁ•½˜Í¡•µ„¸‘‘•™Ì€ôôô€‰½‰©•Ðˆ€˜˜Í¡•µ„¸‘‘•™Ì€„ôô¹Õ±°€˜˜€…ÉÉ…ä¹¥ÍÉÉ…ä¡Í¡•µ„¸‘‘•™Ì¤¤ì(€€€™½È€¡½¹ÍÐm¹…µ”°¡¥±‘t½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡Í¡•µ„¸‘‘•™Ì…Ì)Í½¹M¡•µ…I•½É¤¤ì(€€€€€…ÍÍ•ÉÑ±±I•™•É•¹•ÍI•Í½±Ù”¡…ÍM¡•µ…I•½É¡¡¥±°€‘í¹½Éµ…±¥é•‘A…Ñ¡ô¸‘‘•™Ì¸‘í¹…µ•õ€¤°É½½Ð°€‘í¹½Éµ…±¥é•‘A…Ñ¡ô¸‘‘•™Ì¸‘í¹…µ•õ€¤ì(€€€ô(€ô(€Ù¥Í¥Ñ¡¥±‘M¡•µ…Ì¡Í¡•µ„°¹½Éµ…±¥é•‘A…Ñ °€¡¡¥±°¡¥±‘A…Ñ ¤€ôø(€€€…ÍÍ•ÉÑ±±I•™•É•¹•ÍI•Í½±Ù”¡¡¥±°É½½Ð°¡¥±‘A…Ñ ¤¤ì)ô()™Õ¹Ñ¥½¸…ÍÍ•ÉÑMÕÁÁ½ÉÑ•‘I•™•É•¹•å±•Ì¡É½½Ðè)Í½¹M¡•µ…I•½É¤èÙ½¥ì(€½¹ÍÐÙ¥Í¥Ð€ô€ (€€€Í¡•µ„è)Í½¹M¡•µ…I•½É°(€€€Á…Ñ èÍÑÉ¥¹œ°(€€€…Ñ¥Ù”èM•Ðñ)Í½¹M¡•µ…I•½Éø°(€€€½ÁÑ¥½¹…±‘•M••¸è‰½½±•…¸°(€€¤èÙ½¥€ôøì(€€€¥˜€¡…Ñ¥Ù”¹¡…Ì¡Í¡•µ„¤¤ì(€€€€€¥˜€ …½ÁÑ¥½¹…±‘•M••¸¤ì(€€€€€€€Í¡•µ…ÉÉ½È¡Á…Ñ °€‰½¹Ñ…¥¹Ì„É•™•É•¹”å±”É•…¡…‰±”½¹±äÑ¡É½Õ É•ÅÕ¥É•Í¡•µ„•‘•Ì¸ˆ¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€…Ñ¥Ù”¹…‘¡Í¡•µ„¤ì(€€€¥˜€¡ÑåÁ•½˜Í¡•µ„¸‘É•˜€ôôô€‰ÍÑÉ¥¹œˆ¤ì(€€€€€½¹ÍÐÑ…É•Ð€ôÉ•Í½±Ù•1½…±M¡•µ…I•˜¡É½½Ð°Í¡•µ„¸‘É•˜°Á…Ñ ¤ì(€€€€€¥˜€¡…Ñ¥Ù”¹¡…Ì¡Ñ…É•Ð¤¤ì(€€€€€€€¥˜€ …½ÁÑ¥½¹…±‘•M••¸¤ì(€€€€€€€€€Í¡•µ…ÉÉ½È¡Á…Ñ °½¹Ñ…¥¹ÌÉ•ÅÕ¥É•É•ÕÉÍ¥Ù”É•™•É•¹”€ˆ‘íÍ¡•µ„¸‘É•™ôˆ¹€¤ì(€€€€€€€ô(€€€€€ô•±Í”ì(€€€€€€€Ù¥Í¥Ð¡Ñ…É•Ð°€‘íÁ…Ñ¡ô€´ø€‘íÍ¡•µ„¸‘É•™õ€°…Ñ¥Ù”°½ÁÑ¥½¹…±‘•M••¸¤ì(€€€€€ô(€€€€€…Ñ¥Ù”¹‘•±•Ñ”¡Í¡•µ„¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€Ù¥Í¥Ñ¡¥±‘M¡•µ…Ì¡Í¡•µ„°Á…Ñ °€¡¡¥±°¡¥±‘A…Ñ °½ÁÑ¥½¹…±‘”¤€ôø(€€€€€Ù¥Í¥Ð¡¡¥±°¡¥±‘A…Ñ °…Ñ¥Ù”°½ÁÑ¥½¹…±‘•M••¸ñð½ÁÑ¥½¹…±‘”¤¤ì(€€€…Ñ¥Ù”¹‘•±•Ñ”¡Í¡•µ„¤ì(€ôì((€Ù¥Í¥Ð¡É½½Ð°€ˆˆ°¹•ÜM•Ð ¤°™…±Í”¤ì)ô((¼¨¨(€¨É•ÍÁ½¹Í•)Í½¹M¡•µ…€…•ÁÑÌ½¹±ä…¸•áÁ±¥¥ÐÍÕ‰Í•Ð½˜)M=8M¡•µ„¸Y…±¥‘…Ñ”(€¨Ñ¡…ÐÍÕ‰Í•ÐÉ…Ñ¡•ÈÑ¡…¸µ…¥¹Ñ…¥¹¥¹œ„‘•¹å±¥ÍÐÍ¼„¹•Ý±ä½‰Í•ÉÙ•­•åÝ½É(€¨™…¥±Ì±½Í•‰•™½É”½¹Ñ•¹Ð¥ÌÍ•¹ÐÑ¼•µ¥¹¤¸I•™•É•¹•ÌµÕÍÐ‰”±½…°…¹(€¨É•Í½±Ù…‰±”ìÉ•ÕÉÍ¥Ù”É•™•É•¹•Ì…É”…•ÁÑ•½¹±äÝ¡•¸Ñ¡”å±”É½ÍÍ•Ì…¸(€¨½ÁÑ¥½¹…°ÁÉ½Á•ÉÑä°µ…Ñ¡¥¹œÑ¡”É•ÁÉ•Í•¹Ñ…‰¥±¥Ñä½¹ÍÑÉ…¥¹Ð½˜Ñ¡”M,¸(€¨¼)™Õ¹Ñ¥½¸…ÍÍ•ÉÑI•ÁÉ•Í•¹Ñ…‰±•M¡•µ„¡Ù…±Õ”èÕ¹­¹½Ý¸¤èÙ½¥ì(€…ÍÍ•ÉÑM¡•µ…M¡…Á”¡Ù…±Õ”¤ì(€½¹ÍÐÉ½½Ð€ô…ÍM¡•µ…I•½É¡Ù…±Õ”°€ˆˆ¤ì(€…ÍÍ•ÉÑ±±I•™•É•¹•ÍI•Í½±Ù”¡É½½Ð°É½½Ð¤ì(€…ÍÍ•ÉÑMÕÁÁ½ÉÑ•‘I•™•É•¹•å±•Ì¡É½½Ð¤ì)ô()™Õ¹Ñ¥½¸…ÍÍ•ÉÑI•ÁÉ•Í•¹Ñ…‰±•Q½½±Ì¡É•ÅÕ•ÍÐè¥AÉ½Ù¥‘•ÉQ•áÑI•ÅÕ•ÍÐ¤èÙ½¥ì(€¥˜€ …É•ÅÕ•ÍÐ¹Ñ½½±Ìü¹±•¹Ñ ¤É•ÑÕÉ¸ì(€Ñ¡É½Ü¥¹½µÁ…Ñ¥‰±•=Á•É…Ñ¥½¸ (€€€€‰•µ¥¹¥AÉ½Ù¥‘•ÈèÉ•ÅÕ•ÍÐÑ½½±Ì…É”¹½ÐÉ•ÁÉ•Í•¹Ñ…‰±”‰äÑ¡”ÕÉÉ•¹Ð…‘…ÁÑ•È¸½½±”M•…É ÑÉ…¹Í±…Ñ¥½¸µÕÍÐ‰”¥µÁ±•µ•¹Ñ••áÁ±¥¥Ñ±ä‰•™½É”¹•ÑÝ½É¬…•ÍÌ¸ˆ°(€€¤ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘•¹•É…Ñ¥½¹½¹™¥œ (€É•ÅÕ•ÍÐè¥AÉ½Ù¥‘•ÉQ•áÑI•ÅÕ•ÍÐ°(€½ÁÑ¥½¹Ìüè¥AÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ=ÁÑ¥½¹Ì°(¤è•¹•É…Ñ•½¹Ñ•¹Ñ½¹™¥œì(€½¹ÍÐ½¹™¥œè•¹•É…Ñ•½¹Ñ•¹Ñ½¹™¥œ€ôìµ…á=ÕÑÁÕÑQ½­•¹Ìè€àÄäÈôì((€¥˜€¡É•ÅÕ•ÍÐ¹™½Éµ…Ðü¹ÑåÁ”€ôôô€‰©Í½¹}Í¡•µ„ˆ¤ì(€€€…ÍÍ•ÉÑI•ÁÉ•Í•¹Ñ…‰±•M¡•µ„¡É•ÅÕ•ÍÐ¹™½Éµ…Ð¹Í¡•µ„¤ì(€€€½¹™¥œ¹É•ÍÁ½¹Í•5¥µ•QåÁ”€ô€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆì(€€€½¹™¥œ¹É•ÍÁ½¹Í•)Í½¹M¡•µ„€ôÉ•ÅÕ•ÍÐ¹™½Éµ…Ð¹Í¡•µ„ì(€ô((€½¹ÍÐÍåÍÑ•µ%¹ÍÑÉÕÑ¥½¸€ô‰Õ¥±‘MåÍÑ•µ%¹ÍÑÉÕÑ¥½¸¡É•ÅÕ•ÍÐ¹¥¹ÍÑÉÕÑ¥½¹Ì¤ì(€¥˜€¡ÍåÍÑ•µ%¹ÍÑÉÕÑ¥½¸¤½¹™¥œ¹ÍåÍÑ•µ%¹ÍÑÉÕÑ¥½¸€ôÍåÍÑ•µ%¹ÍÑÉÕÑ¥½¸ì(€¥˜€¡½ÁÑ¥½¹Ìü¹Í¥¹…°¤½¹™¥œ¹…‰½ÉÑM¥¹…°€ô½ÁÑ¥½¹Ì¹Í¥¹…°ì(€É•ÑÕÉ¸½¹™¥œì)ô()•áÁ½ÉÐ±…ÍÌ•µ¥¹¥AÉ½Ù¥‘•È¥µÁ±•µ•¹ÑÌ¥AÉ½Ù¥‘•Èì(€ÁÉ¥Ù…Ñ”É•…‘½¹±ä±¥•¹Ðè½½±••¹$ì((€½¹ÍÑÉÕÑ½È¡…Á¥-•äèÍÑÉ¥¹œ¤ì(€€€Ñ¡¥Ì¹±¥•¹Ð€ô¹•Ü½½±••¹$¡ì…Á¥-•äô¤ì(€ô((€…Íå¹ŒÉ•…Ñ•Q•áÑI•ÍÁ½¹Í” (€€€É•ÅÕ•ÍÐè¥AÉ½Ù¥‘•ÉQ•áÑI•ÅÕ•ÍÐ°(€€€½ÁÑ¥½¹Ìüè¥AÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ=ÁÑ¥½¹Ì°(€€¤èAÉ½µ¥Í”ñ¥AÉ½Ù¥‘•ÉQ•áÑI•ÍÁ½¹Í”øì(€€€…ÍÍ•ÉÑI•ÁÉ•Í•¹Ñ…‰±•Q½½±Ì¡É•ÅÕ•ÍÐ¤ì(€€€½¹ÍÐÁ…ÉÑÌ€ô‰Õ¥±‘•µ¥¹¥A…ÉÑÌ¡É•ÅÕ•ÍÐ¹¥¹ÁÕÐ¤ì(€€€½¹ÍÐ½¹Ñ•¹ÑÌè½¹Ñ•¹Ñ1¥ÍÑU¹¥½¸€ômìÉ½±”è€‰ÕÍ•Èˆ°Á…ÉÑÌõtì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥ÐÑ¡¥Ì¹±¥•¹Ð¹µ½‘•±Ì¹•¹•É…Ñ•½¹Ñ•¹Ð¡ì(€€€€€µ½‘•°èÉ•ÅÕ•ÍÐ¹µ½‘•°°(€€€€€½¹Ñ•¹ÑÌ°(€€€€€½¹™¥œè‰Õ¥±‘•¹•É…Ñ¥½¹½¹™¥œ¡É•ÅÕ•ÍÐ°½ÁÑ¥½¹Ì¤°(€€€ô¤ì((€€€½¹ÍÐÕÍ…•5•Ñ…‘…Ñ„€ôÉ•ÍÁ½¹Í”¹ÕÍ…•5•Ñ…‘…Ñ„ì(€€€É•ÑÕÉ¸ì(€€€€€¥è•µ¥¹¤´‘í…Ñ”¹¹½Ü ¥õ€°(€€€€€½ÕÑÁÕÑQ•áÐèÉ•ÍÁ½¹Í”¹Ñ•áÐ€üü€ˆˆ°(€€€€€É…ÜèÉ•ÍÁ½¹Í”°(€€€€€€¸¸¸¡ÕÍ…•5•Ñ…‘…Ñ„(€€€€€€€€üì(€€€€€€€€€€€ÕÍ…”èì(€€€€€€€€€€€€€¥¹ÁÕÑQ½­•¹ÌèÕÍ…•5•Ñ…‘…Ñ„¹ÁÉ½µÁÑQ½­•¹½Õ¹Ð°(€€€€€€€€€€€€€½ÕÑÁÕÑQ½­•¹ÌèÕÍ…•5•Ñ…‘…Ñ„¹…¹‘¥‘…Ñ•ÍQ½­•¹½Õ¹Ð°(€€€€€€€€€€€€€Ñ½Ñ…±Q½­•¹ÌèÕÍ…•5•Ñ…‘…Ñ„¹Ñ½Ñ…±Q½­•¹½Õ¹Ð°(€€€€€€€€€€€€€É…ÜèÕÍ…•5•Ñ…‘…Ñ„°(€€€€€€€€€€€ô°(€€€€€€€€€ô(€€€€€€€€èíô¤°(€€€ô…Ì¥AÉ½Ù¥‘•ÉQ•áÑI•ÍÁ½¹Í”ì(€ô((€…Íå¹ŒÉ•…Ñ•µ‰•‘‘¥¹Ì (€€€}É•ÅÕ•ÍÐè¥AÉ½Ù¥‘•Éµ‰•‘‘¥¹I•ÅÕ•ÍÐ°(€€€}½ÁÑ¥½¹Ìüè¥AÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ=ÁÑ¥½¹Ì°(€€¤èAÉ½µ¥Í”ñ¥AÉ½Ù¥‘•Éµ‰•‘‘¥¹I•ÍÁ½¹Í”øì(€€€Ñ¡É½Ü¥¹½µÁ…Ñ¥‰±•=Á•É…Ñ¥½¸ (€€€€€€‰•µ¥¹¥AÉ½Ù¥‘•È‘½•Ì¹½ÐÍÕÁÁ½ÉÐ•µ‰•‘‘¥¹Ì¥¸Ñ¡¥ÌÁÉ½©•Ð¸½¹™¥ÕÉ”…¸…‘…ÁÑ•ÈÑ¡…Ð•áÁ±¥¥Ñ±äÍÕÁÁ½ÉÑÌ•µ‰•‘‘¥¹Ì¸ˆ°(€€€€¤ì(€ô((€…Íå¹ŒÉ•…Ñ•Õ‘¥½QÉ…¹ÍÉ¥ÁÑ¥½¸ (€€€}É•ÅÕ•ÍÐè¥AÉ½Ù¥‘•ÉÕ‘¥½QÉ…¹ÍÉ¥ÁÑ¥½¹I•ÅÕ•ÍÐ°(€€€}½ÁÑ¥½¹Ìüè¥AÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ=ÁÑ¥½¹Ì°(€€¤èAÉ½µ¥Í”ñ¥AÉ½Ù¥‘•ÉÕ‘¥½QÉ…¹ÍÉ¥ÁÑ¥½¹I•ÍÁ½¹Í”øì(€€€Ñ¡É½Ü¥¹½µÁ…Ñ¥‰±•=Á•É…Ñ¥½¸ (€€€€€€‰•µ¥¹¥AÉ½Ù¥‘•È‘½•Ì¹½ÐÍÕÁÁ½ÉÐ…Õ‘¥¼ÑÉ…¹ÍÉ¥ÁÑ¥½¸¸½¹™¥ÕÉ”…¸…‘…ÁÑ•ÈÑ¡…Ð•áÁ±¥¥Ñ±äÍÕÁÁ½ÉÑÌÑÉ…¹ÍÉ¥ÁÑ¥½¸¸ˆ°(€€€€¤ì(€ô((€…Íå¹ŒÉ•…Ñ•%µ…••¹•É…Ñ¥½¸ (€€€}É•ÅÕ•ÍÐè¥AÉ½Ù¥‘•É%µ…••¹•É…Ñ¥½¹I•ÅÕ•ÍÐ°(€€€}½ÁÑ¥½¹Ìüè¥AÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ=ÁÑ¥½¹Ì°(€€¤èAÉ½µ¥Í”ñ¥AÉ½Ù¥‘•É%µ…••¹•É…Ñ¥½¹I•ÍÁ½¹Í”øì(€€€Ñ¡É½Ü¥¹½µÁ…Ñ¥‰±•=Á•É…Ñ¥½¸ (€€€€€€‰•µ¥¹¥AÉ½Ù¥‘•È‘½•Ì¹½ÐÍÕÁÁ½ÉÐ¥µ…”•¹•É…Ñ¥½¸½È•‘¥Ñ¥¹œ¥¸Ñ¡¥ÌÁÉ½©•Ð¸ˆ°(€€€€¤ì(€ô)ô