import sharp from "sharp";

// Keep the decoded working copy bounded for the 512 MiB production runtime.
// Typical WhatsApp phone photos (including 12 MP captures) remain supported;
// oversized uploads fail closed and are answered by the webhook fallback.
const MAX_INPUT_PIXELS = 16_000_000;
const NORMALIZABLE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type NormalizedImageForAnalysis = {
  buffer: Buffer;
  mimeType: string;
  normalized: boolean;
};

function normalizeMimeType(mimeType: string) {
  return (
    mimeType.split(";", 1)[0]?.trim().toLowerCase() ||
    "application/octet-stream"
  );
}

/**
 * Re-encodes only the analysis copy so EXIF orientation is applied before the
 * vision provider receives the image. The original bytes remain untouched for
 * auditability and media persistence.
 */
export async function normalizeImageForAnalysis(
  buffer: Buffer,
  mimeType: string
): Promise<NormalizedImageForAnalysis> {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (!NORMALIZABLE_MIME_TYPES.has(normalizedMimeType)) {
    return { buffer, mimeType, normalized: false };
  }

  try {
    const result = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .toFormat(
        normalizedMimeType === "image/png"
          ? "png"
          : normalizedMimeType === "image/webp"
            ? "webp"
            : "jpeg"
      )
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: result.data,
      mimeType: normalizedMimeType,
      normalized: true,
    };
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new Error("image_too_many_pixels");
    }
    // Keep the existing inline path available when a provider returns an
    // unusual but still downloadable image payload. The vision layer remains
    // responsible for rejecting content it cannot parse safely.
    return { buffer, mimeType, normalized: false };
  }
}

export type { NormalizedImageForAnalysis };
