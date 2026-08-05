import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { MealProcessingResult } from "../../nutritionEngine";
import {
  buildLocalOverlayLayout,
  buildLocalOverlaySvg,
  createLocalMealPhotoOverlay,
  fitTextToWidth,
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

async function countVisiblePixelsOutsideHorizontalSafeArea(
  svg: Buffer,
  width: number,
  panelX: number,
  panelWidth: number,
) {
  const rendered = await sharp(svg)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let outside = 0;
  const right = panelX + panelWidth;

  for (let y = 0; y < rendered.info.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= panelX && x < right) continue;
      const alpha = rendered.data[(y * rendered.info.width + x) * rendered.info.channels + 3];
      if (alpha > 0) outside += 1;
    }
  }

  return outside;
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

  it("keeps rendered text and panels inside the horizontal safe area on small images", async () => {
    const dimensions: Array<[number, number]> = [
      [80, 120],
      [96, 64],
      [200, 140],
      [320, 240],
    ];

    for (const [width, height] of dimensions) {
      const layout = buildLocalOverlayLayout(meal(), width, height);
      const svg = buildLocalOverlaySvg(meal(), width, height);

      expect(layout.compact).toBe(true);
      expect(layout.panelX).toBeGreaterThanOrEqual(0);
      expect(layout.panelWidth + layout.panelX).toBeLessThanOrEqual(width);
      await expect(
        countVisiblePixelsOutsideHorizontalSafeArea(
          svg,
          width,
          layout.panelX,
          layout.panelWidth,
        ),
      ).resolves.toBe(0);
    }
  });

  it("fits long text deterministically to the available width", () => {
    const fitted = fitTextToWidth(
      "Uma descrição muito longa que não pode ultrapassar o painel",
      80,
      14,
      700,
    );

    expect(fitted).toMatch(/…$/u);
    expect(fitted.length).toBeLessThan(60);
    expect(fitTextToWidth(fitted, 80, 14, 700)).toBe(fitted);
    expect(fitTextToWidth("texto", 1, 14, 700)).toBe("");
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
