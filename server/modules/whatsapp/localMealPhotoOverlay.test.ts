import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { MealProcessingResult } from "../../nutritionEngine";
import {
  buildLocalOverlayLayout,
  buildLocalOverlaySvg,
  createLocalMealPhotoOverlay,
} from "./localMealPhotoOverlay";

function meal(overrides: Partial<MealProcessingResult> = {}): MealProcessingResult {
  return {
    detectedMealLabel: "Almoço & jantar <teste>",
    sourceText: "",
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "Teste",
    items: [
      {
        foodName: "Arroz integral com um nome muito longo para o cartão nutricional",
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
        confidence: 0.9,
        source: "heuristic",
      },
    ],
    totals: { calories: 130, protein: 2.5, carbs: 28, fat: 0.3 },
    ...overrides,
  };
}

describe("local meal photo overlay", () => {
  it("creates a separate deterministic derivative with original dimensions", async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 210, g: 170, b: 120 },
      },
    }).jpeg().toBuffer();
    const originalSnapshot = Buffer.from(source);
    const storagePutFn = vi.fn(async (key: string) => ({
      url: `https://cdn.test/${key}`,
      key,
    }));

    const result = await createLocalMealPhotoOverlay(
      {
        image: { b64Json: source.toString("base64"), mimeType: "image/jpeg" },
        processed: meal(),
      },
      { storagePutFn },
    );

    const metadata = await sharp(result.buffer).metadata();
    expect(source.equals(originalSnapshot)).toBe(true);
    expect(result.buffer.equals(source)).toBe(false);
    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(480);
    expect(result).toMatchObject({
      artifactKind: "photo_annotation",
      mode: "local",
      degradation: "none",
      mimeType: "image/png",
    });
    expect(result.storageKey).toMatch(/^generated\/meal-annotations\/local-[a-f0-9]{24}\.png$/u);
  });

  it("uses a compact safe-area layout for small images", () => {
    const layout = buildLocalOverlayLayout(meal(), 200, 140);
    expect(layout.compact).toBe(true);
    expect(layout.cards).toHaveLength(0);
    expect(layout.headerHeight).toBeLessThanOrEqual(58);
    expect(layout.panelX).toBeGreaterThanOrEqual(0);
    expect(layout.panelWidth + layout.panelX).toBeLessThanOrEqual(200);
  });

  it("limits long text, escapes markup and handles missing item data", () => {
    const longSvg = buildLocalOverlaySvg(meal(), 640, 480).toString("utf8");
    expect(longSvg).toContain("&amp;");
    expect(longSvg).toContain("&lt;teste&gt;");
    expect(longSvg).toContain("…");
    expect(longSvg).not.toContain("<teste>");

    const emptySvg = buildLocalOverlaySvg(
      meal({ items: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } }),
      320,
      240,
    ).toString("utf8");
    expect(emptySvg).toContain("Sem itens detalhados para exibir");
  });

  it("rejects malformed source data before Sharp or storage is used", async () => {
    const storagePutFn = vi.fn();

    await expect(createLocalMealPhotoOverlay(
      {
        image: { b64Json: "%%%", mimeType: "image/jpeg" },
        processed: meal(),
      },
      { storagePutFn },
    )).rejects.toThrow("invalid_image_base64");
    expect(storagePutFn).not.toHaveBeenCalled();
  });
});
