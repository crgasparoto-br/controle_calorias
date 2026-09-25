import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { normalizeImageForAnalysis } from "./imageAnalysisNormalization";

describe("normalizeImageForAnalysis", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("aplica a orientação EXIF na cópia enviada à visão e remove a orientação pendente", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 2,
        channels: 3,
        background: { r: 220, g: 180, b: 120 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const original = Buffer.from(source);

    const result = await normalizeImageForAnalysis(source, "image/jpeg");
    const metadata = await sharp(result.buffer).metadata();

    expect(result.normalized).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(4);
    expect(metadata.orientation).toBeUndefined();
    expect(source.equals(original)).toBe(true);
    expect(result.buffer.equals(source)).toBe(false);
  });

  it("mantém o payload original quando o tipo não é uma imagem normalizável", async () => {
    const source = Buffer.from("audio-payload");

    await expect(
      normalizeImageForAnalysis(source, "audio/ogg")
    ).resolves.toEqual({
      buffer: source,
      mimeType: "audio/ogg",
      normalized: false,
    });
  });

  it("falha de forma controlada quando a imagem excede o orçamento de pixels", async () => {
    const source = await sharp({
      create: {
        width: 4_100,
        height: 4_100,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    }).jpeg({ quality: 70 }).toBuffer();

    await expect(normalizeImageForAnalysis(source, "image/jpeg"))
      .rejects.toThrow("image_too_many_pixels");
  });
});
