import { createHash } from "node:crypto";
import sharp from "sharp";
import type { MealProcessingResult } from "./nutritionEngine";
import { generateAnnotatedMealImage } from "./modules/whatsapp/annotatedImage";

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function buildSyntheticMeal(): MealProcessingResult {
  return {
    detectedMealLabel: "Almoço",
    sourceText: "",
    confidence: 0.99,
    needsConfirmation: false,
    reasoning: "Fixture sintética do smoke da issue #925.",
    items: [
      {
        foodName: "Arroz integral",
        canonicalName: "Arroz integral",
        quantity: 100,
        unit: "g",
        portionText: "100 g",
        servings: 1,
        estimatedGrams: 100,
        calories: 130,
        protein: 2.5,
        carbs: 28,
        fat: 0.3,
        confidence: 0.99,
        source: "heuristic",
      },
    ],
    totals: { calories: 130, protein: 2.5, carbs: 28, fat: 0.3 },
  };
}

export type Issue925ImageAnnotationSmokeResult = {
  smoke: "issue-925-local-image-annotation";
  status: "passed";
  mode: "local";
  artifactKind: "photo_annotation";
  degradation: "none";
  sourcePreserved: true;
  derivativeSeparated: true;
  dimensions: { width: 640; height: 480 };
  storageWrites: 1;
  storageKey: string;
  sourceSha256: string;
  derivativeSha256: string;
};

export async function runIssue925ImageAnnotationSmoke(): Promise<Issue925ImageAnnotationSmokeResult> {
  const source = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 202, g: 164, b: 112 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  const sourceSnapshot = Buffer.from(source);
  const stored: Array<{ key: string; mimeType: string; bytes: number }> = [];

  const result = await generateAnnotatedMealImage(
    buildSyntheticMeal(),
    `data:image/jpeg;base64,${source.toString("base64")}`,
    {
      NODE_ENV: "test",
      AI_VISION_PROVIDER: "gemini",
      AI_MEAL_VISION_PROVIDER: "gemini",
    },
    {
      local: {
        storagePutFn: async (key, data, mimeType) => {
          const bytes = typeof data === "string"
            ? Buffer.byteLength(data)
            : data.byteLength;
          stored.push({ key, mimeType, bytes });
          return { key, url: `memory://issue-925/${key}` };
        },
      },
    },
  );

  if (!source.equals(sourceSnapshot)) throw new Error("source_image_was_mutated");
  if (result.mode !== "local") throw new Error(`unexpected_mode:${String(result.mode)}`);
  if (result.artifactKind !== "photo_annotation") {
    throw new Error(`unexpected_artifact:${String(result.artifactKind)}`);
  }
  if (result.degradation !== "none") {
    throw new Error(`unexpected_degradation:${String(result.degradation)}`);
  }
  if (!result.buffer?.length) throw new Error("derived_buffer_missing");
  if (result.buffer.equals(source)) throw new Error("derived_equals_original");
  if (!result.storageKey || result.storageKey === "original-photo") {
    throw new Error("derived_storage_key_missing_or_reused");
  }
  if (stored.length !== 1) throw new Error(`unexpected_storage_writes:${stored.length}`);
  if (stored[0]?.mimeType !== "image/png") {
    throw new Error(`unexpected_storage_mime:${String(stored[0]?.mimeType)}`);
  }
  if (stored[0]?.bytes !== result.buffer.length) {
    throw new Error(`unexpected_storage_bytes:${String(stored[0]?.bytes)}`);
  }

  const metadata = await sharp(result.buffer).metadata();
  if (metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(`unexpected_dimensions:${metadata.width}x${metadata.height}`);
  }

  return {
    smoke: "issue-925-local-image-annotation",
    status: "passed",
    mode: "local",
    artifactKind: "photo_annotation",
    degradation: "none",
    sourcePreserved: true,
    derivativeSeparated: true,
    dimensions: { width: 640, height: 480 },
    storageWrites: 1,
    storageKey: result.storageKey,
    sourceSha256: sha256(source),
    derivativeSha256: sha256(result.buffer),
  };
}
